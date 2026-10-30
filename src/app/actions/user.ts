'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { cancelAccountDeletion, changePassword, requestAccountDeletion, updateUsername } from '@/services/auth';
import { markAllRead, markRead } from '@/services/notifications';
import { submitRedditAccount } from '@/services/submissions';
import { applyToTask, cancelApplication } from '@/services/tasks';
import { safe, str, type ActionState } from '@/server/action';
import { getCurrentUser, requestMeta } from '@/server/session';

async function me() {
  const u = await getCurrentUser();
  if (!u) throw new AppError('unauthenticated', 'Your session has ended. Please log in again.');
  return u;
}
const refresh = () => revalidatePath('/', 'layout');

export async function submitRedditAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const u = await me();
    await submitRedditAccount(u.id, { profileUrl: str(fd, 'profileUrl'), note: str(fd, 'note') }, await requestMeta());
  }, fd);
  if (r.ok) { refresh(); redirect('/application?submitted=1'); }
  return r;
}

export async function applyTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const u = await me();
    await applyToTask(u.id, str(fd, 'taskId'), str(fd, 'note'), await requestMeta());
  }, fd);
  if (r.ok) { refresh(); redirect('/tasks/mine?applied=1'); }
  return r;
}

export async function cancelApplicationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const u = await me();
    await cancelApplication(u.id, str(fd, 'applicationId'), await requestMeta());
    refresh();
    return { message: 'Application cancelled.' };
  });
}

export async function markReadAction(fd: FormData): Promise<void> {
  const u = await me();
  await markRead(u.id, str(fd, 'id'));
  refresh();
}

export async function markAllReadAction(): Promise<void> {
  const u = await me();
  await markAllRead(u.id);
  refresh();
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const u = await me();
    await changePassword(u.id, { current: str(fd, 'current'), password: str(fd, 'password'), confirm: str(fd, 'confirm') }, u.sessionId, await requestMeta());
    return { message: 'Password changed. Your other devices have been signed out.' };
  }, fd);
}

export async function updateUsernameAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const u = await me();
    await updateUsername(u.id, str(fd, 'username'));
    return { message: 'Username updated.' };
  }, fd);
  if (r.ok) refresh();
  return r;
}

export async function requestDeletionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const u = await me();
    await requestAccountDeletion(u.id, str(fd, 'password'), await requestMeta());
  }, fd);
  if (r.ok) { refresh(); return { ok: true, message: 'Deletion requested. An administrator will process it soon.' }; }
  return r;
}

export async function cancelDeletionAction(): Promise<void> {
  const u = await me();
  await cancelAccountDeletion(u.id, await requestMeta());
  refresh();
}
