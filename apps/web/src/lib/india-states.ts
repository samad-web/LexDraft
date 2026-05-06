/**
 * Canonical list of Indian states and union territories.
 * Includes indicative stamp duty + registration rates per instrument type.
 *
 * Rates are *baseline* figures suitable for an estimator — they vary by
 * gender, locality (urban / rural / municipal), instrument value, and recent
 * notifications. Always defer to the Sub-Registrar's schedule at registration.
 *
 * Update schedule: review against state finance department circulars annually
 * (most states notify FY revisions in March / April).
 */

export type IndiaStateType = 'state' | 'ut';

export interface InstrumentRates {
  /** Sale deed / conveyance. */
  sale: number;
  /** Long-term lease (10y+). Short leases differ — use this as a proxy. */
  lease: number;
  /** Mortgage with possession. Without possession is typically lower. */
  mortgage: number;
  /** Gift between non-blood relatives. Blood relatives often get a concession. */
  gift: number;
}

export interface IndiaStateInfo {
  /** ISO 3166-2:IN code (without the 'IN-' prefix). */
  code: string;
  name: string;
  type: IndiaStateType;
  /** Stamp duty as a percentage of dutiable value. */
  stampPct: InstrumentRates;
  /** Registration fee as a percentage of dutiable value. */
  registrationPct: number;
}

const D_LEASE = 0.5;
const D_MORTGAGE = 0.5;
const D_GIFT = 3.0;

