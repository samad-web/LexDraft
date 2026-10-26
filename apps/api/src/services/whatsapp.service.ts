/**
 * WhatsApp OTP sender.
 *
 * Feature code calls `whatsappService.sendOtp()` and never talks to a
 * provider directly, so swapping providers is a change here only.
 *
 *   console - logs the code (dev). Refused in production so a code can never
 *             end up only in a log file.
 *   wasi    - Wasi Hub API (POST /api/v1/messages), the approved provider.
 *   meta    - WhatsApp Cloud API, sending an approved "authentication"
 *             template whose body takes the code as {{1}} and whose
 *             copy-code button takes it as the URL parameter.
 *
 * Unlike email.service, a failed send throws: the user is waiting on the
 * screen for this code, and silently succeeding would strand them.
 */
import { env } from '../env';
import { logger } from '../logger';
import { HttpError } from '../lib/errors';

async function sendViaWasi(phone: string, code: string): Promise<void> {
  if (!env.WASI_API_KEY || !env.WASI_CLIENT_ID) {
    throw new HttpError(503, 'WhatsApp verification is not configured.');
  }
  const res = await fetch(`${env.WASI_API_BASE_URL.replace(/\/$/, '')}/api/v1/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WASI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.WASI_CLIENT_ID,
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: env.WHATSAPP_OTP_TEMPLATE,
      // The template's copy-code button reuses {{1}}; Wasi fills it.
      params: { '1': code },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail: detail.slice(0, 500) }, 'whatsapp: wasi send failed');
    throw new HttpError(502, 'Could not send the WhatsApp code. Check the number and try again.');
  }
}

async function sendViaMeta(phone: string, code: string): Promise<void> {
  if (!env.WHATSAPP_META_PHONE_NUMBER_ID || !env.WHATSAPP_META_ACCESS_TOKEN) {
    throw new HttpError(503, 'WhatsApp verification is not configured.');
  }
  const url = `https://graph.facebook.com/${env.WHATSAPP_META_API_VERSION}/${env.WHATSAPP_META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_META_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: env.WHATSAPP_OTP_TEMPLATE,
        language: { code: env.WHATSAPP_OTP_TEMPLATE_LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail: detail.slice(0, 500) }, 'whatsapp: meta send failed');
    throw new HttpError(502, 'Could not send the WhatsApp code. Check the number and try again.');
  }
}

export const whatsappService = {
  async sendOtp(phone: string, code: string): Promise<void> {
    switch (env.WHATSAPP_PROVIDER) {
      case 'wasi':
        return sendViaWasi(phone, code);
      case 'meta':
        return sendViaMeta(phone, code);
      case 'console':
        if (env.isProd) throw new HttpError(503, 'WhatsApp verification is not configured.');
        logger.info({ phone, code }, 'whatsapp(console): OTP - not actually sent');
        return;
    }
  },
};
