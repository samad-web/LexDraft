import {
  useEcourtsCourtComplexes,
  useEcourtsCourts,
  useEcourtsDistricts,
  useEcourtsStates,
} from '@/hooks/useEcourts';
import type { Court } from '@/hooks/useEcourts';

/**
 * Tier -> State -> District -> Court complex -> Court cascade, the same
 * selection the eCourts search screen uses, packaged for reuse (linking a
 * manual matter by case number, etc.).
 *
 * Every court-scoped eCourts call needs the numeric court code; the Court
 * dropdown fills both `courtCode` and `estCode` with it, matching
 * EcourtsView. Districts whose complexes we haven't captured yet fall back
 * to typed codes.
 */
export interface CourtScopeValue {
  court: Court;
  stateCode: number | '';
  distCode: number | '';
  complexCode: string;
  courtCode: string;
  estCode: string;
}

export const EMPTY_COURT_SCOPE: CourtScopeValue = {
  court: 'DC', stateCode: '', distCode: '', complexCode: '', courtCode: '', estCode: '',
};

export function courtScopeReady(v: CourtScopeValue): boolean {
  return v.stateCode !== '' && v.distCode !== '' && v.estCode.trim().length > 0
    && /^\d+$/.test(v.courtCode) && Number(v.courtCode) > 0;
}

interface Props {
  value: CourtScopeValue;
  onChange: (next: CourtScopeValue) => void;
  disabled?: boolean;
  /** Limit the state list, e.g. to the states the eFiling portal covers. */
  stateFilter?: (stateCode: number) => boolean;
  /** Hide the tier select - the eCourts screen sets it with its own
   *  District Court | High Court switch, like the eCourts app. */
  hideTier?: boolean;
}

export function CourtScopePicker({ value, onChange, disabled, stateFilter, hideTier }: Props) {
  const { court, stateCode, distCode, complexCode, courtCode, estCode } = value;
  const set = (patch: Partial<CourtScopeValue>) => onChange({ ...value, ...patch });

  const states = useEcourtsStates(court);
  const districts = useEcourtsDistricts(stateCode === '' ? null : stateCode, court);
  const complexes = useEcourtsCourtComplexes(stateCode === '' ? null : stateCode, distCode === '' ? null : distCode, court);
  const courts = useEcourtsCourts(stateCode === '' ? null : stateCode, distCode === '' ? null : distCode, complexCode || null, court);

  const complexList = complexes.data ?? [];
  const selectedComplex = complexList.find((c) => c.complexCode === complexCode);
  const courtList = courts.data ?? [];
  const codeOnlyCourts = selectedComplex?.courtCodes ?? [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      <label className="col" style={{ gap: 4, ...(hideTier ? { display: 'none' } : {}) }}>
        <span className="body-sm muted">Court tier</span>
        <select
          className="input"
          value={court}
          disabled={disabled}
          onChange={(e) => onChange({ ...EMPTY_COURT_SCOPE, court: e.target.value as Court })}
        >
          <option value="DC">District</option>
          <option value="HC">High Court</option>
        </select>
      </label>

      <label className="col" style={{ gap: 4 }}>
        <span className="body-sm muted">State {states.isError ? '· eCourts not responding' : ''}</span>
        <select
          className="input"
          value={stateCode}
          disabled={disabled || states.isLoading}
          onChange={(e) => set({
            stateCode: e.target.value ? Number(e.target.value) : '',
            distCode: '', complexCode: '', courtCode: '', estCode: '',
          })}
        >
          <option value="">{states.isLoading ? 'Loading states…' : 'Select state'}</option>
          {(states.data ?? [])
            .filter((s) => !stateFilter || stateFilter(Number(s.state_code)))
            .map((s) => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
        </select>
      </label>

      <label className="col" style={{ gap: 4 }}>
        <span className="body-sm muted">District {districts.isFetching ? '· loading…' : ''}</span>
        <select
          className="input"
          value={distCode}
          disabled={disabled || stateCode === ''}
          onChange={(e) => set({
            distCode: e.target.value ? Number(e.target.value) : '',
            complexCode: '', courtCode: '', estCode: '',
          })}
        >
          <option value="">{stateCode === '' ? 'Select a state first' : 'Select district'}</option>
          {(districts.data ?? []).map((d) => <option key={d.dist_code} value={d.dist_code}>{d.dist_name}</option>)}
        </select>
      </label>

      {complexList.length > 0 ? (
        <>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Court complex</span>
            <select
              className="input"
              value={complexCode}
              disabled={disabled || distCode === ''}
              onChange={(e) => set({ complexCode: e.target.value, courtCode: '', estCode: '' })}
            >
              <option value="">Select court complex</option>
              {complexList.map((c) => <option key={c.complexCode} value={c.complexCode}>{c.complexName}</option>)}
            </select>
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Court {courts.isFetching ? '· loading…' : ''}</span>
            {courtList.length > 0 || codeOnlyCourts.length > 0 ? (
              <select
                className="input"
                value={estCode}
                disabled={disabled || !complexCode}
                onChange={(e) => set({ estCode: e.target.value, courtCode: e.target.value })}
              >
                <option value="">Select court</option>
                {courtList.length > 0
                  ? courtList.map((c) => <option key={c.courtCode} value={c.courtCode}>{c.courtName}</option>)
                  : codeOnlyCourts.map((code) => <option key={code} value={code}>Court {code}</option>)}
              </select>
            ) : (
              <input
                className="input"
                value={courtCode}
                disabled={disabled || !complexCode}
                placeholder={!complexCode ? 'Select a court complex first' : 'Court code, e.g. 17'}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  set({ courtCode: v, estCode: v });
                }}
              />
            )}
          </label>
        </>
      ) : (
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Court code</span>
          <input
            className="input"
            value={courtCode}
            disabled={disabled || distCode === ''}
            placeholder={distCode === '' ? 'Select a district first' : "e.g. 6 (district not in our list yet)"}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              set({ courtCode: v, estCode: v });
            }}
          />
        </label>
      )}
    </div>
  );
}
