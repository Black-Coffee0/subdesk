import Link from 'next/link';
import type { Metadata } from 'next';
import { Empty, PageTitle, fmtDateTime } from '@/components/ui';
import { listNotifications } from '@/services/notifications';
import { markAllReadAction, markReadAction } from '@/app/actions/user';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listNotifications(user.id, 50);
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageTitle title="Notifications" actions={unread > 0 ? <form action={markAllReadAction}><button className="btn btn-outline btn-sm" type="submit">Mark all as read</button></form> : undefined}>
        {unread > 0 ? `${unread} unread` : 'You’re all caught up.'}
      </PageTitle>
      {items.length === 0 ? (
        <Empty title="No notifications yet">Updates about your application, tasks and wallet show up here.</Empty>
      ) : (
        <ul className="divide-list overflow-hidden rounded-card border border-line bg-surface">
          {items.map((n) => (
            <li key={n.id} className={`row flex gap-3 ${n.read_at ? '' : 'bg-accent-soft/50'}`}>
              <span className={`mt-2 size-2.5 flex-none rounded-full ${n.read_at ? 'bg-transparent' : 'bg-accent'}`} role={n.read_at ? undefined : 'img'} aria-label={n.read_at ? undefined : 'Unread'} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug">{n.title}</p>
                {n.body && <p className="text-[0.95rem] text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{fmtDateTime(n.created_at)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {n.link && <Link href={n.link} className="text-sm font-semibold">Open</Link>}
                  {!n.read_at && (
                    <form action={markReadAction}><input type="hidden" name="id" value={n.id} /><button type="submit" className="text-sm font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">Mark as read</button></form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
