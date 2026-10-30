import { z } from 'zod';
import { AppError } from './errors';

/** Validate untrusted input; throws an AppError carrying per-field messages. */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw new AppError('validation', 'Please check the highlighted fields.', fieldErrors);
}

export const emailField = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .min(1, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

export const usernameField = z
  .string({ error: 'Choose a username.' })
  .trim()
  .regex(/^[A-Za-z0-9_]{3,24}$/, 'Use 3–24 letters, numbers or underscores.');

export const passwordField = z
  .string({ error: 'Enter a password.' })
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Use at most 128 characters.');

export const uuidField = z.string().uuid('Invalid identifier.');

/** Plain text that will be rendered escaped by React; we only trim and cap length. */
export const text = (max: number, label = 'This field') =>
  z.string().trim().max(max, `${label} must be at most ${max} characters.`);

export const requiredText = (min: number, max: number, label = 'This field') =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const intField = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

/** Turn free-text user input into a safe, case-insensitive `LIKE` pattern (escapes %, _ and \). */
export function likePattern(q: string): string {
  return `%${q.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
}
