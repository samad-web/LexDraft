import { Router } from 'express';
import { z } from 'zod';
import { draftingService } from '../services/drafting.service';

const Generate = z.object({
  docType: z.string().min(1),
  language: z.enum(['EN', 'HI', 'TA']),
  tone: z.enum(['Professional', 'Firm', 'Urgent', 'Conciliatory']),
  fields: z.record(z.string(), z.string()),
  draftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'draftDate must be YYYY-MM-DD')
    .optional(),
});

export const draftingRouter: Router = Router();

draftingRouter.post('/generate', async (req, res, next) => {
  try {
    res.json(await draftingService.generate(Generate.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

draftingRouter.post('/generate/stream', async (req, res, next) => {
  try {
    const parsed = Generate.parse(req.body);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    try {
      for await (const chunk of draftingService.generateStream(parsed)) {
        if (aborted) return;
        send('delta', { text: chunk });
      }
      if (!aborted) send('done', { generatedAt: new Date().toISOString() });
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : 'stream failed' });
    } finally {
      res.end();
    }
  } catch (err) {
    next(err);
  }
});
