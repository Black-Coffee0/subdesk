import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { Prose } from '@/components/prose';
import { fmtDate } from '@/components/ui';
import { getContentPage } from '@/services/settings';

export const metadata: Metadata = { title: 'Terms of Service' };

export default async function Page() {
  const page = await getContentPage('terms');
  if (!page) notFound();
  return (
    <PublicShell>
      <h1 className="text-3xl sm:text-4xl">{page.title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {fmtDate(page.updated_at)}</p>
      <div className="mt-6"><Prose body={page.body} /></div>
    </PublicShell>
  );
}
