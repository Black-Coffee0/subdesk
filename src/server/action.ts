import 'server-only';
import { isAppError } from '@/lib/errors';

/** What every form action returns. `values` lets the form re-fill itself after a validation error. */
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  /** Extra non-sensitive data for the form to show (for example a development-only link). */
  data?: Record<string, string>;
}

const SECRET_FIELD = /password|confirm|current|token/i;

function echo(fd?: FormData): Record<string, string> | undefined {
  if (!fd) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string' && !k.startsWith('$') && !SECRET_FIELD.test(k)) out[k] = v;
  }
  return out;
}

/**
 * Run a service call and turn the outcome into form state. Errors raised on purpose (AppError)
 * carry safe, human messages; anything else is logged and replaced by a generic message so
 * internals never reach the browser. Redirects raised inside `fn` pass straight through.
 */
export async function safe(fn: () => Promise<Partial<ActionState> | void>, fd?: FormData): Promise<ActionState> {
  try {
    const r = (await fn()) ?? {};
    return { ok: true, ...r };
  } catch (e: any) {
    if (typeof e?.digest === 'string' && e.digest.startsWith('NEXT_')) throw e; // redirect / not-found
    if (isAppError(e)) return { ok: false, error: e.message, fieldErrors: e.fieldErrors, values: echo(fd) };
    console.error('[action] unexpected error:', e);
    return { ok: false, error: 'Something went wrong on our side. Please try again in a moment.', values: echo(fd) };
  }
}

export const str = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};
export const flag = (fd: FormData, k: string): boolean => fd.get(k) === 'on' || fd.get(k) === 'true';
