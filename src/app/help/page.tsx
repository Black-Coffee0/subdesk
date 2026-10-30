import Link from 'next/link';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { Faq, faqItems } from '@/components/faq';
import { getSettings } from '@/services/settings';

export const metadata: Metadata = { title: 'Help and FAQ' };

export default async function HelpPage() {
  const s = await getSettings();
  return (
    <PublicShell>
      <h1 className="text-3xl sm:text-4xl">Help and FAQ</h1>
      <p className="mt-2 max-w-prose text-muted">Straight answers about eligibility, review and the wallet. Can&apos;t find yours? {s.supportEmail ? <>Email <a href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>.</> : 'Support details will appear here once the owner adds them.'}</p>
      <div className="mt-8"><Faq items={faqItems(s)} /></div>
      <div className="card mt-10">
        <h2 className="text-xl">Proving the account is yours</h2>
        <p className="mt-2 max-w-prose text-muted">
          On the submission page you&apos;ll get a short personal code. Paste it anywhere in the &ldquo;About&rdquo; section of your Reddit profile, then submit. Our check reads your public profile and looks for the code, so you never share a password. You can remove the code afterwards.
        </p>
        <Link href="/signup" className="btn btn-primary mt-4">Create an account</Link>
      </div>
    </PublicShell>
  );
}
