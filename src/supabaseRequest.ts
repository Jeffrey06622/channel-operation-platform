import { supabase } from './supabaseClient';

const TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  let lastError: Error = new NetworkError('请求失败');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await withTimeout(Promise.resolve(operation()));
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  if (lastError instanceof NetworkError) throw lastError;
  throw new NetworkError('网络不佳，请检查网络后重试');
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof NetworkError;
}

export { supabase };
