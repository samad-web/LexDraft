import { useEffect, useMemo, useState } from 'react';
import {
  useAddFilingParty,
  useDeleteFilingParty,
  useEfilingPortalStates,
  useFilingParticulars,
  useSaveCaseFacts,
  useUpdateFilingParticulars,
  useUpdateFilingParty,
  type FilingAct,
  type FilingParticulars,
  type FilingParty,
  type MactDetails,
  type ParticularsExtraKey,
  type ParticularsPatch,
  type PartyInput,
} from '@/hooks/useEfiling';
import { useEcourtsCaseTypes } from '@/hooks/useEcourts';
import { CourtScopePicker, type CourtScopeValue } from '@/components/ecourts/CourtScopePicker';
import { errMsg, numOrNull, orNull } from './format';
import {
  LocalLanguageBlock,
  PButton,
  PCheck,
  PField,
  PRadios,
  PortalButtons,
  PortalGrid,
  PortalNote,
  PortalSection,
  PortalTable,
  PortalTitle,
  type PortalColumn,
} from './PortalUi';

// =============================================================================
// ParticularsEditor — the data behind the eFiling portal's New Case Filing
// wizard, laid out tab by tab exactly as the portal shows it (eFiling 3.0
// user manual §6.2): Initial Inputs, Litigant, Legal Heir, Fact Details,
// Case Details, MVC. Stored per matter in LexDraft so it is prepared once,
// checked by the readiness report, and reused for every filing on the matter.
// =============================================================================

const MACT_RE = /\bM\.?\s?A\.?\s?C\.?\s?(T|P|OP)?\b|\bMVC\b|\bM\.?\s?V\.?\s?O\.?\s?P\b|motor\s+(accident|vehicle)/i;

/** The portal's "Relief Sought" list (Initial Inputs > Case Types). */
const RELIEF_OPTIONS = [
  'Suit', 'Appeal', 'Revision', 'Petition', 'Application', 'Complaint', 'Execution', 'Arbitration', 'Compensation', 'Criminal Appeal', 'Other',
] as const;
const isAppellate = (relief: string | null | undefined) => /appeal|revision/i.test(relief ?? '');

/** One tab of the portal's New Case Filing wizard, or everything at once. */
export type ParticularsSection = 'all' | 'initial' | 'litigant' | 'legal_heir' | 'facts' | 'case_details' | 'mvc';

export function isMactCase(p: Pick<FilingParticulars, 'caseTypeName' | 'caseTypeCode'> | null | undefined): boolean {
  return Boolean(p && MACT_RE.test(`${p.caseTypeName ?? ''} ${p.caseTypeCode ?? ''}`));
}

interface WizardNav {
  /** The tab's own Prev / Next buttons move the wizard (omitted on the full editor). */
  onPrev?: () => void;
  onNext?: () => void;
  /** Called after any save on the tab succeeds. */
  onSaved?: () => void;
}

export function ParticularsEditor({ caseId, section = 'all', onPrev, onNext, onSaved }: { caseId: string; section?: ParticularsSection } & WizardNav) {
  const { data, isLoading, isError } = useFilingParticulars(caseId);
  if (isLoading) return <p className="body-sm muted">Loading particulars…</p>;
  if (isError || !data) return <p className="body-sm" style={{ color: 'var(--danger)' }}>Could not load the filing particulars.</p>;
  const facts = data.facts.map((f) => ({ factDate: f.factDate, factTime: f.factTime, description: f.description }));
  const nav: WizardNav = { onPrev, onNext, onSaved };
  const formPart: FormPart | null = section === 'all' || section === 'initial' || section === 'case_details' || section === 'mvc' ? section : null;
  return (
    <div className="col" style={{ gap: 24 }}>
      {section === 'all' || section === 'initial' ? (
        <CaseParticularsForm caseId={caseId} particulars={data.particulars} parties={data.parties} part={section === 'all' ? 'all' : 'initial'} nav={nav} />
      ) : null}
      {section === 'all' || section === 'litigant' ? <PartiesSection caseId={caseId} parties={data.parties} nav={nav} /> : null}
      {section === 'all' || section === 'legal_heir' ? <LegalHeirSection caseId={caseId} parties={data.parties} nav={nav} /> : null}
      {section === 'all' || section === 'facts' ? <FactsSection caseId={caseId} facts={facts} nav={nav} /> : null}
      {formPart && formPart !== 'all' && formPart !== 'initial' ? (
        <CaseParticularsForm caseId={caseId} particulars={data.particulars} parties={data.parties} part={formPart} nav={nav} />
      ) : null}
    </div>
  );
}

function Message({ text }: { text: string | null }) {
  if (!text) return null;
  const bad = !/^(Saved|Submitted)/.test(text);
  return <p className="body-sm" role="status" style={{ textAlign: 'center', color: bad ? 'var(--danger)' : 'var(--text-secondary)' }}>{text}</p>;
}

// ---- Initial Inputs, Case Details, MVC (the particulars row) -------------------

type FormPart = 'all' | 'initial' | 'case_details' | 'mvc';

