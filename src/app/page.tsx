import Link from 'next/link';
import { CalendarClock, FileText, MessageSquare, ShieldCheck, Lock, Wallet, UserCheck } from 'lucide-react';
import { PublicShell } from '@/components/shells';
import { Faq, faqItems } from '@/components/faq';
import { monthsLabel } from '@/components/ui';
import { getSettings } from '@/services/settings';
import { getCurrentUser } from '@/server/session';

export default async function Landing() {
  const [s, user] = await Promise.all([getSettings(), getCurrentUser()]);
  const steps = [
    ['Create an account', 'Sign up with your email and pick a username, then confirm your email address.'],
    ['Submit your Reddit profile', 'Paste your profile link. We look up the account’s age and karma from Reddit, and never ask for your password.'],
    ['Meet the minimum requirements', 'Your account needs the minimum age and karma shown above. All three, not two out of three.'],
    ['Wait for administrator approval', 'The platform administrator reviews every application by hand and approves or rejects it, with a reason.'],
    ['Browse and apply for eligible tasks', 'You see only the subreddits and tasks your verified account qualifies for, with the exact requirements for each.'],
  ];
  return (
    <PublicShell wide>
      <section className="grid items-center gap-10 pb-14 pt-2 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pb-20 lg:pt-6">
        <div>
          <h1 className="text-[2.5rem] leading-[1.04] sm:text-6xl">Find the tasks your Reddit account qualifies for</h1>
          <p className="mt-5 max-w-[34rem] text-lg text-muted">
            Submit your Reddit profile for review. Once an administrator approves it, you see which subreddits you&apos;re eligible for and can apply to their tasks.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            {user ? (
              <Link href="/dashboard" className="btn btn-primary btn-lg">Go to your dashboard</Link>
            ) : (
              <>
                <Link href="/signup" className="btn btn-primary btn-lg">Get started</Link>
                <Link href="/login" className="btn btn-outline btn-lg">Log in</Link>
              </>
            )}
          </div>
        </div>

        <aside className="card card-lift" aria-labelledby="check-title">
          <h2 id="check-title" className="text-xl">What we check</h2>
          <p className="mt-1 text-sm text-muted">The minimums your Reddit account needs before it can be approved.</p>
          <ol className="thread mt-6 [&_.thread-node]:border-accent-soft [&_.thread-node]:bg-accent-soft [&_.thread-node]:text-accent">
            {[
              [CalendarClock, 'Account age', `At least ${monthsLabel(s.minAccountAgeMonths)}`],
              [MessageSquare, 'Comment karma', `At least ${s.minCommentKarma}`],
              [FileText, 'Post karma', `At least ${s.minPostKarma}`],
              [ShieldCheck, 'Administrator approval', 'Final decision, always manual'],
            ].map(([Icon, label, value], i) => {
              const I = Icon as typeof CalendarClock;
              return (
                <li key={String(label)} className="check-row" style={{ paddingBottom: i === 3 ? 0 : '1.2rem' }}>
                  <span className="thread-node"><I className="size-4" aria-hidden /></span>
                  <p className="font-semibold leading-tight">{String(label)}</p>
                  <p className="text-[0.95rem] text-muted">{String(value)}</p>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
            Meeting every minimum lets you apply. It does not guarantee approval.
          </p>
        </aside>
      </section>

      <section className="border-t border-line py-14" aria-labelledby="how">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div>
            <h2 id="how" className="text-3xl">How it works</h2>
            <p className="mt-3 max-w-sm text-muted">Five steps, in this order. Nothing unlocks until the administrator approves your account.</p>
          </div>
          <ol className="thread">
            {steps.map(([title, body], i) => (
              <li key={title}>
                <span className="thread-node">{i + 1}</span>
                <h3 className="font-sans text-[1.1rem] font-semibold tracking-normal">{title}</h3>
                <p className="mt-1 max-w-prose text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-line py-14" aria-labelledby="notes">
        <h2 id="notes" className="text-3xl">Good to know before you start</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            [UserCheck, 'You prove the account is yours', 'We give you a short code to place in your Reddit profile bio so we can confirm you control the account. No passwords involved.'],
            [Lock, 'We keep only what eligibility needs', 'Your Reddit username, account creation date and karma, plus your platform activity. You can request deletion at any time.'],
            [Wallet, 'The wallet is a ledger, not a bank', 'It records balances and transactions. Withdrawals and payments are not available yet.'],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Lock;
            return (
              <div key={String(title)} className="rounded-card border border-line bg-surface p-5">
                <I className="size-6 text-accent" aria-hidden />
                <h3 className="mt-3 font-sans text-[1.05rem] font-semibold tracking-normal">{String(title)}</h3>
                <p className="mt-1.5 text-[0.95rem] text-muted">{String(body)}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-t border-line py-14" aria-labelledby="faq">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <h2 id="faq" className="text-3xl">Questions people ask</h2>
          <Faq items={faqItems(s)} />
        </div>
      </section>

      {!user && (
        <section className="rounded-card bg-ink px-6 py-10 text-center text-white sm:px-10">
          <h2 className="text-3xl text-white">Ready to see where your account fits?</h2>
          <p className="mx-auto mt-2 max-w-md text-white/75">Creating an account is free. Review happens after you submit your Reddit profile.</p>
          <Link href="/signup" className="btn btn-lg mt-6 bg-white text-ink hover:bg-white/90 hover:text-ink">Create an account</Link>
        </section>
      )}
    </PublicShell>
  );
}
