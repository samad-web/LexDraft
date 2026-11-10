/**
 * Co-Counsel lockdown - real-Postgres coverage of
 * build-docs/features/co-counsel-lockdown.md. Test names carry the
 * acceptance-criterion number (AC1..AC9) they prove.
 *
 * Runs in the integration suite's throwaway schema (dropped afterwards), so
 * nothing is left behind in the database.
 */

import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser, type SeededFirm, type SeededUser } from '../../__tests__/integration-fixtures';
import { assignmentsService } from '../assignments.service';
import { casesService } from '../cases.service';
import { clientsService } from '../clients.service';
import { coCounselService } from '../co-counsel.service';
import { documentsService } from '../documents.service';
import { teamChatService, type Viewer } from '../team-chat.service';

const GUEST_PHONE = '+919876500001';
const OUTSIDER_PHONE = '+919876500002';
const NEW_PHONE = '+919876500003';

let firmA: SeededFirm;
let head: SeededUser;      // Managing Partner of firm A (refers matters)
let teammate: SeededUser;  // second advocate in firm A
let guestFirm: SeededFirm;
let guest: SeededUser;     // existing DifAi advocate in another firm
let outsider: SeededUser;  // someone the link gets forwarded to
let caseX: string;         // handed over
let caseY: string;         // never handed over
let docX: string;
let docY: string;

const actor = (u: SeededUser) => ({ id: u.id, role: u.role, isSuperadmin: false });
const viewer = (u: SeededUser): Viewer => ({
  id: u.id, firmId: u.firmId, role: u.role, isSuperadmin: false, auditActorId: u.id, auditActorEmail: u.email,
});

async function setVerifiedPhone(userId: string, phone: string) {
  await getIntegrationSql()`update users set phone = ${phone}, phone_verified_at = now() where id = ${userId}::uuid`;
}

async function shareLink(caseId: string, phone: string) {
  const r = await coCounselService.requestHandover({
    caseId, firmId: firmA.id, actor: actor(head), input: { target: { open: true, phone } },
  });
  return { id: r.id, token: r.shareToken! };
}

/** Same shape authService issues after Google + WhatsApp OTP. */
function signupToken(email: string, phone: string) {
  return jwt.sign(
    { purpose: 'google-signup', google: { sub: `sub-${phone}`, email, name: 'New Advocate', picture: null }, phone },
    `${process.env['JWT_SECRET']}:google-signup`,
    { expiresIn: '5m' },
  );
}

beforeAll(async () => {
  const sql = getIntegrationSql();
  firmA = await seedFirm('Referring Firm A');
  head = await seedUser(firmA.id, { role: 'Managing Partner' });
  teammate = await seedUser(firmA.id, { role: 'Associate' });
  guestFirm = await seedFirm('Guest Solo', 'Solo');
  guest = await seedUser(guestFirm.id, { role: 'Solo Advocate' });
  const outsiderFirm = await seedFirm('Outsider Solo', 'Solo');
  outsider = await seedUser(outsiderFirm.id, { role: 'Solo Advocate' });
  await setVerifiedPhone(guest.id, GUEST_PHONE);
  await setVerifiedPhone(outsider.id, OUTSIDER_PHONE);

  const base = { court: 'Madras HC', stage: 'Pleadings', client: 'Client A', status: 'Active' as const, next: '2026-12-01', type: 'civil' as const, visibleToClient: false };
  caseX = (await casesService.create({ ...base, cnr: 'CNR/X/1', title: 'Handed v. Over' }, firmA.id)).id;
  caseY = (await casesService.create({ ...base, cnr: 'CNR/Y/1', title: 'Secret v. Matter' }, firmA.id)).id;
  [{ id: docX }] = await sql<Array<{ id: string }>>`
    insert into documents (firm_id, case_id, case_label, name, type) values (${firmA.id}::uuid, ${caseX}::uuid, 'X', 'Plaint X', 'Plaint') returning id`;
  [{ id: docY }] = await sql<Array<{ id: string }>>`
    insert into documents (firm_id, case_id, case_label, name, type) values (${firmA.id}::uuid, ${caseY}::uuid, 'Y', 'Plaint Y', 'Plaint') returning id`;
  await sql`insert into clients (firm_id, name) values (${firmA.id}::uuid, 'Firm A Client')`;
  await sql`
    insert into case_notes (firm_id, case_id, author_user_id, visibility, title, body) values
      (${firmA.id}::uuid, ${caseX}::uuid, ${head.id}::uuid, 'shared', 'Shared note', 'ok to share'),
      (${firmA.id}::uuid, ${caseX}::uuid, ${head.id}::uuid, 'private', 'Private note', 'internal only')`;
});

