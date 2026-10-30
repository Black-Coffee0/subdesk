/** An error whose message is safe to show to the person using the site. */
export class AppError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;
  constructor(code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export const notFound = (what = 'That item') => new AppError('not_found', `${what} could not be found.`);
export const forbidden = (msg = 'You do not have permission to do that.') => new AppError('forbidden', msg);
export const unauthenticated = () => new AppError('unauthenticated', 'Please log in to continue.');
export const rateLimited = (msg = 'Too many attempts. Please wait a few minutes and try again.') =>
  new AppError('rate_limited', msg);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
