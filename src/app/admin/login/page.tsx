import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ActionForm, Field, PasswordField, SubmitButton } from '@/components/forms';
import { Logo } from '@/components/ui';
import { getSettings } from '@/services/settings';
import { adminLoginAction } from '@/app/actions/auth';
import { getCurrentAdmin } from '@/server/session';

export const metadata: Metadata = { title: 'Administrator login', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await getCurrentAdmin()) redirect('/admin');
  const s = await getSettings();
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo name={s.siteName} href="/admin/login" /></div>
        <div className="card card-lift">
          <h1 className="text-2xl">Administrator login</h1>
          <p className="mb-5 mt-1 text-sm text-muted">Sessions last 12 hours. Every action is recorded in the audit log.</p>
          <ActionForm action={adminLoginAction}>
            <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
            <PasswordField name="password" label="Password" />
            <SubmitButton className="btn btn-primary btn-block" pendingLabel="Logging in…">Log in</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
