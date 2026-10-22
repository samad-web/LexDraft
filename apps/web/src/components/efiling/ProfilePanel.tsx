import { useEffect, useRef, useState } from 'react';
import { useEfilingPortalStates, useEfilingProfile, useSaveEfilingProfile, type PracticeLocation } from '@/hooks/useEfiling';
import { useEcourtsDistricts } from '@/hooks/useEcourts';
import { errMsg, orNull } from './format';

// =============================================================================
// ProfilePanel — the advocate details the eFiling portal registers by (Bar
// Council enrolment, the portal's unique advocate code) and the practice
// locations it lets them file in. Mirrors the portal's Profile > Update
// Practice Locations so filings outside them can be caught early.
// =============================================================================

export function ProfilePanel() {
  const { data, isLoading } = useEfilingProfile();
  const save = useSaveEfilingProfile();
  const states = useEfilingPortalStates();
  const [enrolment, setEnrolment] = useState('');
  const [barState, setBarState] = useState('');
  const [uniqueCode, setUniqueCode] = useState('');
  const [locations, setLocations] = useState<PracticeLocation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  // Fill from the server once (and after each save), not on every background
  // refetch - that would wipe what's being typed.
  const loadedKey = useRef<string | null>(null);
  const serverKey = JSON.stringify(data ?? null);
  useEffect(() => {
    if (!data || loadedKey.current === serverKey) return;
    loadedKey.current = serverKey;
    setEnrolment(data.barEnrolmentNo ?? '');
    setBarState(data.barCouncilStateCode ? String(data.barCouncilStateCode) : '');
    setUniqueCode(data.efilingUniqueCode ?? '');
    setLocations(data.practiceLocations);
  }, [data, serverKey]);

  if (isLoading) return <p className="body-sm muted">Loading…</p>;

  const onSave = async () => {
    setMessage(null);
    try {
      await save.mutateAsync({
        barEnrolmentNo: orNull(enrolment),
        barCouncilStateCode: barState ? Number(barState) : null,
        efilingUniqueCode: orNull(uniqueCode),
        practiceLocations: locations.map(({ id: _id, ...l }) => l),
      });
      setMessage('Saved.');
    } catch (err) {
      setMessage(errMsg(err, 'Could not save'));
    }
  };

  return (
    <div className="col" style={{ gap: 16, maxWidth: 720 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Bar Council enrolment no.</span>
          <input className="input" value={enrolment} onChange={(e) => setEnrolment(e.target.value)} placeholder="e.g. K/1234/2015" />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Bar Council (state)</span>
          <select className="input" value={barState} onChange={(e) => setBarState(e.target.value)}>
            <option value="">Select</option>
            {(states.data ?? []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">eFiling unique advocate code</span>
          <input className="input" value={uniqueCode} onChange={(e) => setUniqueCode(e.target.value)} placeholder="e.g. TR/WT0012/2022" />
        </label>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <span className="body-sm" style={{ fontWeight: 600 }}>Practice locations</span>
        <span className="body-sm muted">Courts you are set up to e-file in on the portal (Profile → Update Practice Locations).</span>
        {locations.map((l, i) => (
          <LocationRow
            key={i}
            value={l}
            states={states.data ?? []}
            onChange={(next) => setLocations((cur) => cur.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setLocations((cur) => cur.filter((_, j) => j !== i))}
          />
        ))}
        <div>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => setLocations((cur) => [...cur, { courtTier: 'DC', stateCode: states.data?.[0]?.code ?? 1, districtCode: null, bench: null, label: null }])}>
            + Add location
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { void onSave(); }} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {message ? <span className="body-sm muted">{message}</span> : null}
      </div>
    </div>
  );
}

function LocationRow({ value, states, onChange, onRemove }: {
  value: PracticeLocation;
  states: Array<{ code: number; name: string }>;
  onChange: (v: PracticeLocation) => void;
  onRemove: () => void;
}) {
  const districts = useEcourtsDistricts(value.courtTier === 'DC' ? value.stateCode : null, 'DC');
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <select className="input" style={{ width: 130 }} value={value.courtTier}
        onChange={(e) => onChange({ ...value, courtTier: e.target.value as 'DC' | 'HC', districtCode: null, bench: null })}>
        <option value="DC">District</option>
        <option value="HC">High Court</option>
      </select>
      <select className="input" style={{ width: 180 }} value={value.stateCode}
        onChange={(e) => onChange({ ...value, stateCode: Number(e.target.value), districtCode: null })}>
        {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
      </select>
      {value.courtTier === 'DC' ? (
        <select className="input" style={{ width: 200 }} value={value.districtCode ?? ''}
          onChange={(e) => {
            const code = e.target.value ? Number(e.target.value) : null;
            const name = districts.data?.find((d) => Number(d.dist_code) === code)?.dist_name ?? null;
            onChange({ ...value, districtCode: code, label: name });
          }}>
          <option value="">{districts.isFetching ? 'Loading…' : 'Select district'}</option>
          {(districts.data ?? []).map((d) => <option key={d.dist_code} value={d.dist_code}>{d.dist_name}</option>)}
        </select>
      ) : (
        <input className="input" style={{ width: 200 }} placeholder="Bench, e.g. Principal Bench" value={value.bench ?? ''}
          onChange={(e) => onChange({ ...value, bench: orNull(e.target.value) })} />
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>Remove</button>
    </div>
  );
}
