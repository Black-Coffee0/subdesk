export function appUrl(): string {
  return (process.env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
}

export const isProd = () => process.env.NODE_ENV === 'production';

/** When true, users must verify their email before submitting a Reddit account or applying to tasks. */
export function emailVerificationRequired(): boolean {
  return process.env.EMAIL_VERIFICATION_REQUIRED !== 'false';
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL?.trim());
}
