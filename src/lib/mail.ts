import 'server-only';
import { appUrl, isProd, mailConfigured } from './config';

export interface MailResult {
  delivered: boolean;
  /** Only populated outside production when no SMTP is configured, to keep local development usable. */
  devLink?: string;
}

/**
 * Email is optional: the site works without it. With SMTP_URL set, mail is sent via nodemailer.
 * Without it, the message is logged to the server console (never to the browser in production).
 */
export async function sendMail(opts: { to: string; subject: string; text: string; link?: string }): Promise<MailResult> {
  if (!mailConfigured()) {
    if (!isProd() && process.env.NODE_ENV !== 'test') {
      console.log(`\n[mail:not-configured] To: ${opts.to}\nSubject: ${opts.subject}\n${opts.text}\n`);
    }
    return { delivered: false, devLink: isProd() ? undefined : opts.link };
  }
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport(process.env.SMTP_URL!);
    await transport.sendMail({
      from: process.env.MAIL_FROM?.trim() || 'Subdesk <no-reply@localhost>',
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    return { delivered: true };
  } catch (e) {
    console.error('[mail] send failed:', (e as Error).message);
    return { delivered: false };
  }
}

export const verifyLink = (token: string) => `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
export const resetLink = (token: string) => `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
