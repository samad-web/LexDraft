/**
 * Calculator routes - court fee, stamp duty, vakalatnama generator.
 *
 * Mounted at `/api/calculators` (see routes/index.ts).
 *
 * Gating: every endpoint requires the `tools.calculators` feature. The
 * orchestrator wires this key into the permissions catalogue and plan grants
 * - Solo/Practice/Firm tiers all receive it by default since the calculators
 * are universally useful for Indian advocates.
 *
 * Inputs are validated with zod at the route boundary so the service layer
 * can assume well-formed types. Anything unrecognised (unknown stateCode,
 * unknown instrument, etc.) surfaces from the service as a `BadRequestError`,
 * which the central error handler maps to a 400 with a JSON body the UI can
 * display.
 */

import { Router } from 'express';
import { z } from 'zod';
import { calculatorsService } from '../services/calculators.service';
import { requireFeature } from '../services/permissions.service';

export const calculatorsRouter: Router = Router();

const FEATURE = 'tools.calculators';

const StateCode = z.string().min(2).max(8);

const CourtFeeQuery = z.object({
  state: StateCode,
  value: z.coerce.number().nonnegative(),
});

const StampDutyQuery = z.object({
  state: StateCode,
  instrument: z.string().min(1),
  value: z.coerce.number().nonnegative(),
});

const VakalatnamaBody = z.object({
  stateCode: StateCode,
  courtType: z.enum(['District Court', 'High Court', 'Supreme Court']),
  party: z.string().min(1),
  parent: z.string().min(1),
  age: z.coerce.number().int().positive().max(130),
  address: z.string().min(1),
  advocate: z.string().min(1),
  barNo: z.string().min(1),
  court: z.string().min(1),
  city: z.string().min(1),
  respondent: z.string().optional(),
});

// Discovery - list states with calculator coverage. No tenant scoping; this
// is a static lookup gated behind auth + feature.
calculatorsRouter.get('/states', requireFeature(FEATURE), (_req, res, next) => {
  try {
    res.json({ items: calculatorsService.listStates() });
  } catch (err) { next(err); }
});

calculatorsRouter.get('/court-fee', requireFeature(FEATURE), (req, res, next) => {
  try {
    const { state, value } = CourtFeeQuery.parse(req.query);
    res.json(calculatorsService.courtFee({ stateCode: state, matterValueInr: value }));
  } catch (err) { next(err); }
});

calculatorsRouter.get('/stamp-duty', requireFeature(FEATURE), (req, res, next) => {
  try {
    const { state, instrument, value } = StampDutyQuery.parse(req.query);
    res.json(
      calculatorsService.stampDuty({
        stateCode: state,
        instrument,
        considerationInr: value,
      }),
    );
  } catch (err) { next(err); }
});

calculatorsRouter.post('/vakalatnama', requireFeature(FEATURE), (req, res, next) => {
  try {
    const body = VakalatnamaBody.parse(req.body);
    res.json(calculatorsService.vakalatnama(body));
  } catch (err) { next(err); }
});
