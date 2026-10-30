'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

function isActive(path: string, href: string, exact?: boolean) {
  if (exact || href === '/' || href === '/admin') return path === href;
  return path === href || path.startsWith(`${href}/`);
}

type Variant = 'top' | 'tab' | 'side';

const CLASSES: Record<Variant, { base: string; on: string; off: string }> = {
  top: {
    base: 'rounded-lg px-3 py-2 text-[0.95rem] font-semibold no-underline transition-colors',
    on: 'bg-accent-soft text-accent',
    off: 'text-muted hover:bg-black/5 hover:text-ink',
  },
  tab: {
    base: 'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.72rem] font-semibold no-underline',
    on: 'text-accent',
    off: 'text-muted hover:text-ink',
  },
  side: {
    base: 'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[0.95rem] font-semibold no-underline transition-colors',
    on: 'bg-accent-soft text-accent',
    off: 'text-muted hover:bg-black/5 hover:text-ink',
  },
};

export function NavLink({ href, children, variant = 'top', exact }: { href: string; children: ReactNode; variant?: Variant; exact?: boolean }) {
  const path = usePathname();
  const on = isActive(path, href, exact);
  const c = CLASSES[variant];
  return (
    <Link href={href} className={`${c.base} ${on ? c.on : c.off}`} aria-current={on ? 'page' : undefined}>
      {children}
    </Link>
  );
}
