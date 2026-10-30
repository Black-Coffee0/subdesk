import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bell, ClipboardList, House, ListChecks, LogOut, Wallet, User, LayoutDashboard, FileCheck2, Layers, Users, ScrollText, Settings, Coins, ListTodo, ShieldCheck } from 'lucide-react';
import { logoutAction, adminLogoutAction } from '@/app/actions/auth';
import { getSettings } from '@/services/settings';
import { unreadCount } from '@/services/notifications';
import type { SessionUser } from '@/services/auth';
import { Banner, Logo } from './ui';
import { NavLink } from './nav';

export function Announcement({ enabled, text }: { enabled: boolean; text: string }) {
  if (!enabled || !text.trim()) return null;
  return (
    <div className="border-b border-[#cfd5ff] bg-accent-soft px-4 py-2 text-center text-[0.95rem] text-[#1f2a8f]" role="status">
      {text}
    </div>
  );
}

// ------------------------------------------------------------------ public

export async function PublicShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const s = await getSettings();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">Skip to content</a>
      <Announcement enabled={s.announcementEnabled} text={s.announcementText} />
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo name={s.siteName} />
          <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Main">
            <Link href="/help" className="hidden rounded-lg px-3 py-2 text-[0.95rem] font-semibold text-muted no-underline hover:text-ink sm:block">Help</Link>
            <Link href="/login" className="btn btn-quiet btn-sm">Log in</Link>
            <Link href="/signup" className="btn btn-primary btn-sm">Get started</Link>
          </nav>
        </div>
      </header>
      <main id="main" className={`mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-12 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</main>
      <Footer name={s.siteName} email={s.supportEmail} />
    </div>
  );
}

export function Footer({ name, email }: { name: string; email?: string }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <p className="font-display text-base font-semibold text-ink">{name}</p>
          <p className="mt-1">
            Independent platform. Not affiliated with, endorsed by or sponsored by Reddit, Inc. We never ask for your Reddit password.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
          <Link href="/help" className="text-muted">Help and FAQ</Link>
          <Link href="/terms" className="text-muted">Terms of Service</Link>
          <Link href="/privacy" className="text-muted">Privacy Policy</Link>
          {email && <a href={`mailto:${email}`} className="text-muted">{email}</a>}
        </nav>
      </div>
    </footer>
  );
}

// ------------------------------------------------------------------ signed-in user

export async function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [s, unread] = await Promise.all([getSettings(), unreadCount(user.id)]);
  const badge = unread > 0 ? (
    <span className="absolute right-[calc(50%-1.35rem)] top-1.5 grid min-w-[1.1rem] place-items-center rounded-full bg-accent px-1 text-[0.65rem] font-bold leading-[1.1rem] text-white" aria-label={`${unread} unread`}>
      {unread > 9 ? '9+' : unread}
    </span>
  ) : null;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">Skip to content</a>
      <Announcement enabled={s.announcementEnabled} text={s.announcementText} />
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo name={s.siteName} href="/dashboard" />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink href="/dashboard">Dashboard</NavLink>
            <NavLink href="/tasks" exact>Tasks</NavLink>
            <NavLink href="/eligibility">Eligibility</NavLink>
            <NavLink href="/tasks/mine">My tasks</NavLink>
            <NavLink href="/wallet">Wallet</NavLink>
            <NavLink href="/help">Help</NavLink>
          </nav>
          <div className="flex items-center gap-1">
            <Link href="/notifications" className="relative hidden size-10 place-items-center rounded-lg text-muted hover:bg-black/5 hover:text-ink md:grid" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-accent ring-2 ring-paper" />}
            </Link>
            <Link href="/profile" className="hidden rounded-lg px-3 py-2 text-[0.95rem] font-semibold text-ink no-underline hover:bg-black/5 md:block">{user.username}</Link>
            <form action={logoutAction}>
              <button className="btn btn-quiet btn-sm" type="submit"><LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">Log out</span><span className="sm:hidden">Out</span></button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="has-tabbar mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      <div className="hidden md:block"><Footer name={s.siteName} email={s.supportEmail} /></div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgb(22_27_46/0.25)] md:hidden" aria-label="Main">
        <NavLink href="/dashboard" variant="tab"><House className="size-5" aria-hidden />Home</NavLink>
        <NavLink href="/tasks" variant="tab"><ListChecks className="size-5" aria-hidden />Tasks</NavLink>
        <NavLink href="/wallet" variant="tab"><Wallet className="size-5" aria-hidden />Wallet</NavLink>
        <span className="relative flex flex-1"><NavLink href="/notifications" variant="tab"><Bell className="size-5" aria-hidden />Alerts</NavLink>{badge}</span>
        <NavLink href="/profile" variant="tab"><User className="size-5" aria-hidden />Profile</NavLink>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ admin

const ADMIN_NAV: { href: string; label: string; icon: ReactNode; perm?: string; exact?: boolean }[] = [
  { href: '/admin', label: 'Overview', icon: <LayoutDashboard className="size-[1.1rem]" aria-hidden />, exact: true },
  { href: '/admin/applications', label: 'Applications', icon: <FileCheck2 className="size-[1.1rem]" aria-hidden />, perm: 'review_applications' },
  { href: '/admin/tasks', label: 'Tasks', icon: <ClipboardList className="size-[1.1rem]" aria-hidden />, perm: 'manage_tasks' },
  { href: '/admin/subreddits', label: 'Subreddits', icon: <Layers className="size-[1.1rem]" aria-hidden />, perm: 'manage_tasks' },
  { href: '/admin/task-applications', label: 'Task applicants', icon: <ListTodo className="size-[1.1rem]" aria-hidden />, perm: 'manage_tasks' },
  { href: '/admin/users', label: 'Users', icon: <Users className="size-[1.1rem]" aria-hidden />, perm: 'manage_users' },
  { href: '/admin/wallet', label: 'Wallet', icon: <Coins className="size-[1.1rem]" aria-hidden /> },
  { href: '/admin/audit', label: 'Audit log', icon: <ScrollText className="size-[1.1rem]" aria-hidden /> },
  { href: '/admin/settings', label: 'Settings', icon: <Settings className="size-[1.1rem]" aria-hidden />, perm: 'manage_settings' },
];

export async function AdminShell({ admin, children }: { admin: SessionUser; children: ReactNode }) {
  const s = await getSettings();
  const items = ADMIN_NAV.filter((i) => !i.perm || admin.permissions.includes(i.perm));
  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo name={s.siteName} href="/admin" small />
            <span className="pill pill-info"><ShieldCheck className="size-3.5" aria-hidden />Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted sm:inline">{admin.username}</span>
            <form action={adminLogoutAction}><button className="btn btn-outline btn-sm" type="submit"><LogOut className="size-4" aria-hidden />Log out</button></form>
          </div>
        </div>
        <nav className="border-t border-line lg:hidden" aria-label="Admin">
          <div className="flex gap-1 overflow-x-auto px-3 py-2">
            {items.map((i) => <NavLink key={i.href} href={i.href} variant="side" exact={i.exact}>{i.icon}{i.label}</NavLink>)}
          </div>
        </nav>
      </header>
      <div className="mx-auto flex max-w-[88rem] gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <aside className="hidden w-52 shrink-0 lg:block">
          <nav className="sticky top-20 flex flex-col gap-0.5" aria-label="Admin">
            {items.map((i) => <NavLink key={i.href} href={i.href} variant="side" exact={i.exact}>{i.icon}{i.label}</NavLink>)}
          </nav>
        </aside>
        <main id="main" className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return <Banner tone="warn" title="You do not have access to this section">Your administrator account does not include the “{what}” permission.</Banner>;
}
