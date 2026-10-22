/**
 * Live delivery for team messaging: Server-Sent Events fanned out across
 * replicas via Postgres LISTEN/NOTIFY.
 *
 * Flow:
 *   1. A mutation (send / edit / delete / read) commits, then calls
 *      `publish(recipientUserIds, event)`.
 *   2. publish() NOTIFYs `team_chat_events` with a small payload - recipient
 *      ids plus a *reference* event (message id, not the message body). NOTIFY
 *      payloads are capped at 8000 bytes, so recipients are chunked and bodies
 *      are never inlined.
 *   3. Every replica receives the NOTIFY. A replica holding no open stream for
 *      any recipient drops it immediately; otherwise it loads the message DTO
 *      once and writes the frame to each local recipient's streams.
 *
 * Connection budget: postgres.js multiplexes every `sql.listen()` channel on
 * the one dedicated LISTEN connection the cache-broadcaster already opened,
 * so this adds no connection to the 15-client Supabase pool.
 *
 * In-memory mode (no DATABASE_URL) delivers in-process directly.
 */

import type { Response } from 'express';
import type { TeamChatStreamEvent, TeamMessage } from '@lexdraft/types/messaging';
import { db } from '../db/client';
import { logger } from '../logger';

const CHANNEL = 'team_chat_events';
const HEARTBEAT_MS = 25_000;
// 150 uuids * ~39 bytes stays well inside the 8000-byte NOTIFY cap.
const RECIPIENTS_PER_NOTIFY = 150;

/** Event as it travels over NOTIFY - message events carry only the id. */
export type TeamChatRefEvent =
  | { type: 'message.created'; conversationId: string; messageId: string }
  | { type: 'message.updated'; conversationId: string; messageId: string }
  | Extract<TeamChatStreamEvent, { type: 'message.hidden' | 'conversation.read' | 'conversation.updated' }>;

interface Envelope {
  to: string[];
  event: TeamChatRefEvent;
}

type MessageLoader = (messageId: string) => Promise<TeamMessage | undefined>;

const clients = new Map<string, Set<Response>>();
let loadMessage: MessageLoader | null = null;
let listener: { unlisten?: () => Promise<void> } | null = null;
let started = false;

function write(res: Response, chunk: string): void {
  res.write(chunk);
  // compression() buffers responses; flush so frames leave immediately.
  (res as Response & { flush?: () => void }).flush?.();
}

function frame(event: TeamChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function deliverLocal(envelope: Envelope): Promise<void> {
  const targets = envelope.to.filter((id) => clients.has(id));
  if (targets.length === 0) return;

  let event: TeamChatStreamEvent;
  const ref = envelope.event;
  if (ref.type === 'message.created' || ref.type === 'message.updated') {
    const message = loadMessage ? await loadMessage(ref.messageId) : undefined;
    if (!message) return;
    event = { type: ref.type, conversationId: ref.conversationId, message };
  } else {
    event = ref;
  }

  const chunk = frame(event);
  for (const userId of targets) {
    for (const res of clients.get(userId) ?? []) {
      try { write(res, chunk); }
      catch (err) { logger.warn({ err, userId }, 'team-chat: stream write failed'); }
    }
  }
}

export const teamChatRealtime = {
  /** The service registers how to turn a message id into its DTO. */
  setMessageLoader(fn: MessageLoader): void {
    loadMessage = fn;
  },

  /** Attach an SSE response for a user. Returns the detach function. */
  attach(userId: string, res: Response): () => void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let set = clients.get(userId);
    if (!set) { set = new Set(); clients.set(userId, set); }
    set.add(res);
    write(res, frame({ type: 'ready' }));

    // Comment frames keep proxies (nginx / Caddy) from idling the stream out.
    const heartbeat = setInterval(() => {
      try { write(res, ': ping\n\n'); } catch { /* closed; detach handles it */ }
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      const s = clients.get(userId);
      if (!s) return;
      s.delete(res);
      if (s.size === 0) clients.delete(userId);
    };
  },

  /** Fan an event out to recipients on every replica. Best-effort: a failed
   *  NOTIFY is logged, never thrown - clients resync on reconnect. */
  async publish(to: string[], event: TeamChatRefEvent): Promise<void> {
    const recipients = Array.from(new Set(to.filter(Boolean)));
    if (recipients.length === 0) return;
    const sql = db();
    if (!sql) {
      await deliverLocal({ to: recipients, event });
      return;
    }
    for (let i = 0; i < recipients.length; i += RECIPIENTS_PER_NOTIFY) {
      const envelope: Envelope = { to: recipients.slice(i, i + RECIPIENTS_PER_NOTIFY), event };
      try {
        await sql.notify(CHANNEL, JSON.stringify(envelope));
      } catch (err) {
        logger.warn({ err, type: event.type }, 'team_chat_events NOTIFY failed');
      }
    }
  },

  async start(): Promise<void> {
    if (started) return;
    const sql = db();
    started = true;
    if (!sql) return;
    try {
      listener = await sql.listen(CHANNEL, (raw: string) => {
        let envelope: Envelope;
        try {
          envelope = JSON.parse(raw) as Envelope;
        } catch {
          logger.warn({ raw }, 'team_chat_events: dropped non-JSON payload');
          return;
        }
        void deliverLocal(envelope).catch((err) =>
          logger.warn({ err }, 'team_chat_events: delivery failed'));
      });
      logger.info({ channel: CHANNEL }, 'team_chat_events LISTEN started');
    } catch (err) {
      started = false;
      throw err;
    }
  },

  async stop(): Promise<void> {
    for (const set of clients.values()) {
      for (const res of set) {
        try { res.end(); } catch { /* already closed */ }
      }
    }
    clients.clear();
    if (!listener) return;
    try {
      await listener.unlisten?.();
    } catch (err) {
      logger.warn({ err }, 'team_chat_events: unlisten failed');
    } finally {
      listener = null;
      started = false;
    }
  },
};