function CaseParticularsForm({ caseId, particulars, parties, part, nav }: {
  caseId: string;
  particulars: FilingParticulars | null;
  parties: FilingParty[];
  part: FormPart;
  nav: WizardNav;
}) {
  const showPart = (s: FormPart) => part === 'all' || part === s;
  const save = useUpdateFilingParticulars(caseId);
  const updateParty = useUpdateFilingParty(caseId);
  const portalStates = useEfilingPortalStates();
  const portalCodes = useMemo(() => new Set((portalStates.data ?? []).map((s) => s.code)), [portalStates.data]);

  const [p, setP] = useState<ParticularsPatch>({});
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [localPlaint, setLocalPlaint] = useState(false);
  // Load from the server on first render and after a save - never over
  // unsaved typing (a background refetch used to reset the whole form).
  const serverKey = JSON.stringify(particulars ?? null);
  const loadFromServer = () => {
    if (!particulars) {
      setP({ acts: [], hideParty: false, isUrgent: false, extra: {} });
      setLocalPlaint(false);
      return;
    }
    const { caseId: _caseId, updatedAt: _updatedAt, ...editable } = particulars;
    setP({ ...editable, extra: { ...(editable.extra ?? {}) } });
    setLocalPlaint(Boolean(editable.localLanguage || editable.plaintLocal));
  };
  useEffect(() => {
    if (dirty) return;
    loadFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  const set = (patch: ParticularsPatch) => {
    setDirty(true);
    setP((cur) => ({ ...cur, ...patch }));
  };
  const extra = p.extra ?? {};
  const ex = (k: ParticularsExtraKey) => extra[k] ?? '';
  const setEx = (k: ParticularsExtraKey, v: string) => {
    setDirty(true);
    setP((cur) => ({ ...cur, extra: { ...(cur.extra ?? {}), [k]: v } }));
  };

  // Initial Inputs > Party Details: the client party's name and mobile.
  // The portal's "Plaintiff" is the main filing party: our client on the
  // petitioner side, else the first petitioner (parties list respondents first).
  const client = parties.find((x) => x.isClient && x.side === 'petitioner')
    ?? parties.find((x) => x.side === 'petitioner' && !x.legalHeirOf)
    ?? parties.find((x) => x.isClient)
    ?? null;
  const [clientDraft, setClientDraft] = useState<{ name: string; mobile: string } | null>(null);
  const clientName = clientDraft?.name ?? client?.name ?? '';
  const clientMobile = clientDraft?.mobile ?? client?.mobile ?? '';

  const scope: CourtScopeValue = {
    court: p.courtTier ?? 'DC',
    stateCode: p.stateCode ?? '',
    distCode: p.districtCode ?? '',
    complexCode: p.courtComplexCode ?? '',
    courtCode: p.courtCode != null ? String(p.courtCode) : '',
    estCode: p.estCode ?? '',
  };
  const caseTypes = useEcourtsCaseTypes(scope.stateCode, scope.distCode, scope.courtCode, scope.court);
  const acts = p.acts ?? [];
  const isMact = MACT_RE.test(`${p.caseTypeName ?? ''} ${p.caseTypeCode ?? ''}`);
  const mact: MactDetails = p.mact ?? {};
  const setMact = (patch: Partial<MactDetails>) => set({ mact: { ...mact, ...patch } });
  const relief = ex('reliefSought');
  const appellate = isAppellate(relief);

  const onSave = async (done: string) => {
    setMessage(null);
    try {
      const { acts: rawActs, extra: rawExtra, ...rest } = p;
      const body: ParticularsPatch = { ...rest, acts: (rawActs ?? []).filter((a) => a.act.trim()) };
      if (rawExtra && Object.keys(rawExtra).length > 0) body.extra = rawExtra;
      if (!localPlaint && part !== 'initial') {
        body.localLanguage = null;
        body.plaintLocal = null;
      }
      await save.mutateAsync(body);
      if (clientDraft && client) {
        await updateParty.mutateAsync({ id: client.id, patch: { name: clientDraft.name.trim() || client.name, mobile: orNull(clientDraft.mobile.replace(/\s+/g, '')) } });
        setClientDraft(null);
      }
      setDirty(false);
      setMessage(done);
      nav.onSaved?.();
    } catch (err) {
      setMessage(errMsg(err, 'Could not save'));
    }
  };
  const pending = save.isPending || updateParty.isPending;

  const initial = (
    <>
      <PortalSection title="District/Establishment" note="Note: Following fields are Compulsar">
        <CourtScopePicker
          value={scope}
          stateFilter={portalCodes.size > 0 ? (c) => portalCodes.has(c) : undefined}
          onChange={(v) => set({
            courtTier: v.court,
            stateCode: v.stateCode === '' ? null : v.stateCode,
            districtCode: v.distCode === '' ? null : v.distCode,
            courtComplexCode: v.complexCode || null,
            courtCode: v.courtCode ? Number(v.courtCode) : null,
            estCode: v.estCode || null,
          })}
        />
        <PortalGrid>
          <PField label="Court name (as on the portal)">
            <input className="input" value={p.establishmentName ?? ''} onChange={(e) => set({ establishmentName: orNull(e.target.value) })} />
          </PField>
          <PCheck label="Urgent matter" checked={!!p.isUrgent} onChange={(v) => set({ isUrgent: v })} />
          {scope.court === 'HC' ? (
            <>
              <PField label="Matter type">
                <input className="input" placeholder="e.g. Writ Petition, Criminal Appeal" value={p.hcMatterType ?? ''} onChange={(e) => set({ hcMatterType: orNull(e.target.value) })} />
              </PField>
              <PField label="Bench">
                <input className="input" placeholder="e.g. Principal Seat, Madurai Bench" value={p.hcBench ?? ''} onChange={(e) => set({ hcBench: orNull(e.target.value) })} />
              </PField>
            </>
          ) : null}
        </PortalGrid>
      </PortalSection>

      <PortalSection title="Case Types" note="Note: Following fields are Compulsar">
        <PortalGrid>
          <PRadios
            label="Case Type"
            required
            name={`case-side-${caseId}`}
            value={p.hcSide ?? null}
            options={[{ value: 'civil', label: 'Civil' }, { value: 'criminal', label: 'Criminal' }]}
            onChange={(v) => set({ hcSide: v })}
          />
          <span />
          <PField label="Relief Sought" required>
            <select className="input" value={relief} onChange={(e) => setEx('reliefSought', e.target.value)}>
              <option value="">Select Case</option>
              {RELIEF_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              {relief && !(RELIEF_OPTIONS as readonly string[]).includes(relief) ? <option value={relief}>{relief}</option> : null}
            </select>
          </PField>
          <PField label="Case Type" required>
            {caseTypes.data && caseTypes.data.length > 0 ? (
              <select
                className="input"
                value={p.caseTypeCode ?? ''}
                onChange={(e) => {
                  const opt = caseTypes.data?.find((o) => o.code === e.target.value);
                  set({ caseTypeCode: e.target.value || null, caseTypeName: opt?.name ?? p.caseTypeName ?? null });
                }}
              >
                <option value="">{p.caseTypeName ? `${p.caseTypeName} (pick to confirm)` : 'Select an Option'}</option>
                {caseTypes.data.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
              </select>
            ) : (
              <input
                className="input"
                value={p.caseTypeName ?? ''}
                placeholder={caseTypes.isFetching ? 'Loading case types…' : 'e.g. O.S., M.A.C.T. O.P., Crl.M.P.'}
                onChange={(e) => set({ caseTypeName: orNull(e.target.value) })}
              />
            )}
          </PField>
        </PortalGrid>
      </PortalSection>

      {appellate ? (
        <PortalSection title="Subordinate Court">
          <PortalGrid>
            <PField label="District"><input className="input" value={ex('subCourtDistrict')} onChange={(e) => setEx('subCourtDistrict', e.target.value)} /></PField>
            <PField label="Select Establishment"><input className="input" value={ex('subCourtEstablishment')} onChange={(e) => setEx('subCourtEstablishment', e.target.value)} /></PField>
            <PField label="Case Type"><input className="input" value={ex('subCourtCaseType')} onChange={(e) => setEx('subCourtCaseType', e.target.value)} /></PField>
            <div className="row" style={{ gap: 10 }}>
              <PField label="Case Number"><input className="input" value={ex('subCourtCaseNo')} onChange={(e) => setEx('subCourtCaseNo', e.target.value)} /></PField>
              <PField label="Year"><input className="input" inputMode="numeric" style={{ width: 100 }} value={ex('subCourtCaseYear')} onChange={(e) => setEx('subCourtCaseYear', e.target.value.replace(/\D/g, '').slice(0, 4))} /></PField>
            </div>
            <PField label="Disposal Date"><input className="input" type="date" value={ex('subCourtDisposalDate')} onChange={(e) => setEx('subCourtDisposalDate', e.target.value)} /></PField>
            <span />
            <PField label="CC Applied Date"><input className="input" type="date" value={ex('subCourtCcAppliedDate')} onChange={(e) => setEx('subCourtCcAppliedDate', e.target.value)} /></PField>
            <PField label="CC Ready Date"><input className="input" type="date" value={ex('subCourtCcReadyDate')} onChange={(e) => setEx('subCourtCcReadyDate', e.target.value)} /></PField>
          </PortalGrid>
        </PortalSection>
      ) : null}

      <PortalSection title="Party Details" note="Note: Following fields are Compulsar">
        {client ? (
          <PortalGrid>
            <PField label={appellate ? 'Appellant/Respondent' : 'Plaintiff'} required>
              <input className="input" value={clientName} onChange={(e) => { setDirty(true); setClientDraft({ name: e.target.value, mobile: clientMobile }); }} />
            </PField>
            <PField label="Mobile Number" required>
              <input className="input" inputMode="tel" value={clientMobile} onChange={(e) => { setDirty(true); setClientDraft({ name: clientName, mobile: e.target.value }); }} />
            </PField>
          </PortalGrid>
        ) : null}
        <ClientPicker caseId={caseId} parties={parties} />
      </PortalSection>
    </>
  );

  const caseDetails = (
    <>
      <PortalGrid>
        <PField label="Cause of Action" required>
          <textarea className="input" rows={3} placeholder="cause of action" value={p.causeOfAction ?? ''} onChange={(e) => set({ causeOfAction: orNull(e.target.value) })} />
        </PField>
        <PField label="Date of Cause of Action" required>
          <input className="input" type="date" value={p.causeOfActionDate ?? ''} onChange={(e) => set({ causeOfActionDate: e.target.value || null })} />
        </PField>
        <PField label="Important Information or Subject or Reason">
          <input className="input" value={p.subject ?? ''} onChange={(e) => set({ subject: orNull(e.target.value) })} />
        </PField>
        <PField label="Prayer">
          <textarea className="input" rows={4} value={p.prayer ?? ''} onChange={(e) => set({ prayer: orNull(e.target.value) })} />
        </PField>
        <PField label="Valuation [₹]">
          <input className="input" inputMode="decimal" value={p.valuationInr ?? ''} onChange={(e) => set({ valuationInr: numOrNull(e.target.value) })} />
        </PField>
        <PCheck label="Plaint in Local Language" checked={localPlaint} onChange={(v) => { setDirty(true); setLocalPlaint(v); }} />
        {localPlaint ? (
          <>
            <PField label="Local language">
              <input className="input" placeholder="e.g. Malayalam, Hindi" value={p.localLanguage ?? ''} onChange={(e) => set({ localLanguage: orNull(e.target.value) })} />
            </PField>
            <PField label={`Plaint in ${p.localLanguage || 'local language'}`} wide>
              <textarea className="input" rows={3} value={p.plaintLocal ?? ''} onChange={(e) => set({ plaintLocal: orNull(e.target.value) })} />
            </PField>
          </>
        ) : null}
      </PortalGrid>

      <PortalSection title="Dispute Arising Out Of">
        <PortalGrid>
          <PField label="State"><input className="input" value={ex('disputeState')} onChange={(e) => setEx('disputeState', e.target.value)} /></PField>
          <PField label="District"><input className="input" value={ex('disputeDistrict')} onChange={(e) => setEx('disputeDistrict', e.target.value)} /></PField>
          <PField label="Taluka"><input className="input" value={ex('disputeTaluka')} onChange={(e) => setEx('disputeTaluka', e.target.value)} /></PField>
          <PField label="Village"><input className="input" value={ex('disputeVillage')} onChange={(e) => setEx('disputeVillage', e.target.value)} /></PField>
        </PortalGrid>
      </PortalSection>

      <PortalSection title="Act Details">
        <div className="col" style={{ gap: 10 }}>
          {acts.map((a, i) => (
            <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'center' }}>
              <div style={{ flex: 2, minWidth: 220 }}>
                <PField label={`Act${i + 1}`} required>
                  <input className="input" value={a.act} onChange={(e) => set({ acts: acts.map((x, j) => (j === i ? { ...x, act: e.target.value } : x)) })} />
                </PField>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <PField label={`Section${i + 1}`} required>
                  <input className="input" value={a.section} onChange={(e) => set({ acts: acts.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)) })} />
                </PField>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ acts: acts.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div style={{ textAlign: 'center' }}>
            <PButton onClick={() => set({ acts: [...acts, { act: '', section: '' } as FilingAct] })}>+ More Acts...</PButton>
          </div>
        </div>
      </PortalSection>

      <LocalLanguageBlock language={p.localLanguage}>
        <PortalGrid>
          <PField label="Cause of action in local language">
            <textarea className="input" rows={2} value={ex('causeOfActionLocal')} onChange={(e) => setEx('causeOfActionLocal', e.target.value)} />
          </PField>
          <PField label="Prayer in local language">
            <textarea className="input" rows={2} value={ex('prayerLocal')} onChange={(e) => setEx('prayerLocal', e.target.value)} />
          </PField>
          <PField label="Important information in local language">
            <input className="input" value={ex('subjectLocal')} onChange={(e) => setEx('subjectLocal', e.target.value)} />
          </PField>
        </PortalGrid>
      </LocalLanguageBlock>

      <PortalSection title="Additional (LexDraft)">
        <PortalGrid>
          <PField label="Claim amount (₹)">
            <input className="input" inputMode="decimal" value={p.claimAmountInr ?? ''} onChange={(e) => set({ claimAmountInr: numOrNull(e.target.value) })} />
          </PField>
          <PField label="Place where the dispute arose">
            <input className="input" value={p.disputePlace ?? ''} onChange={(e) => set({ disputePlace: orNull(e.target.value) })} />
          </PField>
          <PField label="Relief particulars" wide>
            <textarea className="input" rows={2} value={p.reliefParticulars ?? ''} onChange={(e) => set({ reliefParticulars: orNull(e.target.value) })} />
          </PField>
          <PCheck label="Hide party identity (POCSO, matrimonial, victim protection)" checked={!!p.hideParty} onChange={(v) => set({ hideParty: v })} />
          {p.hideParty ? (
            <PField label="Reason for hiding identity">
              <input className="input" value={p.hidePartyReason ?? ''} onChange={(e) => set({ hidePartyReason: orNull(e.target.value) })} />
            </PField>
          ) : null}
        </PortalGrid>
      </PortalSection>
    </>
  );

  const mvc = (
    <>
      <PortalSection title="MVC Information">
        <PortalGrid>
          <PField label="Item Number"><input className="input" value={mact.itemNo ?? ''} onChange={(e) => setMact({ itemNo: orNull(e.target.value) })} /></PField>
          <PCheck label="Other Police Station" checked={!!mact.otherPoliceStation} onChange={(v) => setMact({ otherPoliceStation: v })} />
          <PField label="State" required><input className="input" value={mact.policeState ?? ''} onChange={(e) => setMact({ policeState: orNull(e.target.value) })} /></PField>
          <PField label="District" required><input className="input" value={mact.policeDistrict ?? ''} onChange={(e) => setMact({ policeDistrict: orNull(e.target.value) })} /></PField>
          <PField label="Taluka" required><input className="input" value={mact.policeTaluka ?? ''} onChange={(e) => setMact({ policeTaluka: orNull(e.target.value) })} /></PField>
          <span />
          <PField label="Police Station" required><input className="input" value={mact.policeStation ?? ''} onChange={(e) => setMact({ policeStation: orNull(e.target.value) })} /></PField>
          <PField label="FIR Type">
            <select className="input" value={mact.firType ?? ''} onChange={(e) => setMact({ firType: orNull(e.target.value) })}>
              <option value="">Select</option>
              {['FIR', 'GD', 'NCR'].map((t) => <option key={t} value={t}>{t}</option>)}
              {mact.firType && !['FIR', 'GD', 'NCR'].includes(mact.firType) ? <option value={mact.firType}>{mact.firType}</option> : null}
            </select>
          </PField>
          <PField label="FIR Number" required><input className="input" value={mact.firNo ?? ''} onChange={(e) => setMact({ firNo: orNull(e.target.value) })} /></PField>
          <PField label="Year" required><input className="input" inputMode="numeric" value={mact.firYear ?? ''} onChange={(e) => setMact({ firYear: numOrNull(e.target.value) })} /></PField>
        </PortalGrid>
      </PortalSection>
      <PortalSection title="Accident Information">
        <PortalGrid>
          <PField label="Date of Accident" required><input className="input" type="date" value={mact.accidentDate ?? ''} onChange={(e) => setMact({ accidentDate: e.target.value || null })} /></PField>
          <PField label="Time of Accident"><input className="input" type="time" value={mact.accidentTime ?? ''} onChange={(e) => setMact({ accidentTime: e.target.value || null })} /></PField>
          <PField label="Place of Accident" required><input className="input" value={mact.accidentPlace ?? ''} onChange={(e) => setMact({ accidentPlace: orNull(e.target.value) })} /></PField>
          <span />
          <PRadios
            label="Type of Injury"
            name={`injury-${caseId}`}
            value={mact.injuryType ?? null}
            options={[{ value: 'simple', label: 'Simple' }, { value: 'serious', label: 'Serious' }, { value: 'death', label: 'Death' }, { value: 'other', label: 'Other' }]}
            onChange={(v) => setMact({ injuryType: v })}
          />
          <PField label="Name"><input className="input" value={mact.injuredName ?? ''} onChange={(e) => setMact({ injuredName: orNull(e.target.value) })} /></PField>
        </PortalGrid>
      </PortalSection>
      <PortalSection title="Claim Information">
        <PortalGrid>
          <PField label="Compensation Claimed"><input className="input" inputMode="decimal" value={mact.compensationClaimedInr ?? ''} onChange={(e) => setMact({ compensationClaimedInr: numOrNull(e.target.value) })} /></PField>
          <PField label="Insurance Company"><input className="input" value={mact.insurer ?? ''} onChange={(e) => setMact({ insurer: orNull(e.target.value) })} /></PField>
        </PortalGrid>
      </PortalSection>
      <PortalSection title="Vehicle Information">
        <PortalGrid>
          <PField label="Vehicle Type"><input className="input" value={mact.vehicleType ?? ''} onChange={(e) => setMact({ vehicleType: orNull(e.target.value) })} /></PField>
          <PField label="Vehicle Regn. No."><input className="input" value={mact.vehicleRegNo ?? ''} onChange={(e) => setMact({ vehicleRegNo: orNull(e.target.value) })} /></PField>
          <PField label="Driving License"><input className="input" value={mact.drivingLicenceNo ?? ''} onChange={(e) => setMact({ drivingLicenceNo: orNull(e.target.value) })} /></PField>
          <PField label="Issuing Authority"><input className="input" value={mact.licenceIssuingAuthority ?? ''} onChange={(e) => setMact({ licenceIssuingAuthority: orNull(e.target.value) })} /></PField>
        </PortalGrid>
      </PortalSection>
    </>
  );

  if (part === 'initial') {
    return (
      <section className="col" style={{ gap: 18 }}>
        {initial}
        <PortalButtons>
          <PButton primary onClick={() => { void onSave('Submitted.'); }} disabled={pending}>{pending ? 'Saving…' : 'Submit'}</PButton>
          <PButton onClick={() => { setDirty(false); setClientDraft(null); setMessage(null); loadFromServer(); }}>Reset</PButton>
        </PortalButtons>
        <Message text={message} />
      </section>
    );
  }

  if (part === 'case_details') {
    return (
      <section className="col" style={{ gap: 18 }}>
        <PortalNote>*Note: Case detail tab is compulsary</PortalNote>
        <PortalTitle>Case Details</PortalTitle>
        {caseDetails}
        <PortalButtons>
          <PButton primary onClick={() => { void onSave('Saved.'); }} disabled={pending}>{pending ? 'Saving…' : 'Save'}</PButton>
          {nav.onPrev ? <PButton onClick={nav.onPrev}>Prev</PButton> : null}
          {nav.onNext ? <PButton onClick={nav.onNext}>Next</PButton> : null}
        </PortalButtons>
        <Message text={message} />
      </section>
    );
  }

  if (part === 'mvc') {
    return (
      <section className="col" style={{ gap: 18 }}>
        <PortalNote>*Note: You can skip MVC tab by clicking Next button</PortalNote>
        <PortalTitle>Motor Vehicle Challan</PortalTitle>
        {isMact ? mvc : (
          <p className="body-sm muted">The MVC tab applies only to motor accident claims. Choose a M.A.C.T. case type under Initial Inputs to use it.</p>
        )}
        <PortalButtons>
          {isMact ? <PButton primary onClick={() => { void onSave('Saved.'); }} disabled={pending}>{pending ? 'Saving…' : 'Save'}</PButton> : null}
          {nav.onPrev ? <PButton onClick={nav.onPrev}>Prev</PButton> : null}
          {nav.onNext ? <PButton onClick={nav.onNext}>Next</PButton> : null}
        </PortalButtons>
        <Message text={message} />
      </section>
    );
  }

  // The full editor (filing detail page): every particulars part, one save.
  return (
    <section className="col" style={{ gap: 18 }}>
      <PortalTitle>Initial Inputs</PortalTitle>
      {initial}
      <PortalTitle>Case Details</PortalTitle>
      {caseDetails}
      {isMact ? (<><PortalTitle>Motor Vehicle Challan</PortalTitle>{mvc}</>) : null}
      <PortalButtons>
        <PButton primary onClick={() => { void onSave('Saved.'); }} disabled={pending}>{pending ? 'Saving…' : 'Save court and case details'}</PButton>
      </PortalButtons>
      <Message text={message} />
    </section>
  );
}

// ---- Litigant tab ------------------------------------------------------------------

const EMPTY_PARTY: PartyInput = {
  side: 'petitioner', isClient: false, isOrganization: false, name: '', relationType: null, relationName: null, gender: null,
  age: null, dateOfBirth: null, occupation: null, address: null, district: null, state: null, pinCode: null,
  mobile: null, email: null, isMinor: false, guardianName: null, orgRepresentative: null, legalHeirOf: null,
  nameLocal: null, addressLocal: null, extra: {},
};

const sideLabel = (side: FilingParty['side']) => (side === 'petitioner' ? 'Petitioner' : 'Respondent');

function PartiesSection({ caseId, parties, nav }: { caseId: string; parties: FilingParty[]; nav: WizardNav }) {
  const [editing, setEditing] = useState<string | 'new-petitioner' | 'new-respondent' | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);
  const del = useDeleteFilingParty(caseId);
  const remove = (party: FilingParty) => { if (window.confirm(`Remove ${party.name}?`)) del.mutate(party.id); };
  const saved = parties.filter((x) => !x.legalHeirOf);

  const columns: ReadonlyArray<PortalColumn<FilingParty>> = [
    { key: 'sr', header: 'Sr. No.', cell: (_r, i) => i + 1, width: 70 },
    { key: 'name', header: 'Party Name', cell: (r) => r.name, text: (r) => r.name },
    { key: 'type', header: 'Type', cell: (r) => `${r.position === 0 ? 'Main' : 'Extra'} ${sideLabel(r.side)}`, text: (r) => sideLabel(r.side) },
    { key: 'edit', header: 'Edit', cell: (r) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(r.id); setShowPrevious(false); }}>✎ Edit</button> },
    { key: 'delete', header: 'Delete', cell: (r) => <button type="button" className="btn btn-ghost btn-sm" disabled={del.isPending} onClick={() => remove(r)}>Delete</button> },
  ];

  return (
    <section className="col" style={{ gap: 14 }}>
      <PortalNote>Note: This tab is compulsary</PortalNote>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1 }} />
        <span style={{ flex: 2 }}><PortalTitle>Litigant</PortalTitle></span>
        <span style={{ flex: 1, textAlign: 'right' }}>
          {saved.length > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm" style={{ textDecoration: 'underline' }} onClick={() => setShowPrevious((s) => !s)} aria-expanded={showPrevious}>
              View Previous Parties ({saved.length})
            </button>
          ) : null}
        </span>
      </div>
      {showPrevious ? <PortalTable rows={saved} columns={columns} label="Previous parties" /> : null}

      {(['petitioner', 'respondent'] as const).map((side) => {
        const list = parties.filter((x) => x.side === side && !x.legalHeirOf);
        return (
          <div key={side} className="col" style={{ gap: 8 }}>
            <span className="body-sm" style={{ fontWeight: 700 }}>{side === 'petitioner' ? 'Petitioners / appellants / complainants' : 'Respondents / accused'}</span>
            {list.length === 0 ? <p className="body-sm muted">None yet.</p> : null}
            {list.map((party) => (
              editing === party.id ? (
                <PartyForm key={party.id} caseId={caseId} parties={parties} initial={party} onDone={() => setEditing((cur) => (cur === party.id ? null : cur))} onSaved={nav.onSaved} />
              ) : (
                <PartyRow key={party.id} party={party} parties={parties} onEdit={() => setEditing(party.id)} onRemove={() => remove(party)} removing={del.isPending} />
              )
            ))}
            {editing === `new-${side}` ? (
              <PartyForm caseId={caseId} parties={parties} initial={{ ...EMPTY_PARTY, side }} onDone={() => setEditing((cur) => (cur === `new-${side}` ? null : cur))} onSaved={nav.onSaved} />
            ) : (
              <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(`new-${side}`)}>+ Add {side}</button></div>
            )}
          </div>
        );
      })}

      {nav.onNext || nav.onPrev ? (
        <PortalButtons>
          {nav.onPrev ? <PButton onClick={nav.onPrev}>Prev</PButton> : null}
          {nav.onNext ? <PButton onClick={nav.onNext}>Next</PButton> : null}
        </PortalButtons>
      ) : null}
    </section>
  );
}

