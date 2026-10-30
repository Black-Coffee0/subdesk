import Link from 'next/link';
import { Check as CheckIcon, Minus, X } from 'lucide-react';
import type { Check, SubredditEligibility } from '@/lib/eligibility';
import type { SubredditRow } from '@/services/eligibility';
import { fmtNum } from './ui';

const unitText = (c: Check, n: number) => (c.unit === 'months' ? `${n} ${n === 1 ? 'month' : 'months'}` : fmtNum(n));

/** One requirement per row: what is needed, what the verified account has, and whether it passes. */
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c) => {
        const state = c.passed === true ? 'ok' : c.passed === false ? 'bad' : 'unknown';
        return (
          <li key={c.key} className="flex items-start gap-2.5 text-[0.95rem]">
            <span className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full text-white ${state === 'ok' ? 'bg-ok' : state === 'bad' ? 'bg-bad' : 'bg-line-strong'}`}>
              {state === 'ok' ? <CheckIcon className="size-3.5" strokeWidth={3} aria-hidden /> : state === 'bad' ? <X className="size-3.5" strokeWidth={3} aria-hidden /> : <Minus className="size-3.5" strokeWidth={3} aria-hidden />}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{c.label}: </span>
              at least {unitText(c, c.required)}
              <span className="text-muted">
                {c.actual === null ? ' · not verified yet' : ` · yours is ${unitText(c, c.actual)}`}
              </span>
              <span className="sr-only">{state === 'ok' ? ' (met)' : state === 'bad' ? ' (not met)' : ' (unknown)'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SubredditCard({ s, e, taskCount }: { s: SubredditRow; e: SubredditEligibility; taskCount?: number }) {
  const eligible = e.state !== 'unavailable';
  const headline = e.state === 'eligible' ? 'Meets the configured requirements' : e.state === 'eligible_review' ? 'Meets the numbers. This subreddit needs a manual review.' : e.blockedReason ?? 'Not available to you right now';
  return (
    <article className={`rounded-card border bg-surface p-5 ${eligible ? 'border-line' : 'border-line bg-surface/70'}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-[1.2rem] font-semibold">r/{s.name}</h3>
          <p className="text-sm text-muted">{s.category_name}</p>
        </div>
        <span className={`pill ${e.state === 'eligible' ? 'pill-ok' : e.state === 'eligible_review' ? 'pill-warn' : 'pill-neutral'}`}>
          {e.state === 'eligible' ? 'Eligible' : e.state === 'eligible_review' ? 'Eligible, review needed' : 'Unavailable'}
        </span>
      </header>
      {s.description && <p className="mt-3 text-[0.95rem]">{s.description}</p>}
      <div className="mt-4"><CheckList checks={e.checks} /></div>
      {s.extra_requirements && (
        <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm"><span className="font-semibold">Also required: </span>{s.extra_requirements}</p>
      )}
      {s.restrictions && (
        <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm"><span className="font-semibold">Restrictions: </span>{s.restrictions}</p>
      )}
      <p className={`mt-4 text-[0.95rem] font-semibold ${e.state === 'eligible' ? 'text-ok' : e.state === 'eligible_review' ? 'text-warn' : 'text-muted'}`}>{headline}</p>
      {e.state === 'unavailable' && e.unmet.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">{e.unmet.map((u) => <li key={u}>{u}</li>)}</ul>
      )}
      {e.notes.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {eligible && (
        <div className="mt-4">
          <Link href={`/tasks?subreddit=${s.id}`} className="btn btn-primary btn-sm">View tasks{taskCount !== undefined ? ` (${taskCount})` : ''}</Link>
        </div>
      )}
    </article>
  );
}
