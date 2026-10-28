import 'server-only';
import { appendFileSync } from 'node:fs';
import { env } from './env';
import { hint } from './crypto';

/**
 * Outbound email for password recovery. Resend is the transport (a single fetch,
 * no SMTP client dependency); the file outbox exists so the e2e suite can read a
 * code back, and is refused outright in production.
 *
 * The code never appears in a log, a response body, or the audit trail — only in
 * the message handed to the transport.
 */

const RESEND_URL = 'https://api.resend.com/emails';

/** Reset policy, shared by the two routes and the email itself so the message can never disagree with the check. */
export const RECOVERY_TTL_SECONDS = 10 * 60;
export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_MAX_SENDS = 3;
export const RECOVERY_SEND_WINDOW_SECONDS = 15 * 60;

export function mailEnabled(): boolean {
  return env.mailReady || (!env.isProd && !!env.mailOutbox);
}

function render(code: string): { subject: string; text: string; html: string } {
  const minutes = Math.round(RECOVERY_TTL_SECONDS / 60);
  const subject = 'WebVault — كود استعادة كلمة المرور';
  const text = [
    `كود استعادة كلمة المرور في WebVault هو: ${code}`,
    `Password recovery code for WebVault: ${code}`,
    '',
    `الصالحية ${minutes} دقيقة. لو انت ما طلبتش إعادة تعيين، تجاهل الرسالة دي وغيّر كلمة مرورك من الإعدادات.`,
    `This code expires in ${minutes} minutes. If you did not request a reset, ignore this email and change your password from Settings.`,
    '',
    'WebVault — لا ترد على هذا البريد، ولا تشارك الكود مع أحد.',
  ].join('\n');
  const html = [
    '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;line-height:1.7;color:#0f172a" dir="rtl">',
    '<p style="margin:0 0 8px;font-size:14px;color:#475569">WebVault — استعادة كلمة المرور</p>',
    `<p style="margin:0 0 16px;font-size:15px">كود إعادة التعيين بتاعك:</p>`,
    `<p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;direction:ltr;background:#f1f5f9;border-radius:14px;padding:14px 0">${code}</p>`,
    `<p style="margin:0 0 12px;font-size:13px;color:#475569">صالح ${minutes} دقيقة. لو انت ما طلبتش إعادة تعيين، تجاهل الرسالة دي وغيّر كلمة مرورك من الإعدادات.</p>`,
    '<p style="margin:0;font-size:12px;color:#94a3b8" dir="ltr">WebVault — never share this code. Do not reply to this address.</p>',
    '</div>',
  ].join('');
  return { subject, text, html };
}

/** True only when the transport reports the message as accepted. */
export async function sendRecoveryCode(to: string, code: string): Promise<boolean> {
  const message = render(code);

  if (!env.mailReady) {
    if (env.isProd || !env.mailOutbox) return false;
    try {
      appendFileSync(env.mailOutbox, `${JSON.stringify({ to, code, subject: message.subject, at: new Date().toISOString() })}\n`);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.resendFrom, to: [to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** What the settings panel shows — an address is personal data, so the local part is masked like a username. */
export function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  return domain ? `${hint(name)}@${domain}` : '•••';
}