function PartyRow({ party, parties, onEdit, onRemove, removing }: { party: FilingParty; parties: FilingParty[]; onEdit: () => void; onRemove: () => void; removing: boolean }) {
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
      <div className="col" style={{ flex: 1, gap: 2 }}>
        <span className="body-sm">
          {party.name}
          {party.isClient ? <span className="badge badge-sage" style={{ marginLeft: 8, fontSize: 10 }}>Our client</span> : null}
          {party.legalHeirOf ? <span className="muted"> · legal heir of {parties.find((x) => x.id === party.legalHeirOf)?.name ?? '?'}</span> : null}
        </span>
        <span className="body-sm muted">
          {[party.isOrganization ? 'Organisation' : null, party.gender, party.age != null ? `${party.age} yrs` : null,
            party.relationType && party.relationName ? `${party.relationType} ${party.relationName}` : null, party.mobile]
            .filter(Boolean).join(' · ') || 'Details missing'}
        </span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={removing} onClick={onRemove}>Remove</button>
    </div>
  );
}

// ---- Initial Inputs: Party (client) Details -----------------------------------

/** The portal's Initial Inputs asks which party you appear for. */
function ClientPicker({ caseId, parties }: { caseId: string; parties: FilingParty[] }) {
  const update = useUpdateFilingParty(caseId);
  // Show the tick immediately; the server catches up a moment later.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setPending((cur) => {
      const next = { ...cur };
      for (const x of parties) if (next[x.id] === x.isClient) delete next[x.id];
      return next;
    });
  }, [parties]);
  if (parties.length === 0) {
    return <p className="body-sm muted">Party (client) details: add the parties under the Litigant tab, then mark your client here.</p>;
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="body-sm" style={{ fontWeight: 600 }}>Our client</span>
      <span className="body-sm muted">Tick the party you appear for. Vakalat is executed for them.</span>
      {parties.map((x) => (
        <label key={x.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={pending[x.id] ?? x.isClient}
            onChange={(e) => {
              const value = e.target.checked;
              setPending((cur) => ({ ...cur, [x.id]: value }));
              update.mutate(
                { id: x.id, patch: { isClient: value } },
                { onError: () => setPending((cur) => { const next = { ...cur }; delete next[x.id]; return next; }) },
              );
            }}
          />
          <span className="body-sm">{x.name} <span className="muted">({x.side === 'petitioner' ? 'petitioner' : 'respondent'})</span></span>
        </label>
      ))}
    </div>
  );
}