describe('co-counsel lockdown - real Postgres', () => {
  it('AC8: rejects a cross-firm existingUserId target (outside advocates only via a phone-bound link)', async () => {
    await expect(coCounselService.requestHandover({
      caseId: caseX, firmId: firmA.id, actor: actor(head), input: { target: { existingUserId: guest.id } },
    })).rejects.toMatchObject({ status: 400 });
  });

  it('AC9: in-firm teammate handoff still changes the lead at once', async () => {
    const r = await coCounselService.requestHandover({
      caseId: caseX, firmId: firmA.id, actor: actor(head), input: { target: { existingUserId: teammate.id } },
    });
    expect(r.status).toBe('accepted');
    expect((await assignmentsService.getCaseLead(caseX, firmA.id))?.id).toBe(teammate.id);
  });

  it('rejects a share link with an invalid or non-Indian number', async () => {
    await expect(shareLink(caseX, '+14155550100')).rejects.toMatchObject({ status: 400 });
    await expect(shareLink(caseX, '12345')).rejects.toMatchObject({ status: 400 });
  });

  it('AC2: a forwarded link is refused for a different verified number and stays usable', async () => {
    const link = await shareLink(caseX, GUEST_PHONE);
    await expect(coCounselService.acceptByTokenAsUser(link.token, outsider.id)).rejects.toMatchObject({ status: 403 });
    await expect(coCounselService.lookupInviteByToken(link.token)).resolves.toMatchObject({ phoneHint: '0001' });
  });

  it('AC3: an existing DifAi user with the matching number accepts onto their own account', async () => {
    const link = await shareLink(caseX, GUEST_PHONE);
    const res = await coCounselService.acceptByTokenAsUser(link.token, guest.id);
    expect(res.grant).toMatchObject({ caseId: caseX, guestUserId: guest.id, status: 'active' });
    expect(res.auth).toBeUndefined();
    const [u] = await getIntegrationSql()<Array<{ firm_id: string }>>`select firm_id from users where id = ${guest.id}::uuid`;
    expect(u!.firm_id).toBe(guestFirm.id);
    // single use
    await expect(coCounselService.acceptByTokenAsUser(link.token, guest.id)).rejects.toMatchObject({ status: 409 });
  });

  it('AC1: the guest reaches the handed case only through the guest view - nothing else of firm A', async () => {
    const own = guest.firmId;
    const cases = await casesService.list({ firmId: own });
    expect(cases.map((c) => c.id)).not.toContain(caseX);
    expect(cases.map((c) => c.id)).not.toContain(caseY);
    expect(await casesService.get(caseX, own)).toBeUndefined();
    expect(await casesService.get(caseY, own)).toBeUndefined();
    expect(await documentsService.get(docX, own)).toBeUndefined();
    expect(await documentsService.get(docY, own)).toBeUndefined();
    expect((await documentsService.list(own)).map((d) => d.id)).not.toContain(docX);
    expect((await clientsService.list(own)).map((c) => c.name)).not.toContain('Firm A Client');

    const detail = await coCounselService.guestCaseDetail(guest.id, caseX);
    expect(detail.notes.map((n) => n.title)).toEqual(['Shared note']);
    expect(detail.documents.map((d) => d.name)).toEqual(['Plaint X']);
    await expect(coCounselService.guestCaseDetail(guest.id, caseY)).rejects.toMatchObject({ status: 404 });
  });

  it('AC6: in the matter chat the guest sees only messages from their grant date; firm members see all', async () => {
    const sql = getIntegrationSql();
    const [conv] = await sql<Array<{ id: string }>>`
      insert into conversations (firm_id, kind, case_id, created_by)
      values (${firmA.id}::uuid, 'matter', ${caseX}::uuid, ${teammate.id}::uuid) returning id`;
    await sql`
      insert into messages (firm_id, conversation_id, author_id, body, created_at)
      values (${firmA.id}::uuid, ${conv!.id}::uuid, ${teammate.id}::uuid, 'before guest joined', now() - interval '1 day')`;
    await sql`
      insert into messages (firm_id, conversation_id, author_id, body)
      values (${firmA.id}::uuid, ${conv!.id}::uuid, ${teammate.id}::uuid, 'after guest joined')`;
    await sql`update conversations set last_message_at = now() where id = ${conv!.id}::uuid`;

    const guestPage = await teamChatService.listMessages(viewer(guest), conv!.id);
    expect(guestPage.items.map((m) => m.body)).toEqual(['after guest joined']);
    const firmPage = await teamChatService.listMessages(viewer(teammate), conv!.id);
    expect(firmPage.items.map((m) => m.body)).toEqual(['before guest joined', 'after guest joined']);
  });

  it('AC4: revoke removes the case page, the guest list entry and the matter chat', async () => {
    const reqs = await coCounselService.listForFirm(firmA.id);
    const accepted = reqs.find((r) => r.status === 'accepted' && r.targetUserId === guest.id)!;
    const revoked = await coCounselService.revokeHandover(accepted.id, firmA.id, actor(head));
    expect(revoked.status).toBe('revoked');
    await expect(coCounselService.guestCaseDetail(guest.id, caseX)).rejects.toMatchObject({ status: 404 });
    expect(await coCounselService.listGuestCases(guest.id)).toEqual([]);
    const [conv] = await getIntegrationSql()<Array<{ id: string }>>`select id from conversations where case_id = ${caseX}::uuid`;
    await expect(teamChatService.listMessages(viewer(guest), conv!.id)).rejects.toMatchObject({ status: 404 });
    // firm member still in
    await expect(teamChatService.listMessages(viewer(teammate), conv!.id)).resolves.toBeTruthy();
  });

  it('AC4: only the requester or a firm head may revoke, and only accepted outside handovers', async () => {
    const link = await shareLink(caseX, GUEST_PHONE);
    await expect(coCounselService.revokeHandover(link.id, firmA.id, actor(head))).rejects.toMatchObject({ status: 409 });
    await coCounselService.acceptByTokenAsUser(link.token, guest.id);
    await expect(coCounselService.revokeHandover(link.id, firmA.id, actor(teammate))).rejects.toMatchObject({ status: 403 });
    await expect(coCounselService.revokeHandover(link.id, guestFirm.id, actor(head))).rejects.toMatchObject({ status: 404 });
  });

  it('AC5: the guest can leave a matter, with the same effect as a revoke', async () => {
    await coCounselService.leaveGuestCase(guest.id, caseX);
    await expect(coCounselService.guestCaseDetail(guest.id, caseX)).rejects.toMatchObject({ status: 404 });
    await expect(coCounselService.leaveGuestCase(guest.id, caseX)).rejects.toMatchObject({ status: 404 });
    const reqs = await coCounselService.listForFirm(firmA.id);
    expect(reqs.filter((r) => r.targetUserId === guest.id && r.status === 'accepted')).toEqual([]);
  });

  it('AC7: a link past its 7 days shows Expired and can no longer be accepted', async () => {
    const link = await shareLink(caseX, GUEST_PHONE);
    await getIntegrationSql()`
      update invitations set expires_at = now() - interval '1 minute'
      where id = (select invitation_id from handover_requests where id = ${link.id}::uuid)`;
    const reqs = await coCounselService.listForFirm(firmA.id);
    expect(reqs.find((r) => r.id === link.id)?.status).toBe('expired');
    await expect(coCounselService.acceptByTokenAsUser(link.token, guest.id)).rejects.toMatchObject({ status: 409 });
  });

  it('a firm member opening their own firm\'s link is told to use their Cases list', async () => {
    const link = await shareLink(caseX, GUEST_PHONE);
    await setVerifiedPhone(teammate.id, '+919876500009');
    await expect(coCounselService.acceptByTokenAsUser(link.token, teammate.id)).rejects.toMatchObject({ status: 409 });
  });

  it('AC2/AC3 new advocate: wrong number creates no account; right number gets their own firm + one grant', async () => {
    const sql = getIntegrationSql();
    const link = await shareLink(caseY, NEW_PHONE);

    await expect(coCounselService.acceptByToken(link.token, {
      name: 'Wrong Person', signupToken: signupToken('wrong@integration.test', '+919876500004'),
    })).rejects.toMatchObject({ status: 403 });
    const [stray] = await sql<Array<{ n: number }>>`select count(*)::int as n from users where email = 'wrong@integration.test'`;
    expect(stray!.n).toBe(0);

    const res = await coCounselService.acceptByToken(link.token, {
      name: 'New Advocate', signupToken: signupToken('new@integration.test', NEW_PHONE),
    });
    expect(res.auth?.user.email).toBe('new@integration.test');
    const [u] = await sql<Array<{ firm_id: string; acquired_via: string }>>`
      select firm_id, acquired_via from users where email = 'new@integration.test'`;
    expect(u!.firm_id).not.toBe(firmA.id);
    expect(u!.acquired_via).toBe('co_counsel_handover');
    expect((await coCounselService.listGuestCases(res.auth!.user.id)).map((c) => c.caseId)).toEqual([caseY]);
    expect(await casesService.get(caseX, u!.firm_id)).toBeUndefined();
  });
});
