import { Router } from 'express';
import { z } from 'zod';
import { draftsService } from '../services/drafts.service';
import { assertNotLocked } from '../services/draft-meter.service';
import { requireFeature } from '../services/permissions.service';

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
});

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