// ---- Legal Heir tab ---------------------------------------------------------------

function LegalHeirSection({ caseId, parties, nav }: { caseId: string; parties: FilingParty[]; nav: WizardNav }) {
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const del = useDeleteFilingParty(caseId);
  const heirs = parties.filter((x) => x.legalHeirOf);
  // Parties ticked "Add Legal Heir" on the Litigant tab come first.
  const principals = parties.filter((x) => !x.legalHeirOf).sort((a, b) => Number(b.extra.addLegalHeir === 'Y') - Number(a.extra.addLegalHeir === 'Y'));
  return (
    <section className="col" style={{ gap: 14 }}>
      <PortalNote>*Note: Legal Heir details tab</PortalNote>
      <PortalTitle>Legal Heir</PortalTitle>
      <p className="body-sm muted">For a party who has died: the legal heirs who carry the case on in their place.</p>
      {heirs.length === 0 ? <p className="body-sm muted">No legal heirs added.</p> : null}
      {heirs.map((h) => (
        editing === h.id ? (
          <PartyForm key={h.id} caseId={caseId} parties={parties} initial={h} heirMode onDone={() => setEditing((cur) => (cur === h.id ? null : cur))} onSaved={nav.onSaved} />
        ) : (
          <div key={h.id} className="row" style={{ gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
            <span className="body-sm" style={{ flex: 1 }}>
              {h.name} <span className="muted">· legal heir of {parties.find((x) => x.id === h.legalHeirOf)?.name ?? '?'}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(h.id)}>Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={del.isPending}
              onClick={() => { if (window.confirm(`Remove ${h.name}?`)) del.mutate(h.id); }}>Remove</button>
          </div>
        )
      ))}
      {adding ? (
        <PartyForm
          caseId={caseId}
          parties={parties}
          heirMode
          initial={{ ...EMPTY_PARTY, side: parties.find((x) => x.id === adding)?.side ?? 'petitioner', legalHeirOf: adding }}
          onDone={() => setAdding(null)}
          onSaved={nav.onSaved}
        />
      ) : principals.length > 0 ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {principals.map((x) => (
            <button key={x.id} type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(x.id)}>+ Add legal heir of {x.name}</button>
          ))}
        </div>
      ) : (
        <p className="body-sm muted">Add the parties under the Litigant tab first.</p>
      )}
      {nav.onNext || nav.onPrev ? (
        <PortalButtons>
          {nav.onPrev ? <PButton onClick={nav.onPrev}>Prev</PButton> : null}
          {nav.onNext ? <PButton onClick={nav.onNext}>Next</PButton> : null}
        </PortalButtons>
      ) : null}
    </section>
  );
}

