import 'server-only';
import type { Queryable } from './db';
import { query } from './db';
import { rateLimited } from './errors';

/**
 * Fixed-window rate limiter stored in the database, so it works across
 * serverless instances. Throws a friendly AppError when the limit is exceeded.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
  db?: Queryable,
  message?: string,
): Promise<void> {
  const run = db ? db.query.bind(db) : query;
  const r = await run<{ count: number }>(
    `insert into rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2::double precision) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2::double precision) then now() else rate_limits.window_start end
     returning count`,
    [key, windowSeconds],
  );
  if (r.rows[0].count > max) throw rateLimited(message);
}

export async function pruneRateLimits(): Promise<void> {
  await query(`delete from rate_limits where window_start < now() - interval '1 day'`);
}
