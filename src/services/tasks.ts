import 'server-only';
import { z } from 'zod';
import type { Queryable } from '@/lib/db';
import { query, tx } from '@/lib/db';
import { isEligible, type SubredditEligibility } from '@/lib/eligibility';
import { AppError, forbidden, notFound } from '@/lib/errors';
import { parseRupeesToPaise } from '@/lib/money';
import { isUniqueViolation } from '@/lib/pg-errors';
import { rateLimit } from '@/lib/rate-limit';
import { intField, likePattern, parseInput, requiredText, text } from '@/lib/validation';
import { writeAudit } from './audit';
import { requireActiveUser, requireAdmin } from './authz';
import {
  SUBREDDIT_SELECT,
  evaluateUserForSubreddit,
  getUserEligibility,
  rulesOf,
  withEligibilityDiff,
  type SubredditRow,
} from './eligibility';
import { notify } from './notifications';
import { getSettings } from './settings-store';
import type { RequestMeta, TaskAppStatus } from './types';
import { creditTaskReward } from './wallet';

// =============================================================== categories

export interface CategoryRow { id: string; name: string; active: boolean }

export async function listCategories(activeOnly = false): Promise<CategoryRow[]> {
  return (await query<CategoryRow>(`select id, name, active from task_categories ${activeOnly ? 'where active' : ''} order by lower(name)`)).rows;
}

export async function adminSaveCategory(adminId: string, input: { id?: string; name: string; active?: boolean }, meta?: RequestMeta): Promise<void> {
  const v = parseInput(z.object({ id: z.string().uuid().optional(), name: requiredText(2, 60, 'Category name'), active: z.boolean().optional() }), input);
  try {
    await tx(async (db) => {
      await requireAdmin(db, adminId, 'manage_tasks');
      if (v.id) {
        const r = await db.query(`update task_categories set name = $2, active = coalesce($3, active) where id = $1`, [v.id, v.name, v.active ?? null]);
        if (!r.rowCount) throw notFound('That category');
      } else {
        await db.query(`insert into task_categories (name) values ($1)`, [v.name]);
      }
      await writeAudit(db, { actorId: adminId, action: v.id ? 'category.update' : 'category.create', targetType: 'category', targetId: v.id, details: { name: v.name, active: v.active } }, meta);
    });
  } catch (e) {
    if (isUniqueViolation(e, 'task_categories_name_uq')) throw new AppError('validation', 'Please check the highlighted fields.', { name: 'A category with this name already exists.' });
    throw e;
  }
}

// =============================================================== subreddits

