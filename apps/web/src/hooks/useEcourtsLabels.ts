import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';

// =============================================================================
// eCourts screen language - the eCourts app's own translations.
//
// The app ships six languages and loads its UI labels from eCourts
// (getAllLabelsWebService.php, keyed by numeric id). DifAi's eCourts screen
// uses the same labels, so an advocate who reads the app in Hindi or Tamil
// sees the same words here. English keeps DifAi's own wording; any label
// the app doesn't have falls back to English.
// =============================================================================

export type EcourtsLanguage = 'english' | 'hindi' | 'marathi' | 'kannada' | 'gujrati' | 'tamil';

/** Language names as the eCourts app shows them (in their own script). */
export const ECOURTS_LANGUAGE_OPTIONS: ReadonlyArray<{ id: EcourtsLanguage; name: string }> = [
  { id: 'english', name: 'English' },
  { id: 'hindi', name: 'हिंदी' },
  { id: 'marathi', name: 'मराठी' },
  { id: 'kannada', name: 'ಕನ್ನಡ' },
  { id: 'gujrati', name: 'ગુજરાતી' },
  { id: 'tamil', name: 'தமிழ்' },
];

/** eCourts app label ids used on DifAi's eCourts screen. */
export const L = {
  districtCourt: 169, highCourt: 646, language: 607,
  cnrNumber: 144, caseStatus: 11, causeList: 190, myCases: 635,
  caseNumber: 9, partyName: 30, filingNumber: 120, firNumber: 22, advocate: 3, act: 1,
  caseType: 12, caveat: 450, courtOrders: 20, processes: 616,
  search: 59, enterCnr: 261, howTo: 488, howToB: 740, howToC: 741, howToD: 742, howToG: 745,
  caseHistory: 137, caseDetails: 136, petitioner: 88, respondent: 89, and: 175, acts: 177, firDetails: 158,
  filingDate: 124, registrationNumber: 142, registrationDate: 143,
  firstHearingDate: 145, decisionDate: 146, nextHearingDate: 91, natureOfDisposal: 147, caseStage: 92,
  courtNumber: 18, judge: 129, underActs: 126, underSections: 127,
  businessOnDate: 130, hearingDate: 160, purposeOfHearing: 131,
  interimOrders: 599, finalOrders: 600, orderDate: 29, orderDetails: 161,
  caseTransferDetails: 170, iaStatus: 566, appellateInformation: 162,
  viewBusiness: 651, dailyStatus: 311, todaysCaseList: 79,
  pending: 31, disposed: 21, year: 81, advocateName: 4, causeListDate: 276,
  preTrial: 603, searchPreTrial: 656, policeStation: 56, firType: 424, remand: 606, bail: 438,
  accused: 658, applicationDate: 661, applicationType: 665, remandOrders: 657, bailOrders: 663,
  importCases: 653, exportCases: 654, scanQr: 737, qrCode: 784, notQr: 833,
  // Inner screens (search forms, results, Case History, My Cases).
  go: 26, reset: 57, searchBy: 61, barCode: 5, both: 7, courtName: 17, petRes: 32,
  selectCaseType: 44, selectDistrict: 49, selectState: 52, state: 401, district: 392,
  totalCases: 409, totalEstablishments: 390, srNo: 84, view: 85, back: 119,
  courtComplex: 269, selectCourtComplex: 268, dateCaseList: 278, caseListDate: 279,
  status: 429, application: 433, startingWith: 476, anywhere: 477, searchType: 604,
  dateOfFiling: 563, caveatorCaveateeDetails: 591, caveatNumber: 472, matchedCaseNumber: 590,
  caveator: 471, caveatee: 469, undatedCases: 614, dateWise: 625, districtWise: 626,
  removeCase: 630, addCase: 768, enterTextToSearch: 693, calendar: 841,
  civil: 194, criminal: 195, courtNumberOnly: 941, orderNumber: 151, registrationYear: 932,
  caseTransfer: 849, searchByCaseNumber: 455, searchByPartyName: 98, searchByCaseType: 65,
  searchByFirNumber: 457, searchByFilingNumber: 459, searchByAdvocate: 63, searchByActType: 461,
  finalOrdersOnly: 600, causeListDisclaimer: 14, dailyBoard: 191, bench: 608, selectCourtNumber: 47, disposedCasesList: 384,
} as const;

interface LangState {
  language: EcourtsLanguage;
  setLanguage: (l: EcourtsLanguage) => void;
}

export const useEcourtsLangStore = create<LangState>()(
  persist(
    (set) => ({ language: 'english', setLanguage: (language) => set({ language }) }),
    { name: 'lexdraft.ecourts.language', version: 1 },
  ),
);

/** `t(L.caseStatus, 'Case Status')` - the app's label in the chosen language,
 *  or the English fallback (always for English, and for any missing label). */
export function useEcourtsT() {
  const language = useEcourtsLangStore((s) => s.language);
  const setLanguage = useEcourtsLangStore((s) => s.setLanguage);
  const { data, isFetching } = useQuery({
    queryKey: ['ecourts', 'labels', language],
    queryFn: () => api.get<{ language: EcourtsLanguage; labels: Record<string, string> }>(`/ecourts/labels/${language}`),
    select: (r) => r.labels,
    enabled: language !== 'english',
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  const t = (id: number, fallback: string): string => {
    if (language === 'english') return fallback;
    const v = data?.[String(id)];
    return v && v.trim() ? v : fallback;
  };
  return { language, setLanguage, t, loading: isFetching };
}