// ---- One party (Litigant / Legal Heir form) -------------------------------------

const OTHER_INFO: ReadonlyArray<[string, string]> = [
  ['passportNo', 'Passport number'],
  ['panNo', 'PAN'],
  ['faxNo', 'Fax'],
  ['alternateAddress', 'Alternate address'],
];

function PartyForm({ caseId, parties, initial, onDone, onSaved, heirMode }: {
  caseId: string;
  parties: FilingParty[];
  initial: PartyInput & { id?: string };
  onDone: () => void;
  onSaved?: () => void;
  /** The Legal Heir tab: "Party Name" (whose heir) on top, "Legal Heir Name". */
  heirMode?: boolean;
}) {
  const add = useAddFilingParty(caseId);
  const update = useUpdateFilingParty(caseId);
  // Only the editable keys: the API rejects id/caseId/position in the body.
  const [f, setF] = useState<PartyInput>(() => {
    const out = { ...EMPTY_PARTY };
    for (const k of Object.keys(EMPTY_PARTY) as Array<keyof PartyInput>) {
      if (initial[k] !== undefined) (out as Record<string, unknown>)[k] = initial[k];
    }
    return out;
  });
  const [otherOpen, setOtherOpen] = useState(() => OTHER_INFO.some(([k]) => Boolean(initial.extra?.[k])));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PartyInput>) => setF((cur) => ({ ...cur, ...patch }));
  const x = (k: string) => f.extra[k] ?? '';
  const setX = (k: string, v: string) => setF((cur) => {
    const next = { ...cur.extra };
    if (v.trim()) next[k] = v;
    else delete next[k];
    return { ...cur, extra: next };
  });
  const pending = add.isPending || update.isPending;
  const uid = initial.id ?? `new-${initial.side}-${initial.legalHeirOf ?? ''}`;

  const onSave = async () => {
    setError(null);
    if (!f.name.trim()) {
      setError(heirMode ? 'Legal Heir Name is required.' : 'Party Name is required.');
      return;
    }
    if (heirMode && !f.legalHeirOf) {
      setError('Choose the party whose legal heir this is.');
      return;
    }
    try {
      const body: PartyInput = { ...f, mobile: f.mobile?.replace(/\s+/g, '') || null };
      if (initial.id) await update.mutateAsync({ id: initial.id, patch: body });
      else await add.mutateAsync(body);
      onSaved?.();
      onDone();
    } catch (err) {
      setError(errMsg(err, 'Could not save the party'));
    }
  };

  const principals = parties.filter((p) => p.id !== initial.id && !p.legalHeirOf);

  return (
    <div className="col" style={{ gap: 16, padding: 14, border: '1px solid var(--border-default)', borderRadius: 8 }}>
      {heirMode ? (
        <PField label="Party Name" required>
          <select className="input" value={f.legalHeirOf ?? ''} onChange={(e) => set({ legalHeirOf: e.target.value || null })}>
            <option value="">Select</option>
            {principals.map((p) => <option key={p.id} value={p.id}>{p.name} [{p.position === 0 ? 'Main' : 'Extra'} {sideLabel(p.side)}]</option>)}
          </select>
        </PField>
      ) : null}

      <PortalGrid>
        <PRadios
          label="Type"
          required
          name={`party-side-${uid}`}
          value={f.side}
          options={[{ value: 'petitioner', label: 'Petitioner' }, { value: 'respondent', label: 'Respondent' }]}
          onChange={(v) => set({ side: v })}
        />
        <PCheck label="Our client (we appear for this party)" checked={f.isClient} onChange={(v) => set({ isClient: v })} />
        {!heirMode ? <PCheck label="Organisation Details" checked={f.isOrganization} onChange={(v) => set({ isOrganization: v })} /> : null}
        {f.isOrganization && !heirMode ? (
          <PField label="Organisation Type" required>
            <input className="input" placeholder="e.g. State Government Departments" value={x('organisationType')} onChange={(e) => setX('organisationType', e.target.value)} />
          </PField>
        ) : null}
      </PortalGrid>

      <PortalSection title="Personal Details">
        <PortalGrid>
          <PField label={heirMode ? 'Legal Heir Name' : f.isOrganization ? 'Organisation Name' : 'Party Name'} required>
            <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </PField>
          {f.isOrganization && !heirMode ? (
            <PField label="Represented by (name and designation)">
              <input className="input" value={f.orgRepresentative ?? ''} onChange={(e) => set({ orgRepresentative: orNull(e.target.value) })} />
            </PField>
          ) : (
            <>
              <PRadios
                label="Gender"
                required
                name={`gender-${uid}`}
                value={f.gender}
                options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'T', label: 'Other' }]}
                onChange={(v) => set({ gender: v })}
              />
              <PField label="Relation">
                <select className="input" value={f.relationType ?? ''} onChange={(e) => set({ relationType: (e.target.value || null) as PartyInput['relationType'] })}>
                  <option value="">Select</option>
                  <option>S/o</option><option>D/o</option><option>W/o</option><option>C/o</option>
                </select>
              </PField>
              <PField label="Name">
                <input className="input" placeholder="Name" value={f.relationName ?? ''} onChange={(e) => set({ relationName: orNull(e.target.value) })} />
              </PField>
              <PField label="Date of Birth" required={heirMode}>
                <input className="input" type="date" value={f.dateOfBirth ?? ''} onChange={(e) => set({ dateOfBirth: e.target.value || null })} />
              </PField>
              <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
                <PField label="Age" required>
                  <input className="input" style={{ width: 90 }} inputMode="numeric" value={f.age ?? ''} onChange={(e) => set({ age: numOrNull(e.target.value) })} />
                </PField>
                <PCheck label="Differently Abled" checked={x('differentlyAbled') === 'Y'} onChange={(v) => setX('differentlyAbled', v ? 'Y' : '')} />
              </div>
              <PField label="Caste">
                <input className="input" value={x('caste')} onChange={(e) => setX('caste', e.target.value)} />
              </PField>
              <PField label="Extra Petitioner Count">
                <input className="input" style={{ width: 90 }} inputMode="numeric" value={x('extraCount')} onChange={(e) => setX('extraCount', e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </PField>
              <PCheck label="Minor" checked={f.isMinor} onChange={(v) => set({ isMinor: v })} />
              {f.isMinor || (f.age != null && f.age < 18) ? (
                <PField label="Guardian / next friend">
                  <input className="input" value={f.guardianName ?? ''} onChange={(e) => set({ guardianName: orNull(e.target.value) })} />
                </PField>
              ) : null}
            </>
          )}
        </PortalGrid>
      </PortalSection>

      <PortalSection title="Contact Details">
        <PortalGrid>
          <PField label="Email"><input className="input" type="email" value={f.email ?? ''} onChange={(e) => set({ email: orNull(e.target.value) })} /></PField>
          <PField label="Mobile No."><input className="input" inputMode="tel" value={f.mobile ?? ''} onChange={(e) => set({ mobile: orNull(e.target.value) })} /></PField>
          <PField label="Occupation"><input className="input" value={f.occupation ?? ''} onChange={(e) => set({ occupation: orNull(e.target.value) })} /></PField>
          <span />
          <PField label="Address" required>
            <textarea className="input" rows={2} placeholder="address" value={f.address ?? ''} onChange={(e) => set({ address: orNull(e.target.value) })} />
          </PField>
          <PField label="Pin Code"><input className="input" inputMode="numeric" value={f.pinCode ?? ''} onChange={(e) => set({ pinCode: orNull(e.target.value) })} /></PField>
          {heirMode ? (
            <>
              <PField label="State"><input className="input" value={f.state ?? ''} onChange={(e) => set({ state: orNull(e.target.value) })} /></PField>
              <PField label="District"><input className="input" value={f.district ?? ''} onChange={(e) => set({ district: orNull(e.target.value) })} /></PField>
              <PField label="Taluka"><input className="input" value={x('taluka')} onChange={(e) => setX('taluka', e.target.value)} /></PField>
              <PField label="Village"><input className="input" value={x('village')} onChange={(e) => setX('village', e.target.value)} /></PField>
            </>
          ) : null}
        </PortalGrid>
      </PortalSection>

      {!heirMode ? (
        <PortalSection title="State Information">
          <PortalGrid>
            <PField label="State"><input className="input" value={f.state ?? ''} onChange={(e) => set({ state: orNull(e.target.value) })} /></PField>
            <PField label="District"><input className="input" value={f.district ?? ''} onChange={(e) => set({ district: orNull(e.target.value) })} /></PField>
            <PField label="Taluka"><input className="input" value={x('taluka')} onChange={(e) => setX('taluka', e.target.value)} /></PField>
            <PField label="Village"><input className="input" value={x('village')} onChange={(e) => setX('village', e.target.value)} /></PField>
          </PortalGrid>
        </PortalSection>
      ) : null}

      <PortalSection title="Other Information">
        <PortalGrid>
          <PCheck label="Other Information" checked={otherOpen} onChange={setOtherOpen} />
          {!heirMode ? (
            <PCheck label="Add Legal Heir" checked={x('addLegalHeir') === 'Y'} onChange={(v) => setX('addLegalHeir', v ? 'Y' : '')} />
          ) : null}
          {otherOpen ? OTHER_INFO.map(([k, label]) => (
            <PField key={k} label={label}>
              <input className="input" value={x(k)} onChange={(e) => setX(k, e.target.value)} />
            </PField>
          )) : null}
          {!heirMode ? (
            <PField label="Legal heir of">
              <select className="input" value={f.legalHeirOf ?? ''} onChange={(e) => set({ legalHeirOf: e.target.value || null })}>
                <option value="">Not a legal heir</option>
                {parties.filter((p) => p.id !== initial.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </PField>
          ) : null}
        </PortalGrid>
      </PortalSection>

      <LocalLanguageBlock language={null}>
        <PortalGrid>
          <PField label="Name in local language"><input className="input" value={f.nameLocal ?? ''} onChange={(e) => set({ nameLocal: orNull(e.target.value) })} /></PField>
          <PField label="Address in local language"><input className="input" value={f.addressLocal ?? ''} onChange={(e) => set({ addressLocal: orNull(e.target.value) })} /></PField>
        </PortalGrid>
      </LocalLanguageBlock>

      {error ? <p className="body-sm" style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p> : null}
      <PortalButtons>
        <PButton primary onClick={() => { void onSave(); }} disabled={pending}>{pending ? 'Saving…' : heirMode ? 'Save' : 'Update'}</PButton>
        <PButton onClick={onDone}>Cancel</PButton>
      </PortalButtons>
    </div>
  );
}

