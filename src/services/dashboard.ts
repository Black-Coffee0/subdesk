import 'server-only';
import { query } from '@/lib/db';
import { requireAdmin } from './authz';
import { getUserEligibility, type UserEligibility } from './eligibility';
import { listNotifications, unreadCount, type NotificationRow } from './notifications';
import { getCurrentSubmission, listVerificationRecords, type VerificationRecord } from './submissions';
import { getSettings, type PlatformSettings } from './settings';
import { listUserApplications, type UserApplicationRow } from './tasks';
import { getWalletSummary, type WalletSummary } from './wallet';
import { recentActivity, type AuditRow } from './audit';
import type { SubmissionRow } from './types';

export interface UserDashboard {
  submission: SubmissionRow | null;
  latestRecord: VerificationRecord | null;
  eligibility: UserEligibility;
  applications: UserApplicationRow[];
  wallet: WalletSummary;
  notifications: NotificationRow[];
  unread: number;
  settings: PlatformSettings;
}

export async function getUserDashboard(userId: string): Promise<UserDashboard> {
  const [submission, eligibility, applications, wallet, notifications, unread, settings] = await Promise.all([
    getCurrentSubmission(userId),
    getUserEligibility(userId),
    listUserApplications(userId),
    getWalletSummary(userId),
    listNotifications(userId, 5),
    unreadCount(userId),
    getSettings(),
  ]);
  const latestRecord = submission ? ((await listVerificationRecords(submission.id))[0] ?? null) : null;
  return { submission, latestRecord, eligibility, applications: applications.slice(0, 5), wallet, notifications, unread, settings };
}

export interface AdminOverview {
  totalUsers: number;
  pendingApplications: number;
  approvedUsers: number;
  rejectedApplications: number;
  manualVerification: number;
  stuckVerification: number;
  activeTasks: number;
  activeSubreddits: number;
  openTaskApplications: number;
  deletionRequests: number;
  recent: AuditRow[];
}

export async function getAdminOverview(adminId: string): Promise<AdminOverview> {
  await requireAdmin({ query }, adminId);
  const r = (await query<Record<string, number>>(
    `select
       (select count(*)::bigint from users where role = 'user' and deleted_at is null) as "totalUsers",
       (select count(*)::bigint from reddit_submissions where superseded_at is null and status = 'Pending Admin Review') as "pendingApplications",
       (select count(*)::bigint from reddit_submissions where superseded_at is null and status = 'Approved') as "approvedUsers",
       (select count(*)::bigint from reddit_submissions where superseded_at is null and status = 'Rejected') as "rejectedApplications",
       (select count(*)::bigint from reddit_submissions where superseded_at is null and verification_state = 'manual_review_required' and status in ('Pending Admin Review','Pending Verification','Needs More Information')) as "manualVerification",
       (select count(*)::bigint from reddit_submissions where superseded_at is null and status = 'Pending Verification' and submitted_at < now() - interval '5 minutes') as "stuckVerification",
       (select count(*)::bigint from tasks where active) as "activeTasks",
       (select count(*)::bigint from subreddits where active) as "activeSubreddits",
       (select count(*)::bigint from task_applications where status in ('Applied','Under Review')) as "openTaskApplications",
       (select count(*)::bigint from users where deletion_requested_at is not null and deleted_at is null) as "deletionRequests"`,
  )).rows[0];
  return { ...(r as unknown as Omit<AdminOverview, 'recent'>), recent: await recentActivity({ query }, 8) };
}
