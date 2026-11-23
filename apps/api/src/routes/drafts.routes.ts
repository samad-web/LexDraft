import { Router } from 'express';
import { z } from 'zod';
import { draftsService } from '../services/drafts.service';
import { assertNotLocked } from '../services/draft-meter.service';
import { requireFeature } from '../services/permissions.service';
import { documentsService } from '../services/documents.service';
import { importedDocumentsService, ImportError } from '../services/imported-documents.service';
import { EngineDisabledError, EngineError } from '../services/engine-client.service';
import { firmIdForUser } from '../services/tenant';

const SaveInput = z.object({
  title: z.string().optional(),
  docType: z.string().min(1),
  language: z.enum(['EN', 'HI', 'TA']),
  tone: z.enum(['Professional', 'Firm', 'Urgent', 'Conciliatory']),
  fields: z.record(z.string(), z.string()),
  editedHtml: z.string().default(''),
  bodyText: z.string().default(''),
  draftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'draftDate must be YYYY-MM-DD')
    .optional(),
  matter: z.string().max(300).optional(),
  sourceDocumentId: z.string().uuid().optional(),
});
const EditedFileInput = z.object({ paragraphs: z.array(z.string().max(20_000)).min(1).max(5_000) });
const MatterInput = z.object({ matter: z.string().max(300) });

async function ctxOf(req: { user?: { id: string } }) {
  const userId = req.user!.id;
  return { userId, firmId: await firmIdForUser(userId) };
}
function importErr(err: unknown, res: import('express').Response): boolean {
  if (!(err instanceof ImportError)) return false;
  res.status(err.status).json({ error: err.code });
  return true;
}

export const draftsRouter: Router = Router();

draftsRouter.get('/', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    res.json({ items: await draftsService.list({ userId }) });
  } catch (err) {
    next(err);
  }
});

draftsRouter.get('/:id', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const draft = await draftsService.get(String(req.params.id ?? ''), { userId });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    res.json(draft);
  } catch (err) {
    next(err);
  }
});

draftsRouter.post('/', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const input = SaveInput.parse(req.body);
    assertNotLocked(input.bodyText, input.editedHtml);
    // An imported draft may only point at a document of the caller's own firm.
    if (input.sourceDocumentId && !(await documentsService.get(input.sourceDocumentId, await firmIdForUser(userId)))) {
      return res.status(404).json({ error: 'document_not_found' });
    }
    res.status(201).json(await draftsService.create(input, { userId }));
  } catch (err) {
    next(err);
  }
});

draftsRouter.put('/:id', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const input = SaveInput.parse(req.body);
    assertNotLocked(input.bodyText, input.editedHtml);
    const updated = await draftsService.update(String(req.params.id ?? ''), input, { userId });
    if (!updated) return res.status(404).json({ error: 'Draft not found' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// import-edit-document: the edited Word copy into Documents (one row per draft,
// replaced on each save), a separate copy in another case (Option A), and
// "Add to a case".
draftsRouter.put('/:id/edited-file', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const { paragraphs } = EditedFileInput.parse(req.body);
    res.json(await importedDocumentsService.saveEditedFile(String(req.params.id ?? ''), paragraphs, await ctxOf(req)));
  } catch (err) {
    if (err instanceof EngineDisabledError || err instanceof EngineError) {
      return res.status(503).json({ error: 'engine_unavailable' });
    }
    if (!importErr(err, res)) next(err);
  }
});

draftsRouter.post('/:id/copy', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const { matter } = MatterInput.parse(req.body);
    res.status(201).json(await importedDocumentsService.copyToMatter(String(req.params.id ?? ''), matter, await ctxOf(req)));
  } catch (err) {
    if (!importErr(err, res)) next(err);
  }
});

draftsRouter.patch('/:id/matter', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const { matter } = MatterInput.parse(req.body);
    res.json(await importedDocumentsService.moveToMatter(String(req.params.id ?? ''), matter, await ctxOf(req)));
  } catch (err) {
    if (!importErr(err, res)) next(err);
  }
});

draftsRouter.delete('/:id', requireFeature('drafting.basic'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const ok = await draftsService.remove(String(req.params.id ?? ''), { userId });
    if (!ok) return res.status(404).json({ error: 'Draft not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
