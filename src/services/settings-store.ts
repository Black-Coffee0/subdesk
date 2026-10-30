import 'server-only';
import type { Queryable } from '@/lib/db';
import { query } from '@/lib/db';

export interface PlatformSettings {
  siteName: string;
  supportEmail: string;
  minAccountAgeMonths: number;
  minCommentKarma: number;
  minPostKarma: number;
  applicationsOpen: boolean;
  taskApplicationsOpen: boolean;
  autoRejectBelowMinimums: boolean;
  requireOwnershipCode: boolean;
  walletAdjustmentsEnabled: boolean;
  announcementEnabled: boolean;
  announcementText: string;
}

export const KEYS: Record<keyof PlatformSettings, string> = {
  siteName: 'site_name',
  supportEmail: 'support_email',
  minAccountAgeMonths: 'min_account_age_months',
  minCommentKarma: 'min_comment_karma',
  minPostKarma: 'min_post_karma',
  applicationsOpen: 'applications_open',
  taskApplicationsOpen: 'task_applications_open',
  autoRejectBelowMinimums: 'auto_reject_below_minimums',
  requireOwnershipCode: 'require_ownership_code',
  walletAdjustmentsEnabled: 'wallet_adjustments_enabled',
  announcementEnabled: 'announcement_enabled',
  announcementText: 'announcement_text',
};

const DEFAULTS: PlatformSettings = {
  siteName: 'Subdesk',
  supportEmail: '',
  minAccountAgeMonths: 3,
  minCommentKarma: 100,
  minPostKarma: 100,
  applicationsOpen: true,
  taskApplicationsOpen: true,
  autoRejectBelowMinimums: false,
  requireOwnershipCode: true,
  walletAdjustmentsEnabled: true,
  announcementEnabled: false,
  announcementText: '',
};

export async function getSettings(db?: Queryable): Promise<PlatformSettings> {
  const run = db ? db.query.bind(db) : query;
  const rows = (await run<{ key: string; value: unknown }>('select key, value from platform_settings')).rows;
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const [prop, key] of Object.entries(KEYS)) {
    const v = byKey.get(key);
    out[prop] = v === undefined || v === null ? (DEFAULTS as any)[prop] : v;
  }
  return out as unknown as PlatformSettings;
}

