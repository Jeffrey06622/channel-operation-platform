import { supabase } from './supabaseClient';

const TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

export class NetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Only genuine transport-level failures (offline, DNS, TLS, CORS, timeout)
// may be reported to the user as a network problem. Every other failure — a
// PostgREST error, a raised database exception, a business-rule rejection —
// must keep its original message, otherwise the real cause is impossible to
// diagnose from the interface.
const TRANSPORT_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|econnrefused|econnreset|etimedout|enotfound|socket hang up|internet|offline|超时|timed out|timeout/i;

export function isTransportError(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'NetworkError';
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'NetworkError') return true;
    return TRANSPORT_ERROR_PATTERN.test(err.message);
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new NetworkError('网络请求超时，请检查网络后重试'));
    }, TIMEOUT_MS);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function supabaseFetch<T>(
  operation: () => PromiseLike<T> | Promise<T>,
): Promise<T> {
  let lastError: unknown = new NetworkError('请求失败');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withTimeout(Promise.resolve(operation()));
      return result;
    } catch (err) {
      lastError = err;
      // A database or business-rule error is deterministic: retrying cannot
      // help, and replacing its message with a generic one hides the cause.
      if (!isTransportError(err)) throw err;
      if (attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  if (lastError instanceof NetworkError) throw lastError;
  throw new NetworkError('网络不佳，请检查网络后重试', lastError);
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof NetworkError;
}

/**
 * True when the error means "this RPC does not exist on the server yet".
 * The batch-2 database migration introduces verify_group_login /
 * change_group_password / change_teacher_password / reset_group_password.
 * Until that migration is applied, callers fall back to the legacy code
 * path; once it is applied the legacy path loses its column privileges.
 * This check is what makes the frontend work in BOTH states.
 */
export function isRpcMissing(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (code === 'PGRST202') return true;
  const message =
    err instanceof Error ? err.message : (err as { message?: string }).message;
  if (typeof message === 'string') {
    return /could not find the function|function .* does not exist|schema cache empty/i.test(
      message,
    );
  }
  return false;
}

/**
 * True when the error means "this column does not exist on the server".
 * Used while rolling out the batch-3 migration (groups.password_plain):
 * an insert that carries the column is retried without it on a database where
 * the migration has not been applied yet, so group creation never breaks in
 * the window between publishing the frontend and applying the SQL.
 */
export function isUnknownColumn(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (code === 'PGRST204' || code === '42703') return true;
  const message =
    err instanceof Error ? err.message : (err as { message?: string }).message;
  if (typeof message === 'string') {
    return /column .* does not exist|could not find the '.*' column/i.test(message);
  }
  return false;
}

/**
 * True when the error means the database is not on the newest password
 * migration: `groups.password_plain` is either absent, or present but not
 * covered by the column-level grant (PostgREST reports that as 42501
 * "permission denied"). Callers degrade gracefully instead of failing.
 */
export function isMissingPasswordColumn(err: unknown): boolean {
  if (isUnknownColumn(err)) return true;
  return !!err && (err as { code?: string }).code === '42501';
}

export { supabase };
