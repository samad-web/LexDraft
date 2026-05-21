import { Router } from 'express';
import { z } from 'zod';
import { matterChatService } from '../services/matter-chat.service';
import { firmIdForUser } from '../services/tenant';
import { validate, uuidParam } from '../middleware/validate';
import { requireFeature } from '../services/permissions.service';
import { logger } from '../logger';

// =============================================================================
// /api/matter-chat — per-matter chat grounded in the ingested corpus.
//
// Streaming contract (POST /threads/:threadId/messages):
//   The response is an SSE stream. Frame types:
//
//     event: user_message
//     data: { ...MatterChatMessage }
//
//     event: delta
//     data: { text: "..." }            (many; one per provider token batch)
//
//     event: assistant_message
//     data: { ...MatterChatMessage }   (terminal, with citations)
//
//     event: error
//     data: { message: "..." }         (terminal on failure)
//
// The client appends `delta.text` to the in-flight assistant bubble as it
// arrives; on `assistant_message` it swaps the optimistic bubble for the
// persisted row (which carries the canonical id, modelUsed, and citations).
// =============================================================================

const CaseParam   = z.object({ caseId:   z.string().uuid() });
const ThreadParam = z.object({ threadId: z.string().uuid() });

const CreateThreadInput = z.object({
  title: z.string().trim().max(200).optional().nullable(),
});

const PostMessageInput = z.object({
  content: z.string().trim().min(1).max(8_000),
});

export const matterChatRouter: Router = Router();

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

matterChatRouter.post(
  '/:caseId/threads',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam, body: CreateThreadInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const thread = await matterChatService.createThread({
        firmId,
        caseId: (req.params as { caseId: string }).caseId,
        userId: req.user.id,
        title: req.body.title ?? null,
      });
      res.status(201).json(thread);
    } catch (err) {
      next(err);
    }
  },
);

matterChatRouter.get(
  '/:caseId/threads',
  requireFeature('matter.intelligence'),
  validate({ params: CaseParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const items = await matterChatService.listThreads({
        firmId,
        caseId: (req.params as { caseId: string }).caseId,
        userId: req.user.id,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

matterChatRouter.get(
  '/threads/:threadId/messages',
  requireFeature('matter.intelligence'),
  validate({ params: ThreadParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }
      const items = await matterChatService.listMessages({
        firmId,
        threadId: (req.params as { threadId: string }).threadId,
        userId: req.user.id,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

matterChatRouter.post(
  '/threads/:threadId/messages',
  requireFeature('matter.intelligence'),
  validate({ params: ThreadParam, body: PostMessageInput }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId || !req.user?.id || !req.user?.email) {
        res.status(422).json({ error: 'No firm attached' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let aborted = false;
      req.on('close', () => { aborted = true; });

      try {
        for await (const evt of matterChatService.streamMessage({
          firmId,
          threadId: (req.params as { threadId: string }).threadId,
          userId: req.user.id,
          userEmail: req.user.email,
          content: req.body.content,
        })) {
          if (aborted) return;
          if (evt.type === 'user_message')      send('user_message', evt.message);
          else if (evt.type === 'delta')        send('delta', { text: evt.text });
          else if (evt.type === 'assistant_message') send('assistant_message', evt.message);
          else if (evt.type === 'error')        send('error', { message: evt.message });
        }
      } catch (err) {
        logger.warn({ err }, 'matter-chat stream threw');
        // Generic to client; provider details (Anthropic / xAI URLs,
        // prompts, model names) stay in server logs only.
        send('error', { message: 'Stream failed. Please retry.' });
      } finally {
        res.end();
      }
    } catch (err) {
      next(err);
    }
  },
);
