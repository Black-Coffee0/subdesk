import { ActionForm, CheckField, Field, SelectField, SubmitButton, TextArea } from './forms';
import { saveSubredditAction, saveTaskAction } from '@/app/actions/admin';
import { paiseToRupeesInput } from '@/lib/money';
import type { SubredditRow } from '@/services/eligibility';
import type { CategoryRow, TaskRow } from '@/services/tasks';

export function SubredditForm({ categories, initial, platform }: { categories: CategoryRow[]; initial?: SubredditRow; platform: { age: number; comment: number; post: number } }) {
  return (
    <ActionForm action={saveSubredditAction}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field name="name" label="Subreddit name" required defaultValue={initial?.name} placeholder="for example AskReddit (without r/)" hint="Letters, numbers and underscores only." />
      <SelectField name="categoryId" label="Task category" required defaultValue={initial?.category_id} options={categories.filter((c) => c.active || c.id === initial?.category_id).map((c) => ({ value: c.id, label: c.name }))} />
      <TextArea name="description" label="Short description of the task" rows={3} maxLength={500} defaultValue={initial?.description} />
      <fieldset className="rounded-card border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Minimum requirements for this subreddit</legend>
        <p className="mb-3 text-sm text-muted">Users must also meet the platform minimums ({platform.age} months, {platform.comment} comment karma, {platform.post} post karma). The stricter value applies.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="minAccountAgeMonths" label="Account age (months)" type="number" inputMode="numeric" min={0} required defaultValue={initial?.min_account_age_months ?? 0} />
          <Field name="minCommentKarma" label="Comment karma" type="number" inputMode="numeric" min={0} required defaultValue={initial?.min_comment_karma ?? 0} />
          <Field name="minPostKarma" label="Post karma" type="number" inputMode="numeric" min={0} required defaultValue={initial?.min_post_karma ?? 0} />
        </div>
      </fieldset>
      <TextArea name="extraRequirements" label="Additional requirements" rows={2} maxLength={1000} defaultValue={initial?.extra_requirements} hint="Shown to users. Not checked automatically. Turn on manual review below if you need to confirm them." />
      <TextArea name="restrictions" label="Subreddit-specific restrictions" rows={2} maxLength={1000} defaultValue={initial?.restrictions} hint="For example posting limits or rules users must follow." />
      <CheckField name="requiresManualReview" label="Require manual review" hint="Task applications for this subreddit start as “Under Review”." defaultChecked={initial?.requires_manual_review ?? false} />
      <CheckField name="active" label="Active" hint="Inactive subreddits and their tasks are hidden from users." defaultChecked={initial?.active ?? true} />
      <SubmitButton className="btn btn-primary btn-lg btn-block sm:w-auto" pendingLabel="Saving…">{initial ? 'Save changes' : 'Add subreddit'}</SubmitButton>
    </ActionForm>
  );
}

export function TaskForm({ categories, subreddits, initial }: { categories: CategoryRow[]; subreddits: { id: string; name: string; active: boolean }[]; initial?: TaskRow }) {
  return (
    <ActionForm action={saveTaskAction}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field name="title" label="Task title" required defaultValue={initial?.title} maxLength={120} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="subredditId" label="Subreddit" required defaultValue={initial?.subreddit_id} options={subreddits.map((s) => ({ value: s.id, label: `r/${s.name}${s.active ? '' : ' (inactive)'}` }))} />
        <SelectField name="categoryId" label="Category" required defaultValue={initial?.category_id} options={categories.filter((c) => c.active || c.id === initial?.category_id).map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      <TextArea name="description" label="Short description" rows={3} maxLength={1000} defaultValue={initial?.description} />
      <TextArea name="instructions" label="Instructions" rows={7} maxLength={5000} defaultValue={initial?.instructions} hint="Shown to eligible users on the task page." />
      <Field name="reward" label="Reward in ₹ (optional)" inputMode="decimal" defaultValue={paiseToRupeesInput(initial?.reward_paise)} placeholder="Leave empty if there is no reward" hint="Never paid automatically. You credit it yourself when you mark a task completed." />
      <CheckField name="allowRepeat" label="Allow the same user to apply more than once" defaultChecked={initial?.allow_repeat ?? false} />
      <CheckField name="active" label="Active" hint="Inactive tasks are hidden and can’t be applied for." defaultChecked={initial?.active ?? true} />
      <SubmitButton className="btn btn-primary btn-lg btn-block sm:w-auto" pendingLabel="Saving…">{initial ? 'Save changes' : 'Add task'}</SubmitButton>
    </ActionForm>
  );
}
