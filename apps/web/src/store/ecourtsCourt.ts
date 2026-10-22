import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Court } from '@/hooks/useEcourts';

// =============================================================================
// The court an advocate is searching in, shared by every eCourts search and
// remembered between visits. Advocates practise in a handful of courts; making
// them re-pick state -> district -> complex -> court on every search type was
// the single biggest friction in the old tabbed layout.
// =============================================================================

export interface EcourtsCourtScope {
  court: Court;
  stateCode: number | '';
  distCode: number | '';
  complexCode: string;
  /** Numeric court code as a string ('' = not chosen). */
  courtCode: string;
  estCode: string;
}

export const EMPTY_SCOPE: EcourtsCourtScope = {
  court: 'DC', stateCode: '', distCode: '', complexCode: '', courtCode: '', estCode: '',
};

interface State {
  scope: EcourtsCourtScope;
  setScope: (next: EcourtsCourtScope) => void;
}

export const useEcourtsCourtStore = create<State>()(
  persist(
    (set) => ({
      scope: EMPTY_SCOPE,
      setScope: (scope) => set({ scope }),
    }),
    { name: 'lexdraft.ecourts.court', version: 1 },
  ),
);
