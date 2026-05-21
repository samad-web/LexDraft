/**
 * Transactional email sender.
 *
 * Uses nodemailer when SMTP_HOST is set; otherwise logs the message to stdout
 * so dev can see what would have been sent. The same `send()` function is
 * called by the `email.send` background job (jobs.service.ts) — feature code
 * never imports nodemailer directly.
 *
 * Failures are logged but never throw to the caller. A transactional miss is
 * a recoverable inconvenience; a thrown exception in a write-path would be a
 * regression (invitation accepted but onboarding email failed would otherwise
 * roll the whole thing back).
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';
import { logger } from '../logger';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. HTML is rendered from this with line-break preservation
   *  when no explicit `html` is provided. */
  body: string;
  html?: string;
  /** Override the From address. Defaults to env.EMAIL_FROM. */
  from?: string;
  /** Reply-To header. Useful for notifications that should route replies
   *  back to a human (e.g. "advocate@firm.com"). */
  replyTo?: string;
}

let transporter: Transporter | null = null;
let transporterFailed = false;

function getTransporter(): Transporter | null {
  if (transporterFailed) return null;
  if (transporter) return transporter;
  if (!env.hasSmtp) return null;
  try {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.smtpSecure,
      auth: env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    });
    return transporter;
  } catch (err) {
    logger.error({ err }, 'email: failed to create nodemailer transport');
    transporterFailed = true;
    return null;
  }
}

function defaultFrom(): string {
  if (env.EMAIL_FROM) return env.EMAIL_FROM;
  return 'LexDraft <no-reply@lexdraft.local>';
}

function plainToHtml(body: string): string {
  // Cheap escape + line breaks; covers the vast majority of templates the API
  // sends today (engagement letters, invitations, reminders) without a full
  // HTML email framework.
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word;">${escaped}</pre>`;
}

export const emailService = {
  /** Single entry point. Returns `true` when the transport accepted the
   *  message; `false` when the transport is missing or rejected the send.
   *  Never throws. */
  async send(msg: EmailMessage): Promise<boolean> {
    const t = getTransporter();
    if (!t) {
      // Dev / unconfigured environment: surface the message so engineers
      // can see what would have gone out. Truncate long bodies to keep
      // log lines readable.
      logger.info(
        { to: msg.to, subject: msg.subject, bodyPreview: msg.body.slice(0, 160) },
        'email.send (no SMTP configured — logging only)',
      );
      return false;
    }
    try {
      await t.sendMail({
        from: msg.from ?? defaultFrom(),
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
        html: msg.html ?? plainToHtml(msg.body),
        replyTo: msg.replyTo,
      });
      return true;
    } catch (err) {
      logger.error({ err, to: msg.to, subject: msg.subject }, 'email.send failed');
      return false;
    }
  },

  /** Useful for healthchecks / superadmin tooling. Returns true when an SMTP
   *  transport is configured AND its verify() succeeds. */
  async verify(): Promise<boolean> {
    const t = getTransporter();
    if (!t) return false;
    try {
      await t.verify();
      return true;
    } catch (err) {
      logger.warn({ err }, 'email.verify failed');
      return false;
    }
  },
};
