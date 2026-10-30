import type { Metadata } from 'next';
import { ActionForm, CheckField, Field, SubmitButton, TextArea } from '@/components/forms';
import { PageTitle, fmtDate } from '@/components/ui';
import { getSettings, listContentPages } from '@/services/settings';
import { listCategories } from '@/services/tasks';
import { saveCategoryAction, saveContentPageAction, saveSettingsAction } from '@/app/actions/admin';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireAdminPage('manage_settings');
  const [s, categories, pages] = await Promise.all([getSettings(), listCategories(), listContentPages()]);
  return (
    <div className="max-w-2xl space-y-8">
      <PageTitle title="Settings">Routine changes, no code needed. Every change is recorded in the audit log.</PageTitle>

      <section className="card" aria-labelledby="plat-h">
        <h2 id="plat-h" className="text-xl">Platform</h2>
        <div className="mt-4">
          <ActionForm action={saveSettingsAction}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="siteName" label="Site name" required defaultValue={s.siteName} />
              <Field name="supportEmail" label="Support email" type="email" defaultValue={s.supportEmail} hint="Shown on Help and in the footer. Leave empty to hide." />
            </div>
            <fieldset className="rounded-card border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Platform-wide minimums</legend>
              <p className="mb-3 text-sm text-muted">Every user must meet all three. Changing them recalculates eligibility straight away and notifies users who gain access.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field name="minAccountAgeMonths" label="Account age (months)" type="number" inputMode="numeric" min={0} required defaultValue={s.minAccountAgeMonths} />
                <Field name="minCommentKarma" label="Comment karma" type="number" inputMode="numeric" min={0} required defaultValue={s.minCommentKarma} />
                <Field name="minPostKarma" label="Post karma" type="number" inputMode="numeric" min={0} required defaultValue={s.minPostKarma} />
              </div>
            </fieldset>
            <CheckField name="applicationsOpen" label="Accept new Reddit account applications" defaultChecked={s.applicationsOpen} />
            <CheckField name="taskApplicationsOpen" label="Accept task applications" defaultChecked={s.taskApplicationsOpen} />
            <CheckField name="requireOwnershipCode" label="Require the ownership code in the Reddit bio" hint="Proves the user controls the account. Checked automatically when Reddit API access is configured." defaultChecked={s.requireOwnershipCode} />
            <CheckField name="autoRejectBelowMinimums" label="Automatically reject verified accounts below the minimums" hint="Off by default so you see every application. The user is told exactly what is missing and may resubmit." defaultChecked={s.autoRejectBelowMinimums} />
            <CheckField name="walletAdjustmentsEnabled" label="Allow wallet adjustments" hint="Turning this off blocks all manual credits and debits, for every administrator." defaultChecked={s.walletAdjustmentsEnabled} />
            <fieldset className="rounded-card border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Announcement</legend>
              <div className="space-y-3">
                <CheckField name="announcementEnabled" label="Show the announcement banner on every page" defaultChecked={s.announcementEnabled} />
                <TextArea name="announcementText" label="Announcement text" rows={2} maxLength={500} defaultValue={s.announcementText} />
              </div>
            </fieldset>
            <SubmitButton className="btn btn-primary btn-lg btn-block sm:w-auto" pendingLabel="Saving…">Save settings</SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section className="card" aria-labelledby="cat-h">
        <h2 id="cat-h" className="text-xl">Task categories</h2>
        <ul className="divide-list mt-3">
          {categories.map((c) => (
            <li key={c.id} className="py-3">
              <ActionForm action={saveCategoryAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={c.id} />
                <div className="min-w-48 flex-1"><Field name="name" label="Name" defaultValue={c.name} required /></div>
                <div className="pb-2.5"><CheckField name="active" label="Active" defaultChecked={c.active} /></div>
                <SubmitButton className="btn btn-outline btn-sm mb-1" pendingLabel="Saving…">Save</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-line pt-4">
          <ActionForm action={saveCategoryAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1"><Field name="name" label="New category" required placeholder="for example Commenting" /></div>
            <SubmitButton className="btn btn-primary btn-sm mb-1" pendingLabel="Adding…">Add category</SubmitButton>
          </ActionForm>
        </div>
      </section>

      <section className="space-y-5" aria-labelledby="legal-h">
        <div>
          <h2 id="legal-h" className="text-xl">Legal pages</h2>
          <p className="mt-1 text-sm text-muted">These start as placeholders. Replace them with your real text before launch. Use <code>## Heading</code> for headings, <code>- item</code> for lists, and blank lines between paragraphs.</p>
        </div>
        {pages.map((p) => (
          <div key={p.slug} className="card">
            <p className="mb-3 text-sm text-muted">{p.slug === 'privacy' ? 'Public at /privacy' : 'Public at /terms'} · last updated {fmtDate(p.updated_at)}</p>
            <ActionForm action={saveContentPageAction}>
              <input type="hidden" name="slug" value={p.slug} />
              <Field name="title" label="Title" required defaultValue={p.title} />
              <TextArea name="body" label="Content" rows={12} required defaultValue={p.body} />
              <SubmitButton className="btn btn-outline" pendingLabel="Saving…">Save {p.slug === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}</SubmitButton>
            </ActionForm>
          </div>
        ))}
      </section>
    </div>
  );
}