// ---- Fact Details tab ----------------------------------------------------------------

type FactDraft = { factDate: string | null; factTime: string | null; description: string };

function FactsSection({ caseId, facts, nav }: { caseId: string; facts: FactDraft[]; nav: WizardNav }) {
  const save = useSaveCaseFacts(caseId);
  const [rows, setRowsState] = useState<FactDraft[]>(facts);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const serverKey = JSON.stringify(facts);
  useEffect(() => {
    if (!dirty) setRowsState(facts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  const setRows = (next: FactDraft[] | ((cur: FactDraft[]) => FactDraft[])) => {
    setDirty(true);
    setRowsState(next);
  };
  const setRow = (i: number, patch: Partial<FactDraft>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const onSave = async () => {
    setMessage(null);
    try {
      await save.mutateAsync(rows.filter((r) => r.description.trim()));
      setDirty(false);
      setMessage('Saved.');
      nav.onSaved?.();
    } catch (err) {
      setMessage(errMsg(err, 'Could not save facts'));
    }
  };

  return (
    <section className="col" style={{ gap: 14 }}>
      <PortalNote>*Note: Fact details tab is not compulsary</PortalNote>
      <PortalTitle>Fact Details</PortalTitle>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }} aria-label={`Fact ${i + 1}`}>
          <PField label="Sr.No.">
            <input className="input" style={{ width: 60 }} value={i + 1} readOnly tabIndex={-1} />
          </PField>
          <PField label="Fact Date">
            <input className="input" type="date" style={{ width: 160 }} value={r.factDate ?? ''} onChange={(e) => setRow(i, { factDate: e.target.value || null })} />
          </PField>
          <PField label="Fact Time">
            <input className="input" type="time" style={{ width: 120 }} value={r.factTime ?? ''} onChange={(e) => setRow(i, { factTime: e.target.value || null })} />
          </PField>
          <div style={{ flex: 1, minWidth: 240 }}>
            <PField label="Fact">
              <textarea className="input" rows={2} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
            </PField>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div style={{ textAlign: 'center' }}>
        <PButton onClick={() => setRows((cur) => [...cur, { factDate: null, factTime: null, description: '' }])}>+ Add More Fact</PButton>
      </div>
      <PortalButtons>
        <PButton primary onClick={() => { void onSave(); }} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</PButton>
        {nav.onPrev ? <PButton onClick={nav.onPrev}>Prev</PButton> : null}
        {nav.onNext ? <PButton onClick={nav.onNext}>Next</PButton> : null}
      </PortalButtons>
      <Message text={message} />
    </section>
  );
}
