'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { adminAdjustWallet } from '@/services/wallet';
import { adminDecide, adminReverify, adminSaveNotes, adminSetManualValues, type DecisionAction } from '@/services/submissions';
import { adminDecideTaskApplication, adminSaveCategory, adminSaveSubreddit, adminSaveTask, adminSetTaskActive } from '@/services/tasks';
import { updateContentPage, updateSettings } from '@/services/settings';
import { adminMarkEmailVerified, adminProcessDeletion, adminSetAccountStatus } from '@/services/users';
import type { TaskAppStatus } from '@/services/types';
import { flag, safe, str, type ActionState } from '@/server/action';
import { getCurrentAdmin, requestMeta } from '@/server/session';

/** The actor comes from the admin cookie only. Every service call re-checks the role and permission in the database. */
async function actor(): Promise<string> {
  const a = await getCurrentAdmin();
  if (!a) throw new AppError('unauthenticated', 'Your administrator session has ended. Please log in again.');
  return a.id;
}
const refresh = () => revalidatePath('/', 'layout');

// ------------------------------------------------------------- applications

const DECISIONS: DecisionAction[] = ['approve', 'reject', 'request_info', 'mark_manual', 'suspend', 'reinstate'];
const DECISION_DONE: Record<DecisionAction, string> = {
  approve: 'Application approved. The user can now see eligible tasks.',
  reject: 'Application rejected. The user can see your reason.',
  request_info: 'More information requested from the user.',
  mark_manual: 'Marked for manual verification.',
  suspend: 'User suspended. Task access is blocked immediately.',
  reinstate: 'User reinstated.',
};

export async function decideApplicationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const id = await actor();
    const intent = str(fd, 'intent') as DecisionAction;
    if (!DECISIONS.includes(intent)) throw new AppError('validation', 'Choose an action.');
    await adminDecide(id, str(fd, 'submissionId'), intent, { reason: str(fd, 'reason'), allowResubmit: flag(fd, 'allowResubmit') }, await requestMeta());
    refresh();
    return { message: DECISION_DONE[intent] };
  }, fd);
}

export async function manualValuesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    await adminSetManualValues(
      await actor(),
      str(fd, 'submissionId'),
      { accountCreatedAt: str(fd, 'accountCreatedAt'), commentKarma: str(fd, 'commentKarma'), postKarma: str(fd, 'postKarma'), ownershipConfirmed: flag(fd, 'ownershipConfirmed'), evidenceNote: str(fd, 'evidenceNote') },
      await requestMeta(),
    );
    refresh();
    return { message: 'Verified values saved and recorded in the audit trail.' };
  }, fd);
}

export async function reverifyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const r = await adminReverify(await actor(), str(fd, 'submissionId'), await requestMeta());
    refresh();
    return { message: r.detail };
  });
}

export async function saveNotesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    await adminSaveNotes(await actor(), str(fd, 'submissionId'), str(fd, 'notes'), await requestMeta());
    refresh();
    return { message: 'Notes saved.' };
  }, fd);
}

// ------------------------------------------------------- subreddits & tasks

export async function saveSubredditAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const id = str(fd, 'id') || null;
    await adminSaveSubreddit(
      await actor(), id,
      {
        name: str(fd, 'name'), categoryId: str(fd, 'categoryId'), description: str(fd, 'description'), restrictions: str(fd, 'restrictions'),
        extraRequirements: str(fd, 'extraRequirements'), active: flag(fd, 'active'),
        minAccountAgeMonths: str(fd, 'minAccountAgeMonths'), minCommentKarma: str(fd, 'minCommentKarma'), minPostKarma: str(fd, 'minPostKarma'),
        requiresManualReview: flag(fd, 'requiresManualReview'),
      } as any,
      await requestMeta(),
    );
  }, fd);
  if (r.ok) { refresh(); redirect('/admin/subreddits?saved=1'); }
  return r;
}