export const INDIA_STATES: ReadonlyArray<IndiaStateInfo> = [
  // ---- States ----
  { code: 'AP', name: 'Andhra Pradesh', type: 'state', stampPct: { sale: 5.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: 2.0 }, registrationPct: 1.0 },
  { code: 'AR', name: 'Arunachal Pradesh', type: 'state', stampPct: { sale: 6.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'AS', name: 'Assam', type: 'state', stampPct: { sale: 8.25, lease: 1.0, mortgage: 1.0, gift: 5.0 }, registrationPct: 1.0 },
  { code: 'BR', name: 'Bihar', type: 'state', stampPct: { sale: 6.0, lease: 1.0, mortgage: 1.0, gift: 5.7 }, registrationPct: 2.0 },
  { code: 'CG', name: 'Chhattisgarh', type: 'state', stampPct: { sale: 5.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 4.0 },
  { code: 'GA', name: 'Goa', type: 'state', stampPct: { sale: 5.0, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 3.0 },
  { code: 'GJ', name: 'Gujarat', type: 'state', stampPct: { sale: 4.9, lease: 1.0, mortgage: 0.25, gift: 4.9 }, registrationPct: 1.0 },
  { code: 'HR', name: 'Haryana', type: 'state', stampPct: { sale: 7.0, lease: 1.5, mortgage: D_MORTGAGE, gift: 5.0 }, registrationPct: 1.0 },
  { code: 'HP', name: 'Himachal Pradesh', type: 'state', stampPct: { sale: 6.0, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 2.0 },
  { code: 'JH', name: 'Jharkhand', type: 'state', stampPct: { sale: 4.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 3.0 },
  { code: 'KA', name: 'Karnataka', type: 'state', stampPct: { sale: 5.6, lease: 0.5, mortgage: 0.5, gift: 5.0 }, registrationPct: 1.0 },
  { code: 'KL', name: 'Kerala', type: 'state', stampPct: { sale: 8.0, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 2.0 },
  { code: 'MP', name: 'Madhya Pradesh', type: 'state', stampPct: { sale: 7.5, lease: 1.0, mortgage: D_MORTGAGE, gift: 2.5 }, registrationPct: 3.0 },
  { code: 'MH', name: 'Maharashtra', type: 'state', stampPct: { sale: 5.0, lease: 0.5, mortgage: 0.5, gift: 3.0 }, registrationPct: 1.0 },
  { code: 'MN', name: 'Manipur', type: 'state', stampPct: { sale: 7.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'ML', name: 'Meghalaya', type: 'state', stampPct: { sale: 9.9, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 0 },
  { code: 'MZ', name: 'Mizoram', type: 'state', stampPct: { sale: 9.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'NL', name: 'Nagaland', type: 'state', stampPct: { sale: 8.25, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'OD', name: 'Odisha', type: 'state', stampPct: { sale: 5.0, lease: 1.0, mortgage: D_MORTGAGE, gift: 3.0 }, registrationPct: 2.0 },
  { code: 'PB', name: 'Punjab', type: 'state', stampPct: { sale: 7.0, lease: 1.5, mortgage: D_MORTGAGE, gift: 5.0 }, registrationPct: 1.0 },
  { code: 'RJ', name: 'Rajasthan', type: 'state', stampPct: { sale: 6.0, lease: 1.0, mortgage: D_MORTGAGE, gift: 2.5 }, registrationPct: 1.0 },
  { code: 'SK', name: 'Sikkim', type: 'state', stampPct: { sale: 5.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: 1.0 }, registrationPct: 1.0 },
  { code: 'TN', name: 'Tamil Nadu', type: 'state', stampPct: { sale: 7.0, lease: 1.0, mortgage: 1.0, gift: 7.0 }, registrationPct: 4.0 },
  { code: 'TS', name: 'Telangana', type: 'state', stampPct: { sale: 5.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 0.5 },
  { code: 'TR', name: 'Tripura', type: 'state', stampPct: { sale: 5.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'UP', name: 'Uttar Pradesh', type: 'state', stampPct: { sale: 7.0, lease: 1.0, mortgage: D_MORTGAGE, gift: 7.0 }, registrationPct: 1.0 },
  { code: 'UK', name: 'Uttarakhand', type: 'state', stampPct: { sale: 5.0, lease: 1.0, mortgage: D_MORTGAGE, gift: 5.0 }, registrationPct: 2.0 },
  { code: 'WB', name: 'West Bengal', type: 'state', stampPct: { sale: 7.0, lease: 1.0, mortgage: D_MORTGAGE, gift: 0.5 }, registrationPct: 1.0 },

  // ---- Union Territories ----
  { code: 'AN', name: 'Andaman & Nicobar Islands', type: 'ut', stampPct: { sale: 5.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'CH', name: 'Chandigarh', type: 'ut', stampPct: { sale: 6.0, lease: 1.5, mortgage: D_MORTGAGE, gift: 5.0 }, registrationPct: 1.0 },
  { code: 'DH', name: 'Dadra & Nagar Haveli and Daman & Diu', type: 'ut', stampPct: { sale: 4.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'DL', name: 'Delhi', type: 'ut', stampPct: { sale: 6.0, lease: 2.0, mortgage: 0.5, gift: 4.0 }, registrationPct: 1.0 },
  { code: 'JK', name: 'Jammu & Kashmir', type: 'ut', stampPct: { sale: 7.0, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.2 },
  { code: 'LA', name: 'Ladakh', type: 'ut', stampPct: { sale: 7.0, lease: 1.0, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.2 },
  { code: 'LD', name: 'Lakshadweep', type: 'ut', stampPct: { sale: 4.0, lease: D_LEASE, mortgage: D_MORTGAGE, gift: D_GIFT }, registrationPct: 1.0 },
  { code: 'PY', name: 'Puducherry', type: 'ut', stampPct: { sale: 7.0, lease: 1.0, mortgage: 1.0, gift: 7.0 }, registrationPct: 4.0 },
];

export const INDIA_STATES_BY_CODE: Readonly<Record<string, IndiaStateInfo>> = Object.freeze(
  INDIA_STATES.reduce<Record<string, IndiaStateInfo>>((acc, s) => {
    acc[s.code] = s;
    return acc;
  }, {}),
);

/** Convenience for `<Select>` components that just need code/name pairs. */
export function indiaStateOptions(): Array<{ value: string; label: string }> {
  return INDIA_STATES.map((s) => ({ value: s.code, label: s.name }));
}
