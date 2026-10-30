import 'server-only';
import type { Queryable } from '@/lib/db';
import { query } from '@/lib/db';

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

export async function notify(
  db: Queryable,
  userId: string,
  kind: string,
  title: string,
  body = '',
  link: string | null = null,
): Promise<void> {
  await db.query(`insert into notifications (user_id, kind, title, body, link) values ($1, $2, $3, $4, $5)`, [
    userId,
    kind,
    title.slice(0, 200),
    body.slice(0, 1000),
    link,
  ]);
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  return (
    await query<NotificationRow>(
      `select id, kind, title, body, link, read_at, created_at from notifications
        where user_id = $1 order by created_at desc, id desc limit $2`,
      [userId, limit],
    )
  ).rows;
}

export async function unreadCount(userId: string): Promise<number> {
  return (await query<{ n: number }>(`select count(*)::bigint as n from notifications where user_id = $1 and read_at is null`, [userId])).rows[0].n;
}

/** Scoped by user_id so one person can never mark another person's notifications. */
export async function markRead(userId: string, id: string): Promise<void> {
  await query(`update notifications set read_at = now() where id = $1 and user_id = $2 and read_at is null`, [id, userId]);
}

export async function markAllRead(userId: string): Promise<void> {
  await query(`update notifications set read_at = now() where user_id = $1 and read_at is null`, [userId]);
}
