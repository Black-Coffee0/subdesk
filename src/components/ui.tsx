import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronUp, CircleCheck, Info, TriangleAlert, OctagonAlert } from 'lucide-react';

// ------------------------------------------------------------------ formatting

const TZ = 'Asia/Kolkata';
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

export const fmtDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(new Date(d)) : '—');
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? `${dateTimeFmt.format(new Date(d))} IST` : '—');
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN').format(n));

export function monthsLabel(m: number) {
  return m === 1 ? '1 month' : `${m} months`;
}

// ------------------------------------------------------------------ brand

/** An upvote chevron riding a thread line: the mark is about karma and threads, not a Reddit logo. */
export function Logo({ name, href = '/', small = false }: { name: string; href?: string; small?: boolean }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 font-display text-[1.2rem] font-bold tracking-tight text-ink no-underline hover:text-ink" aria-label={`${name} home`}>
      <span className={`grid place-items-center rounded-[0.65rem] bg-accent text-white ${small ? 'size-7' : 'size-8'}`} aria-hidden>
        <ChevronUp className="size-5" strokeWidth={3} />
      </span>
      {name}
    </Link>
  );
}

// ------------------------------------------------------------------ status

const STATUS_TONE: Record<string, string> = {
  Approved: 'pill-ok',
  Completed: 'pill-ok',
  Accepted: 'pill-ok',
  Available: 'pill-info',
  'Pending Verification': 'pill-warn',
  'Pending Admin Review': 'pill-warn',
  'Needs More Information': 'pill-warn',
  Applied: 'pill-info',
  'Under Review': 'pill-warn',
  Rejected: 'pill-bad',
  Suspended: 'pill-bad',
  Cancelled: 'pill-neutral',
  'Not Submitted': 'pill-neutral',
  Verified: 'pill-ok',
  Unverified: 'pill-bad',
  'Manual Review Required': 'pill-warn',
  active: 'pill-ok',
  blocked: 'pill-bad',
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${STATUS_TONE[status] ?? 'pill-neutral'}`}>{label ?? status}</span>;
}

export const VERIFICATION_LABEL: Record<string, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  manual_review_required: 'Manual Review Required',
};
export function VerificationPill({ state }: { state: string }) {
  const label = VERIFICATION_LABEL[state] ?? state;
  return <StatusPill status={label} />;
}

export const SOURCE_LABEL: Record<string, string> = {
  reddit_api: 'Retrieved from Reddit',
  admin_manual: 'Entered by an administrator',
  test_fixture: 'Test data',
};

/**
 * Names what a verification record actually did. An automatic attempt that only recorded
 * "Reddit API not available" must not read as if Reddit had been queried successfully.
 */
export function checkMethodLabel(r: { method: string; outcome: string }, audience: 'admin' | 'user'): string {
  if (r.method === 'admin_manual') return audience === 'admin' ? 'Administrator (manual)' : 'Entered by an administrator after reviewing your profile';
  if (r.method === 'test_fixture') return audience === 'admin' ? 'Test fixture' : 'Test data (not from Reddit)';
  if (r.outcome === 'verified') return audience === 'admin' ? 'Reddit API' : 'Automatic check with the Reddit API';
  if (r.outcome === 'manual_review_required') return audience === 'admin' ? 'Automatic check could not run' : 'Automatic check could not be completed';
  return audience === 'admin' ? 'Reddit API (account not verified)' : 'Automatic check with the Reddit API (not verified)';
}

// ------------------------------------------------------------------ layout bits

export function Banner({ tone = 'info', title, children }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; title?: string; children?: ReactNode }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? TriangleAlert : tone === 'bad' ? OctagonAlert : Info;
  return (
    <div className={`banner banner-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon className="size-5" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function PageTitle({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.65rem] sm:text-[2rem]">{title}</h1>
        {children && <div className="mt-1.5 max-w-prose text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[1.2rem]">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-9 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-muted">{label}</div>
      <div className="font-display text-[1.6rem] font-bold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 text-sm text-muted">{hint}</div>}
    </div>
  );
}

/** Label / value pairs that read well on a phone. */
export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-list">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm text-muted sm:w-48">{it.label}</dt>
          <dd className="min-w-0 break-words font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, total, pageSize, path, params = {} }: { page: number; total: number; pageSize: number; path: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      {page > 1 ? <Link className="btn btn-outline btn-sm" href={href(page - 1)}>Previous</Link> : <span />}
      <span className="text-muted">Page {page} of {pages}</span>
      {page < pages ? <Link className="btn btn-outline btn-sm" href={href(page + 1)}>Next</Link> : <span />}
    </nav>
  );
}

export const pageNum = (v: string | string[] | undefined) => Math.max(1, Math.min(10_000, Number(Array.isArray(v) ? v[0] : v) || 1));
export const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';

/** Reddit links open in a new tab; noopener keeps the new tab from reaching back into ours. */
export function RedditLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium">
      {children}
    </a>
  );
}
