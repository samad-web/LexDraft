import { Router, type Request } from 'express';
import { z } from 'zod';
import { teamChatService, type Viewer } from '../services/team-chat.service';
import { teamChatRealtime } from '../services/team-chat-realtime';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { validate, uuidParam } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';

// =============================================================================
// /api/team-chat - internal messaging between firm members.
//
//   GET    /stream                               SSE: live events for the caller
//   GET    /conversations                        inbox (with unread counts)
//   POST   /conversations/direct                 open/create a DM
//   POST   /conversations/group                  create a group
//   GET    /conversations/:id                    detail + members
//   PATCH  /conversations/:id                    rename (admin) / mute (self)
//   POST   /conversations/:id/members            add group members (admin)
//   DELETE /conversations/:id/members/:userId    remove (admin) / leave (self)
//   GET    /conversations/:id/messages?before=   page of messages, oldest-first
//   POST   /conversations/:id/messages           send
//   POST   /conversations/:id/read               mark read
//   PATCH  /messages/:id                         edit (author, 15 min)
//   POST   /messages/:id/delete                  { scope: 'me' | 'everyone' }
//   GET    /matters/:caseId                      matter discussion + assignees
//   POST   /matters/:caseId/members              assign a collaborator
//   DELETE /matters/:caseId/members/:userId      unassign a collaborator
// =============================================================================

const Attachment = z.object({
  kind: z.enum(['document', 'draft']),
  id: z.string().uuid(),
  name: z.string().max(300),
});

const SendInput = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToId: z.string().uuid().nullable().optional(),
  mentions: z.array(z.string().uuid()).max(100).optional(),
  attachments: z.array(Attachment).max(5).optional(),
});

const EditInput = z.object({
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string().uuid()).max(100).optional(),
});

const DeleteInput = z.object({ scope: z.enum(['me', 'everyone']) });
const DirectInput = z.object({ userId: z.string().uuid() });
const GroupInput = z.object({
  title: z.string().trim().min(1).max(100),
  memberIds: z.array(z.string().uuid()).min(1).max(99),
});
const PatchConversationInput = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  muted: z.boolean().optional(),
});
const AddMembersInput = z.object({ userIds: z.array(z.string().uuid()).min(1).max(99) });
const MemberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const CaseParam = z.object({ caseId: z.string().uuid() });
const CaseMemberParams = z.object({ caseId: z.string().uuid(), userId: z.string().uuid() });
const AddMatterMemberInput = z.object({ userId: z.string().uuid() });
const PageQuery = z.object({ before: z.string().uuid().optional() });

async function viewerOf(req: Request): Promise<Viewer> {
  const user = req.user;
  if (!user?.id) throw new UnauthorizedError('Unauthorized');
  return {
    id: user.id,
    firmId: await firmIdForUser(user.id),
    role: user.role,
    isSuperadmin: user.isSuperadmin,
    auditActorId: user.actAs?.adminId ?? user.id,
    auditActorEmail: user.actAs?.adminEmail ?? user.email,
  };
}

const param = (req: Request, key: string): string => (req.params as Record<string, string>)[key]!;

export const teamChatRouter: Router = Router();

teamChatRouter.use(requireFeature('team.messaging'));

teamChatRouter.get('/stream', (req, res) => {
  const detach = teamChatRealtime.attach(req.user!.id, res);
  req.on('close', detach);
});

teamChatRouter.get('/conversations', async (req, res, next) => {
  try {
    res.json({ items: await teamChatService.listConversations(await viewerOf(req)) });
  } catch (err) { next(err); }
});

teamChatRouter.post('/conversations/direct', validate({ body: DirectInput }), async (req, res, next) => {
  try {
    res.status(201).json(await teamChatService.openDirect(await viewerOf(req), req.body.userId));
  } catch (err) { next(err); }
});

teamChatRouter.post('/conversations/group', validate({ body: GroupInput }), async (req, res, next) => {
  try {
    res.status(201).json(await teamChatService.createGroup(await viewerOf(req), req.body.title, req.body.memberIds));
  } catch (err) { next(err); }
});

teamChatRouter.get('/conversations/:id', validate({ params: uuidParam }), async (req, res, next) => {
  try {
    res.json(await teamChatService.getConversation(await viewerOf(req), param(req, 'id')));
  } catch (err) { next(err); }
});

teamChatRouter.patch('/conversations/:id', validate({ params: uuidParam, body: PatchConversationInput }), async (req, res, next) => {
  try {
    res.json(await teamChatService.updateConversation(await viewerOf(req), param(req, 'id'), req.body));
  } catch (err) { next(err); }
});

teamChatRouter.post('/conversations/:id/members', validate({ params: uuidParam, body: AddMembersInput }), async (req, res, next) => {
  try {
    res.json(await teamChatService.addGroupMembers(await viewerOf(req), param(req, 'id'), req.body.userIds));
  } catch (err) { next(err); }
});

teamChatRouter.delete('/conversations/:id/members/:userId', validate({ params: MemberParams }), async (req, res, next) => {
  try {
    await teamChatService.removeGroupMember(await viewerOf(req), param(req, 'id'), param(req, 'userId'));
    res.status(204).end();
  } catch (err) { next(err); }
});

teamChatRouter.get('/conversations/:id/messages', validate({ params: uuidParam, query: PageQuery }), async (req, res, next) => {
  try {
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : undefined;
    res.json(await teamChatService.listMessages(await viewerOf(req), param(req, 'id'), before));
  } catch (err) { next(err); }
});

teamChatRouter.post('/conversations/:id/messages', validate({ params: uuidParam, body: SendInput }), async (req, res, next) => {
  try {
    res.status(201).json(await teamChatService.sendMessage(await viewerOf(req), param(req, 'id'), req.body));
  } catch (err) { next(err); }
});

teamChatRouter.post('/conversations/:id/read', validate({ params: uuidParam }), async (req, res, next) => {
  try {
    await teamChatService.markRead(await viewerOf(req), param(req, 'id'));
    res.status(204).end();
  } catch (err) { next(err); }
});

teamChatRouter.patch('/messages/:id', validate({ params: uuidParam, body: EditInput }), async (req, res, next) => {
  try {
    res.json(await teamChatService.editMessage(await viewerOf(req), param(req, 'id'), req.body.body, req.body.mentions));
  } catch (err) { next(err); }
});

teamChatRouter.post('/messages/:id/delete', validate({ params: uuidParam, body: DeleteInput }), async (req, res, next) => {
  try {
    const message = await teamChatService.deleteMessage(await viewerOf(req), param(req, 'id'), req.body.scope);
    if (message) res.json(message);
    else res.status(204).end();
  } catch (err) { next(err); }
});

teamChatRouter.get('/matters/:caseId', validate({ params: CaseParam }), async (req, res, next) => {
  try {
    res.json(await teamChatService.getMatterDiscussion(await viewerOf(req), param(req, 'caseId')));
  } catch (err) { next(err); }
});

teamChatRouter.post('/matters/:caseId/members', validate({ params: CaseParam, body: AddMatterMemberInput }), async (req, res, next) => {
  try {
    res.json(await teamChatService.addMatterMember(await viewerOf(req), param(req, 'caseId'), req.body.userId));
  } catch (err) { next(err); }
});

teamChatRouter.delete('/matters/:caseId/members/:userId', validate({ params: CaseMemberParams }), async (req, res, next) => {
  try {
    res.json(await teamChatService.removeMatterMember(await viewerOf(req), param(req, 'caseId'), param(req, 'userId')));
  } catch (err) { next(err); }
});
