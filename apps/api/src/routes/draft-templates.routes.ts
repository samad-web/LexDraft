import { Router } from 'express';
import { z } from 'zod';
import { draftTemplatesService } from '../services/draft-templates.service';
import { extractText } from '../lib/text-extraction';
import { firmIdForUser } from '../services/tenant';
import { validate, idParam } from '../middleware/validate';
import { requireFeature } from '../services/permissions.service';

const CreateInput = z.object({
  name: z.string().min(1).max(200),
  docType: z.string().max(120).optional(),
  body: z.string().min(1).max(60_000),
  source: z.enum(['paste', 'upload']).optional(),
});

const UpdateInput = CreateInput.partial();

// Upload-parse: the client sends a base64 file; we extract its text (docx via
// mammoth, txt/md/pdf too) and return it for the advocate to review before
// saving as a format. Keeps the format as diffable text, not a stored binary.
const ParseInput = z.object({
  fileName: z.string().min(1).max(255),
  mime: z.string().max(255).default(''),
  dataBase64: z.string().min(1).max(20_000_000), // ~15MB of base64
});

export const draftTemplatesRouter: Router = Router();

function strParam(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

draftTemplatesRouter.get('/', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await draftTemplatesService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

draftTemplatesRouter.post(
  '/',
  requireFeature('drafting.ai'),
  validate({ body: CreateInput }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const firmId = await firmIdForUser(userId);
      res.status(201).json(await draftTemplatesService.create(req.body, { firmId, userId }));
    } catch (err) {
      next(err);
    }
  },
);

// Parse an uploaded document to text (no save — the client reviews, then POSTs
// to `/` to store it).
draftTemplatesRouter.post(
  '/parse',
  requireFeature('drafting.ai'),
  validate({ body: ParseInput }),
  async (req, res, next) => {
    try {
      const { fileName, mime, dataBase64 } = req.body as z.infer<typeof ParseInput>;
      const buffer = Buffer.from(dataBase64, 'base64');
      const result = await extractText({ body: buffer, mime, fileName });
      if (!result.ok) {
        res.status(422).json({ error: result.error });
        return;
      }
      res.json({ text: result.text });
    } catch (err) {
      next(err);
    }
  },
);

draftTemplatesRouter.patch(
  '/:id',
  requireFeature('drafting.ai'),
  validate({ params: idParam, body: UpdateInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await draftTemplatesService.update(strParam(req.params['id']), req.body, firmId);
      if (!updated) { res.status(404).json({ error: 'Template not found' }); return; }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

draftTemplatesRouter.delete(
  '/:id',
  requireFeature('drafting.ai'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const removed = await draftTemplatesService.remove(strParam(req.params['id']), firmId);
      if (!removed) { res.status(404).json({ error: 'Template not found' }); return; }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
