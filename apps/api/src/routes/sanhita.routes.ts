import { Router } from 'express';
import { z } from 'zod';
import { sanhitaService } from '../services/sanhita.service';
import { requireFeature } from '../services/permissions.service';
import { validate } from '../middleware/validate';

/**
 * Sanhita translator routes.
 *
 * Surface area is deliberately tiny - three endpoints, all read-only and
 * tenant-agnostic (the mapping is the same for every firm). Gated under
 * `drafting.basic` because the primary consumer is the drafting view's
 * stale-IPC linter.
 */

const OldActSchema = z.enum(['IPC', 'CrPC', 'IEA']);
const NewActSchema = z.enum(['BNS', 'BNSS', 'BSA']);

const LookupQuery = z.object({
  act: z.union([OldActSchema, NewActSchema]),
  section: z.string().min(1),
  /** `direction=new` reverses the lookup. Defaults to `old → new`. */
  direction: z.enum(['old', 'new']).default('old'),
});

const ScanBody = z.object({
  text: z.string().min(1).max(200_000),
});

const ListQuery = z.object({
  fromAct: OldActSchema.optional(),
  toAct: NewActSchema.optional(),
});

export const sanhitaRouter: Router = Router();

// GET /api/sanhita - list the curated mapping table (optionally filtered).
sanhitaRouter.get(
  '/',
  requireFeature('drafting.basic'),
  validate({ query: ListQuery }),
  (req, res) => {
    const { fromAct, toAct } = req.query as z.infer<typeof ListQuery>;
    res.json({ items: sanhitaService.listMappings({ fromAct, toAct }) });
  },
);

// GET /api/sanhita/lookup?act=IPC&section=302
sanhitaRouter.get(
  '/lookup',
  requireFeature('drafting.basic'),
  validate({ query: LookupQuery }),
  (req, res) => {
    const { act, section, direction } = req.query as z.infer<typeof LookupQuery>;
    const mapping = direction === 'new'
      ? sanhitaService.lookupByNewSection({ act, section })
      : sanhitaService.lookupByOldSection({ act, section });
    res.json({ mapping });
  },
);

// POST /api/sanhita/scan { text }
sanhitaRouter.post(
  '/scan',
  requireFeature('drafting.basic'),
  validate({ body: ScanBody }),
  (req, res) => {
    const { text } = req.body as z.infer<typeof ScanBody>;
    res.json(sanhitaService.scanText(text));
  },
);
