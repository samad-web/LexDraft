/**
 * Financial-export DTOs — kept LOCAL to the api package. These types are
 * only consumed by `exports.service.ts` and `exports.routes.ts`; the web
 * client receives the CSV body verbatim and never deserialises a JSON
 * shape from this surface, so there's nothing to share with `@lexdraft/types`.
 *
 * Filters are date-bounded (`since` / `until` are ISO YYYY-MM-DD), with an
 * optional status/type pass-through. All filters are firm-scoped at the
 * service boundary (firmId required).
 */

import type { Invoice, Expense } from '@lexdraft/types';

export interface InvoicesExportFilter {
  firmId: string | null;
  /** Inclusive ISO date (YYYY-MM-DD), applied to `issued_date`. */
  since?: string;
  /** Inclusive ISO date (YYYY-MM-DD), applied to `issued_date`. */
  until?: string;
  status?: Invoice['status'];
}

export interface ExpensesExportFilter {
  firmId: string | null;
  /** Inclusive ISO date (YYYY-MM-DD), applied to `expense_date`. */
  since?: string;
  /** Inclusive ISO date (YYYY-MM-DD), applied to `expense_date`. */
  until?: string;
  /** Maps to the `category` column on `expenses`. The query param is named
   *  `type` for parity with other endpoints, but it's a category match. */
  type?: string;
}
