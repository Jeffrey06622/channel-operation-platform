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

export { supabase };