const SubredditInput = z.object({
  name: z.string({ error: 'Enter the subreddit name.' }).trim().transform((v) => v.replace(/^\/?r\//i, '')).pipe(z.string().regex(/^[A-Za-z0-9_]{2,21}$/, 'Use 2–21 letters, numbers or underscores (without "r/").')),
  categoryId: z.string().uuid('Choose a category.'),
  description: text(500, 'Description'),
  restrictions: text(1000, 'Restrictions'),
  extraRequirements: text(1000, 'Additional requirements'),
  active: z.boolean(),
  minAccountAgeMonths: intField(0, 240, 'Minimum account age'),
  minCommentKarma: intField(0, 100_000_000, 'Minimum comment karma'),
  minPostKarma: intField(0, 100_000_000, 'Minimum post karma'),
  requiresManualReview: z.boolean(),
});
export type SubredditInputT = z.input<typeof SubredditInput>;

export async function adminListSubreddits(adminId: string): Promise<(SubredditRow & { task_count: number })[]> {
  await requireAdmin({ query }, adminId);
  return (await query<SubredditRow & { task_count: number }>(
    `select s.id, s.name, s.category_id, c.name as category_name, s.description, s.restrictions, s.extra_requirements, s.active,
            s.min_account_age_months, s.min_comment_karma, s.min_post_karma, s.requires_manual_review,
            (select count(*)::bigint from tasks t where t.subreddit_id = s.id) as task_count
       from subreddits s join task_categories c on c.id = s.category_id order by lower(s.name)`,
  )).rows;
}

export async function adminGetSubreddit(adminId: string, id: string): Promise<SubredditRow> {
  await requireAdmin({ query }, adminId);
  const r = (await query<SubredditRow>(`${SUBREDDIT_SELECT} where s.id = $1`, [id])).rows[0];
  if (!r) throw notFound('That subreddit');
  return r;
}

export async function adminSaveSubreddit(adminId: string, id: string | null, input: SubredditInputT, meta?: RequestMeta): Promise<string> {
  const v = parseInput(SubredditInput, input);
  return withEligibilityDiff(async () => {
    try {
      return await tx(async (db) => {
        await requireAdmin(db, adminId, 'manage_tasks');
        const cat = await db.query(`select 1 from task_categories where id = $1`, [v.categoryId]);
        if (!cat.rowCount) throw new AppError('validation', 'Please check the highlighted fields.', { categoryId: 'Choose a category.' });
        let before: SubredditRow | undefined;
        let outId = id;
        if (id) {
          before = (await db.query<SubredditRow>(`${SUBREDDIT_SELECT} where s.id = $1 for update of s`, [id])).rows[0];
          if (!before) throw notFound('That subreddit');
          await db.query(
            `update subreddits set name=$2, category_id=$3, description=$4, restrictions=$5, extra_requirements=$6, active=$7,
                    min_account_age_months=$8, min_comment_karma=$9, min_post_karma=$10, requires_manual_review=$11, updated_at=now() where id=$1`,
            [id, v.name, v.categoryId, v.description, v.restrictions, v.extraRequirements, v.active, v.minAccountAgeMonths, v.minCommentKarma, v.minPostKarma, v.requiresManualReview],
          );
        } else {
          outId = (await db.query<{ id: string }>(
            `insert into subreddits (name, category_id, description, restrictions, extra_requirements, active, min_account_age_months, min_comment_karma, min_post_karma, requires_manual_review)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
            [v.name, v.categoryId, v.description, v.restrictions, v.extraRequirements, v.active, v.minAccountAgeMonths, v.minCommentKarma, v.minPostKarma, v.requiresManualReview],
          )).rows[0].id;
        }
        const after = {
          name: v.name, active: v.active, min_account_age_months: v.minAccountAgeMonths, min_comment_karma: v.minCommentKarma,
          min_post_karma: v.minPostKarma, requires_manual_review: v.requiresManualReview, extra_requirements: v.extraRequirements,
        };
        const prev = before && {
          name: before.name, active: before.active, min_account_age_months: before.min_account_age_months, min_comment_karma: before.min_comment_karma,
          min_post_karma: before.min_post_karma, requires_manual_review: before.requires_manual_review, extra_requirements: before.extra_requirements,
        };
        await writeAudit(db, { actorId: adminId, action: id ? 'subreddit.update' : 'subreddit.create', targetType: 'subreddit', targetId: outId!, details: { before: prev, after } }, meta);
        return outId!;
      });
    } catch (e) {
      if (isUniqueViolation(e, 'subreddits_name_uq')) throw new AppError('validation', 'Please check the highlighted fields.', { name: 'This subreddit is already configured.' });
      throw e;
    }
  });
}

// ===================================================================== tasks

export interface TaskRow {
  id: string;
  subreddit_id: string;
  subreddit_name: string;
  category_id: string;
  category_name: string;
  title: string;
  description: string;
  instructions: string;
  reward_paise: number | null;
  active: boolean;
  allow_repeat: boolean;
  created_at: Date;
}

const TASK_SELECT = `select t.id, t.subreddit_id, s.name as subreddit_name, t.category_id, c.name as category_name, t.title, t.description,
  t.instructions, t.reward_paise, t.active, t.allow_repeat, t.created_at
  from tasks t join subreddits s on s.id = t.subreddit_id join task_categories c on c.id = t.category_id`;

const TaskInput = z.object({
  subredditId: z.string().uuid('Choose a subreddit.'),
  categoryId: z.string().uuid('Choose a category.'),
  title: requiredText(3, 120, 'Title'),
  description: text(1000, 'Description'),
  instructions: text(5000, 'Instructions'),
  reward: z.string().trim().max(20),
  active: z.boolean(),
  allowRepeat: z.boolean(),
});
export type TaskInputT = z.input<typeof TaskInput>;

export async function adminListTasks(adminId: string): Promise<(TaskRow & { open_applications: number })[]> {
  await requireAdmin({ query }, adminId);
  return (await query<TaskRow & { open_applications: number }>(
    `select t.id, t.subreddit_id, s.name as subreddit_name, t.category_id, c.name as category_name, t.title, t.description, t.instructions,
            t.reward_paise, t.active, t.allow_repeat, t.created_at,
            (select count(*)::bigint from task_applications a where a.task_id = t.id and a.status in ('Applied','Under Review','Accepted')) as open_applications
       from tasks t join subreddits s on s.id = t.subreddit_id join task_categories c on c.id = t.category_id
      order by t.created_at desc`,
  )).rows;
}

export async function adminGetTask(adminId: string, id: string): Promise<TaskRow> {
  await requireAdmin({ query }, adminId);
  const r = (await query<TaskRow>(`${TASK_SELECT} where t.id = $1`, [id])).rows[0];
  if (!r) throw notFound('That task');
  return r;
}

export async function adminSaveTask(adminId: string, id: string | null, input: TaskInputT, meta?: RequestMeta): Promise<string> {
  const v = parseInput(TaskInput, input);
  let reward: number | null = null;
  if (v.reward !== '') {
    reward = parseRupeesToPaise(v.reward);
    if (reward === null) throw new AppError('validation', 'Please check the highlighted fields.', { reward: 'Enter an amount like 50 or 49.50, or leave it empty for no reward.' });
  }
  return withEligibilityDiff(() =>
    tx(async (db) => {
      await requireAdmin(db, adminId, 'manage_tasks');
      const refs = await db.query(`select (select count(*) from subreddits where id = $1) as s, (select count(*) from task_categories where id = $2) as c`, [v.subredditId, v.categoryId]);
      if (!Number(refs.rows[0].s)) throw new AppError('validation', 'Please check the highlighted fields.', { subredditId: 'Choose a subreddit.' });
      if (!Number(refs.rows[0].c)) throw new AppError('validation', 'Please check the highlighted fields.', { categoryId: 'Choose a category.' });
      let outId = id;
      if (id) {
        const r = await db.query(
          `update tasks set subreddit_id=$2, category_id=$3, title=$4, description=$5, instructions=$6, reward_paise=$7, active=$8, allow_repeat=$9, updated_at=now() where id=$1`,
          [id, v.subredditId, v.categoryId, v.title, v.description, v.instructions, reward, v.active, v.allowRepeat],
        );
        if (!r.rowCount) throw notFound('That task');
      } else {
        outId = (await db.query<{ id: string }>(
          `insert into tasks (subreddit_id, category_id, title, description, instructions, reward_paise, active, allow_repeat, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [v.subredditId, v.categoryId, v.title, v.description, v.instructions, reward, v.active, v.allowRepeat, adminId],
        )).rows[0].id;
      }
      await writeAudit(db, { actorId: adminId, action: id ? 'task.update' : 'task.create', targetType: 'task', targetId: outId!, details: { title: v.title, active: v.active, reward_paise: reward } }, meta);
      return outId!;
    }),
  );
}

export async function adminSetTaskActive(adminId: string, id: string, active: boolean, meta?: RequestMeta): Promise<void> {
  await withEligibilityDiff(() =>
    tx(async (db) => {
      await requireAdmin(db, adminId, 'manage_tasks');
      const r = await db.query(`update tasks set active = $2, updated_at = now() where id = $1`, [id, active]);
      if (!r.rowCount) throw notFound('That task');
      await writeAudit(db, { actorId: adminId, action: active ? 'task.activate' : 'task.deactivate', targetType: 'task', targetId: id }, meta);
    }),
  );
}

// ============================================================ user marketplace

export interface MarketplaceTask extends TaskRow {
  eligibility: SubredditEligibility;
  subreddit: SubredditRow;
  my_status: TaskAppStatus | null; // latest application status, if any
}

async function userOpenOrLatestStatuses(db: Queryable, userId: string): Promise<Map<string, TaskAppStatus>> {
  const rows = (await db.query<{ task_id: string; status: TaskAppStatus }>(
    `select distinct on (task_id) task_id, status from task_applications where user_id = $1 order by task_id, created_at desc`, [userId])).rows;
  return new Map(rows.map((r) => [r.task_id, r.status]));
}

/**
 * Tasks the user currently qualifies for. Only approved users get anything back;
 * everyone else is refused on the server (the UI hides this too, but that is not the protection).
 */
export async function listMarketplace(
  userId: string,
  f: { q?: string; subreddit?: string; category?: string } = {},
): Promise<MarketplaceTask[]> {
  await requireActiveUser({ query }, userId);
  const el = await getUserEligibility(userId);
  if (!el.approved) throw forbidden('Tasks are available once your Reddit account has been approved.');

  const eligibleSubs = new Map(el.subreddits.filter((s) => isEligible(s.eligibility)).map((s) => [s.subreddit.id, s]));
  if (!eligibleSubs.size) return [];
  const where = ['t.active', 's.active', 't.subreddit_id = any($1::uuid[])'];
  const params: unknown[] = [[...eligibleSubs.keys()]];
  if (f.subreddit) { params.push(f.subreddit); where.push(`t.subreddit_id::text = $${params.length}`); }
  if (f.category) { params.push(f.category); where.push(`t.category_id::text = $${params.length}`); }
  if (f.q?.trim()) {
    params.push(likePattern(f.q));
    where.push(`(lower(t.title) like $${params.length} or lower(t.description) like $${params.length} or lower(s.name) like $${params.length})`);
  }
  const tasks = (await query<TaskRow>(`${TASK_SELECT} where ${where.join(' and ')} order by t.created_at desc limit 200`, params)).rows;
  const mine = await userOpenOrLatestStatuses({ query }, userId);
  return tasks.map((t) => {
    const e = eligibleSubs.get(t.subreddit_id)!;
    return { ...t, eligibility: e.eligibility, subreddit: e.subreddit, my_status: mine.get(t.id) ?? null };
  });
}

export async function getTaskForUser(userId: string, taskId: string): Promise<MarketplaceTask & { applications: UserApplicationRow[] }> {
  await requireActiveUser({ query }, userId);
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw notFound('That task');
  const task = (await query<TaskRow>(`${TASK_SELECT} where t.id = $1`, [taskId])).rows[0];
  if (!task || !task.active) throw notFound('That task');
  const sub = (await query<SubredditRow>(`${SUBREDDIT_SELECT} where s.id = $1`, [task.subreddit_id])).rows[0];
  if (!sub || !sub.active) throw notFound('That task');
  const { eligibility } = await evaluateUserForSubreddit({ query }, userId, sub);
  if (!isEligible(eligibility)) {
    throw forbidden(eligibility.blockedReason ?? 'Your account does not currently meet the requirements for this task.');
  }
  const applications = await listUserApplications(userId, taskId);
  return { ...task, eligibility, subreddit: sub, my_status: applications[0]?.status ?? null, applications };
}

// ============================================================== applications

export interface UserApplicationRow {
  id: string;
  task_id: string;
  task_title: string;
  subreddit_name: string;
  category_name: string;
  reward_paise: number | null;
  status: TaskAppStatus;
  user_note: string | null;
  admin_note: string | null;
  reward_credited_paise: number | null;
  created_at: Date;
  updated_at: Date;
}

export async function listUserApplications(userId: string, taskId?: string): Promise<UserApplicationRow[]> {
  const params: unknown[] = [userId];
  let extra = '';
  if (taskId) { params.push(taskId); extra = ' and a.task_id = $2'; }
  return (await query<UserApplicationRow>(
    `select a.id, a.task_id, t.title as task_title, s.name as subreddit_name, c.name as category_name, t.reward_paise, a.status,
            a.user_note, a.admin_note, a.reward_credited_paise, a.created_at, a.updated_at
       from task_applications a join tasks t on t.id = a.task_id join subreddits s on s.id = t.subreddit_id join task_categories c on c.id = t.category_id
      where a.user_id = $1${extra} order by a.created_at desc limit 200`,
    params,
  )).rows;
}

const OPEN: TaskAppStatus[] = ['Applied', 'Under Review', 'Accepted'];

/**
 * Apply to a task. Eligibility is re-evaluated HERE, on the server, inside the same transaction
 * that writes the application — hiding the Apply button in the UI is not what protects this.
 */
export async function applyToTask(userId: string, taskId: string, noteInput: string, meta?: RequestMeta): Promise<{ id: string; status: TaskAppStatus }> {
  await rateLimit(`apply:user:${userId}`, 30, 3600, undefined, 'You are applying too quickly. Please slow down.');
  const note = parseInput(text(500, 'Note'), noteInput ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(String(taskId))) throw notFound('That task');

  try {
    return await tx(async (db) => {
      await requireActiveUser(db, userId, { verifiedEmail: true });
      const settings = await getSettings(db);
      if (!settings.taskApplicationsOpen) throw new AppError('closed', 'Task applications are temporarily closed.');

      // Lock the task row so concurrent duplicate submissions queue up behind each other.
      const lock = await db.query(`select id from tasks where id = $1 for update`, [taskId]);
      if (!lock.rowCount) throw notFound('That task');
      const task = (await db.query<TaskRow>(`${TASK_SELECT} where t.id = $1`, [taskId])).rows[0];
      const sub = (await db.query<SubredditRow>(`${SUBREDDIT_SELECT} where s.id = $1`, [task.subreddit_id])).rows[0];
      if (!task.active || !sub.active) throw new AppError('unavailable', 'This task is no longer available.');

      const { eligibility, ctx } = await evaluateUserForSubreddit(db, userId, sub);
      if (!isEligible(eligibility)) {
        throw forbidden(eligibility.blockedReason ?? `You do not currently meet the requirements for this task: ${eligibility.unmet.join('; ')}.`);
      }

      const prior = await db.query<{ status: TaskAppStatus }>(`select status from task_applications where task_id = $1 and user_id = $2`, [taskId, userId]);
      if (prior.rows.some((r) => OPEN.includes(r.status))) throw new AppError('duplicate', 'You already have an open application for this task.');
      if (!task.allow_repeat && prior.rows.some((r) => r.status !== 'Cancelled')) {
        throw new AppError('duplicate', 'You have already applied for this task and it cannot be applied for again.');
      }

      const status: TaskAppStatus = eligibility.state === 'eligible_review' ? 'Under Review' : 'Applied';
      const snapshot = {
        evaluated_at: new Date().toISOString(),
        state: eligibility.state,
        checks: eligibility.checks,
        values: ctx.values && {
          account_created_at: ctx.values.accountCreatedAt,
          comment_karma: ctx.values.commentKarma,
          post_karma: ctx.values.postKarma,
          source: ctx.values.source,
        },
      };
      const r = await db.query<{ id: string }>(
        `insert into task_applications (task_id, user_id, status, user_note, eligibility_snapshot) values ($1,$2,$3,$4,$5::jsonb) returning id`,
        [taskId, userId, status, note || null, JSON.stringify(snapshot)],
      );
      await notify(db, userId, 'task_application', 'Application received', `Your application for “${task.title}” (r/${sub.name}) was submitted.`, '/tasks/mine');
      await writeAudit(db, { actorId: userId, action: 'task_application.create', targetType: 'task_application', targetId: r.rows[0].id, details: { task_id: taskId } }, meta);
      return { id: r.rows[0].id, status };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'ta_one_open_per_task_user')) throw new AppError('duplicate', 'You already have an open application for this task.');
    throw e;
  }
}

export async function cancelApplication(userId: string, applicationId: string, meta?: RequestMeta): Promise<void> {
  await tx(async (db) => {
    await requireActiveUser(db, userId);
    // user_id in the WHERE clause: nobody can cancel someone else's application
    const r = await db.query<{ id: string }>(
      `update task_applications set status = 'Cancelled', updated_at = now()
        where id = $1 and user_id = $2 and status in ('Applied','Under Review','Accepted') returning id`,
      [applicationId, userId],
    );
    if (!r.rowCount) throw new AppError('conflict', 'That application cannot be cancelled.');
    await writeAudit(db, { actorId: userId, action: 'task_application.cancel', targetType: 'task_application', targetId: applicationId }, meta);
  });
}

// ---------------------------------------------------------- admin: review

export interface AdminApplicationRow {
  id: string;
  task_id: string;
  task_title: string;
  subreddit_name: string;
  user_id: string;
  username: string;
  reddit_username: string | null;
  reward_paise: number | null;
  status: TaskAppStatus;
  user_note: string | null;
  admin_note: string | null;
  reward_credited_paise: number | null;
  eligibility_snapshot: Record<string, any>;
  created_at: Date;
}

export async function adminListTaskApplications(
  adminId: string,
  f: { status?: string; taskId?: string; page?: number } = {},
): Promise<{ rows: AdminApplicationRow[]; total: number; pageSize: number }> {
  await requireAdmin({ query }, adminId, 'manage_tasks');
  const pageSize = 25;
  const page = Math.max(1, f.page ?? 1);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) { params.push(f.status); where.push(`a.status = $${params.length}`); }
  if (f.taskId) { params.push(f.taskId); where.push(`a.task_id::text = $${params.length}`); }
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const total = (await query<{ n: number }>(`select count(*)::bigint as n from task_applications a ${w}`, params)).rows[0].n;
  const rows = (await query<AdminApplicationRow>(
    `select a.id, a.task_id, t.title as task_title, s.name as subreddit_name, a.user_id, u.username,
            (select reddit_username from reddit_submissions r where r.user_id = a.user_id and r.superseded_at is null) as reddit_username,
            t.reward_paise, a.status, a.user_note, a.admin_note, a.reward_credited_paise, a.eligibility_snapshot, a.created_at
       from task_applications a join tasks t on t.id = a.task_id join subreddits s on s.id = t.subreddit_id join users u on u.id = a.user_id
       ${w}
      order by case a.status when 'Applied' then 0 when 'Under Review' then 1 when 'Accepted' then 2 else 3 end, a.created_at asc
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  )).rows;
  return { rows, total, pageSize };
}

const APP_TRANSITIONS: Record<TaskAppStatus, TaskAppStatus[]> = {
  Applied: ['Under Review', 'Accepted', 'Rejected', 'Cancelled'],
  'Under Review': ['Accepted', 'Rejected', 'Cancelled'],
  Accepted: ['Completed', 'Rejected', 'Cancelled'],
  Rejected: [],
  Completed: [],
  Cancelled: [],
};

export async function adminDecideTaskApplication(
  adminId: string,
  applicationId: string,
  to: TaskAppStatus,
  input: { note?: string; creditReward?: boolean } = {},
  meta?: RequestMeta,
): Promise<{ rewardCredited: boolean }> {
  const note = parseInput(text(500, 'Note'), input.note ?? '');
  return tx(async (db) => {
    await requireAdmin(db, adminId, 'manage_tasks');
    const a = (await db.query<{ id: string; user_id: string; task_id: string; status: TaskAppStatus; title: string; reward_paise: number | null }>(
      `select a.id, a.user_id, a.task_id, a.status, t.title, t.reward_paise from task_applications a join tasks t on t.id = a.task_id where a.id = $1 for update of a`,
      [applicationId],
    )).rows[0];
    if (!a) throw notFound('That application');
    if (!APP_TRANSITIONS[a.status]?.includes(to)) throw new AppError('conflict', `An application that is "${a.status}" cannot be changed to "${to}".`);
    if (to === 'Rejected' && note.length < 3) throw new AppError('validation', 'Please check the highlighted fields.', { note: 'Add a short reason so the user knows why.' });

    if (to === 'Accepted') {
      const u = await db.query<{ status: string }>(`select status from users where id = $1 and deleted_at is null`, [a.user_id]);
      const sub = (await db.query<{ status: string }>(`select status from reddit_submissions where user_id = $1 and superseded_at is null`, [a.user_id])).rows[0];
      if (!u.rows[0] || u.rows[0].status !== 'active' || sub?.status !== 'Approved') {
        throw new AppError('conflict', "This user's account is not currently in good standing, so the application cannot be accepted.");
      }
    }

    let credited = false;
    let creditedAmount: number | null = null;
    if (to === 'Completed' && input.creditReward) {
      await requireAdmin(db, adminId, 'wallet_adjust'); // paying out needs the wallet permission too
      if (a.reward_paise && a.reward_paise > 0) {
        credited = await creditTaskReward(db, adminId, { id: a.id, user_id: a.user_id, task_title: a.title, reward_paise: a.reward_paise });
        if (credited) creditedAmount = a.reward_paise;
      }
    }
    await db.query(
      `update task_applications set status = $2, admin_note = coalesce(nullif($3, ''), admin_note), decided_by = $4, decided_at = now(),
              reward_credited_paise = coalesce($5, reward_credited_paise), updated_at = now() where id = $1`,
      [applicationId, to, note, adminId, creditedAmount],
    );
    await writeAudit(db, { actorId: adminId, action: 'task_application.decide', targetType: 'task_application', targetId: applicationId, details: { from: a.status, to, note: note || undefined, reward_credited_paise: creditedAmount } }, meta);
    await notify(db, a.user_id, 'task_application', `Task application ${to.toLowerCase()}`, `“${a.title}”: ${to}.${note ? ` ${note}` : ''}`, '/tasks/mine');
    return { rewardCredited: credited };
  });
}