export async function saveTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    await adminSaveTask(
      await actor(), str(fd, 'id') || null,
      {
        subredditId: str(fd, 'subredditId'), categoryId: str(fd, 'categoryId'), title: str(fd, 'title'), description: str(fd, 'description'),
        instructions: str(fd, 'instructions'), reward: str(fd, 'reward'), active: flag(fd, 'active'), allowRepeat: flag(fd, 'allowRepeat'),
      },
      await requestMeta(),
    );
  }, fd);
  if (r.ok) { refresh(); redirect('/admin/tasks?saved=1'); }
  return r;
}

export async function setTaskActiveAction(fd: FormData): Promise<void> {
  await adminSetTaskActive(await actor(), str(fd, 'taskId'), str(fd, 'active') === 'true', await requestMeta());
  refresh();
}

export async function decideTaskApplicationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const to = str(fd, 'intent') as TaskAppStatus;
    const r = await adminDecideTaskApplication(await actor(), str(fd, 'applicationId'), to, { note: str(fd, 'note'), creditReward: flag(fd, 'creditReward') }, await requestMeta());
    refresh();
    return { message: r.rewardCredited ? `Marked ${to.toLowerCase()} and the configured reward was credited to the user's wallet.` : `Marked ${to.toLowerCase()}.` };
  }, fd);
}

export async function saveCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    await adminSaveCategory(await actor(), { id: str(fd, 'id') || undefined, name: str(fd, 'name'), active: str(fd, 'id') ? flag(fd, 'active') : undefined }, await requestMeta());
    refresh();
    return { message: 'Category saved.' };
  }, fd);
}

// -------------------------------------------------------------------- users

export async function setUserStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const status = str(fd, 'status') === 'suspended' ? 'suspended' : 'active';
    await adminSetAccountStatus(await actor(), str(fd, 'userId'), status, str(fd, 'reason'), await requestMeta());
    refresh();
    return { message: status === 'suspended' ? 'Account blocked. All sessions were ended.' : 'Account reactivated.' };
  }, fd);
}

export async function markEmailVerifiedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    await adminMarkEmailVerified(await actor(), str(fd, 'userId'), await requestMeta());
    refresh();
    return { message: 'Email marked as verified.' };
  });
}

export async function processDeletionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    await adminProcessDeletion(await actor(), str(fd, 'userId'), await requestMeta());
  });
  if (r.ok) { refresh(); redirect('/admin/users?deleted=1'); }
  return r;
}

// ------------------------------------------------------------------- wallet

export async function adjustWalletAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const r = await adminAdjustWallet(
      await actor(),
      { userId: str(fd, 'userId'), direction: str(fd, 'direction'), amount: str(fd, 'amount'), reason: str(fd, 'reason'), idempotencyKey: str(fd, 'idempotencyKey') },
      await requestMeta(),
    );
    refresh();
    return { message: r.duplicate ? 'That adjustment was already recorded, so nothing changed.' : 'Adjustment recorded in the ledger.' };
  }, fd);
}

// ----------------------------------------------------------------- settings

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const changed = await updateSettings(
      await actor(),
      {
        siteName: str(fd, 'siteName'), supportEmail: str(fd, 'supportEmail'),
        minAccountAgeMonths: str(fd, 'minAccountAgeMonths'), minCommentKarma: str(fd, 'minCommentKarma'), minPostKarma: str(fd, 'minPostKarma'),
        applicationsOpen: flag(fd, 'applicationsOpen'), taskApplicationsOpen: flag(fd, 'taskApplicationsOpen'),
        autoRejectBelowMinimums: flag(fd, 'autoRejectBelowMinimums'), requireOwnershipCode: flag(fd, 'requireOwnershipCode'),
        walletAdjustmentsEnabled: flag(fd, 'walletAdjustmentsEnabled'),
        announcementEnabled: flag(fd, 'announcementEnabled'), announcementText: str(fd, 'announcementText'),
      } as any,
      await requestMeta(),
    );
    refresh();
    return { message: changed.length ? `Saved. Changed: ${changed.join(', ')}.` : 'Nothing changed.' };
  }, fd);
}

export async function saveContentPageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    await updateContentPage(await actor(), str(fd, 'slug'), str(fd, 'title'), str(fd, 'body'), await requestMeta());
    refresh();
    return { message: 'Page saved.' };
  }, fd);
}
