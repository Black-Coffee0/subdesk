import 'server-only';
import { z } from 'zod';
import { query, tx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { intField, parseInput, requiredText, text } from '@/lib/validation';
import { requireAdmin } from './authz';
import { writeAudit } from './audit';
import { withEligibilityDiff } from './eligibility';
import type { RequestMeta } from './types';

import { KEYS, getSettings, type PlatformSettings } from './settings-store';
export { getSettings, type PlatformSettings } from './settings-store';

const SettingsPatch = z
  .object({
    siteName: requiredText(2, 40, 'Site name'),
    supportEmail: z.union([z.literal(''), z.email('Enter a valid support email.')]),
    minAccountAgeMonths: intField(0, 120, 'Minimum account age'),
    minCommentKarma: intField(0, 1_000_000, 'Minimum comment karma'),
    minPostKarma: intField(0, 1_000_000, 'Minimum post karma'),
    applicationsOpen: z.boolean(),
    taskApplicationsOpen: z.boolean(),
    autoRejectBelowMinimums: z.boolean(),
    requireOwnershipCode: z.boolean(),
    walletAdjustmentsEnabled: z.boolean(),
    announcementEnabled: z.boolean(),
    announcementText: text(500, 'Announcement'),
  })
  .partial();

export async function updateSettings(adminId: string, patch: Partial<PlatformSettings>, meta?: RequestMeta): Promise<string[]> {
  const clean = parseInput(SettingsPatch, patch) as Partial<PlatformSettings>;
  const eligibilityAffecting = ['minAccountAgeMonths', 'minCommentKarma', 'minPostKarma'].some((k) => k in clean);

  const run = async () =>
    tx(async (db) => {
      await requireAdmin(db, adminId, 'manage_settings');
      const current = await getSettings(db);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [prop, value] of Object.entries(clean)) {
        if (value === undefined) continue;
        const from = (current as any)[prop];
        if (JSON.stringify(from) === JSON.stringify(value)) continue;
        changes[prop] = { from, to: value };
        await db.query(
          `insert into platform_settings (key, value, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
           on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
          [(KEYS as any)[prop], JSON.stringify(value), adminId],
        );
      }
      const changed = Object.keys(changes);
      if (changed.length) await writeAudit(db, { actorId: adminId, action: 'settings.update', targetType: 'settings', details: changes }, meta);
      return changed;
    });

  // Changing thresholds changes who qualifies, so notify users who gain access to tasks.
  return eligibilityAffecting ? withEligibilityDiff(run) : run();
}

// ---------- editable legal / content pages ----------

export interface ContentPage {
  slug: string;
  title: string;
  body: string;
  updated_at: Date;
}

export async function getContentPage(slug: string): Promise<ContentPage | null> {
  return (await query<ContentPage>('select slug, title, body, updated_at from content_pages where slug = $1', [slug])).rows[0] ?? null;
}

export async function listContentPages(): Promise<ContentPage[]> {
  return (await query<ContentPage>('select slug, title, body, updated_at from content_pages order by slug')).rows;
}

export async function updateContentPage(adminId: string, slug: string, title: string, body: string, meta?: RequestMeta): Promise<void> {
  const clean = parseInput(
    z.object({ slug: z.enum(['privacy', 'terms']), title: requiredText(2, 100, 'Title'), body: requiredText(1, 20000, 'Content') }),
    { slug, title, body },
  );
  await tx(async (db) => {
    await requireAdmin(db, adminId, 'manage_settings');
    const r = await db.query(`update content_pages set title = $2, body = $3, updated_by = $4, updated_at = now() where slug = $1`, [
      clean.slug,
      clean.title,
      clean.body,
      adminId,
    ]);
    if (!r.rowCount) throw new AppError('not_found', 'That page does not exist.');
    await writeAudit(db, { actorId: adminId, action: 'content.update', targetType: 'content_page', targetId: clean.slug }, meta);
  });
}
