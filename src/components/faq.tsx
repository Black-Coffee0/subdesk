import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PlatformSettings } from '@/services/settings';
import { monthsLabel } from './ui';

export interface FaqItem { q: string; a: ReactNode }

/** Every answer describes how the platform works. None promises earnings, approval times or task supply. */
export function faqItems(s: PlatformSettings): FaqItem[] {
  return [
    {
      q: 'How do I submit my Reddit profile?',
      a: <>Create an account, verify your email, then open <Link href="/application/submit">Submit Reddit account</Link> and paste your profile link, for example <code>https://www.reddit.com/user/yourname/</code>. We use it to look up your account&apos;s public details. We never ask for your Reddit password.</>,
    },
    {
      q: 'What are the minimum eligibility requirements?',
      a: <>Your Reddit account must be at least {monthsLabel(s.minAccountAgeMonths)} old, with at least {s.minCommentKarma} comment karma and at least {s.minPostKarma} post karma. You need all three. Meeting them lets you apply; the administrator still makes the final decision.</>,
    },
    {
      q: 'How long does account review take?',
      a: <>There is no fixed time. Applications are reviewed by hand by the platform administrator. You&apos;ll get a notification the moment your status changes, and your Application page always shows where things stand.</>,
    },
    {
      q: 'Why was my account rejected?',
      a: <>When an application is rejected, the administrator writes a reason that appears on your Application page. Common causes are not meeting a minimum, not being able to confirm the account is yours, or an incomplete profile. If resubmission is allowed, you can send a corrected application.</>,
    },
    {
      q: 'How does subreddit eligibility work?',
      a: <>Once you&apos;re approved, each subreddit the administrator has configured is checked against your verified account age and karma, plus any extra rules for that subreddit. You&apos;ll see which ones you qualify for, which you don&apos;t, and exactly what&apos;s missing. Meeting the numbers never guarantees a subreddit&apos;s own moderators will accept you.</>,
    },
    {
      q: 'Can I withdraw money from the wallet?',
      a: <>No. The wallet is an internal record of balances and transactions. Withdrawals, deposits and other payment features are not available yet, and nothing here moves real money.</>,
    },
    {
      q: 'How can I contact support?',
      a: s.supportEmail
        ? <>Email <a href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a> and include your platform username.</>
        : <>The platform owner hasn&apos;t published a support address yet. Check back on this page.</>,
    },
  ];
}

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div>
      {items.map((it) => (
        <details key={it.q} className="faq">
          <summary>{it.q}</summary>
          <div>{it.a}</div>
        </details>
      ))}
    </div>
  );
}
