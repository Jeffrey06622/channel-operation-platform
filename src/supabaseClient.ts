import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── 同源代理（国内网络连通性保障） ──────────────────────────────────────────
// *.supabase.co 在部分中国大陆网络中被按 SNI 精准阻断：TCP 能连通，但携带
// supabase SNI 的 TLS 握手被重置，浏览器表现为 "TypeError: Failed to fetch"，
// 而本站本身（Netlify 托管）可正常访问。因此把数据库请求改走本站域名：
// netlify.toml 中的重写规则会把 /sb/* 在 Netlify 边缘节点转发到 Supabase。
//
// 选路策略：代理失败后进入 30 秒冷却，冷却期内直连（限时 3 秒）；成功的通道
// 记入 sessionStorage，10 分钟内优先使用。
//
// 注意：SUPABASE_REDIRECT_TARGET_HOST 必须与 netlify.toml 中的转发目标一致。
const SUPABASE_REDIRECT_TARGET_HOST = 'faldvtbftbiusovpchqb.supabase.co';
const PROD_HOST = 'zjbchotelchanneloperationdecisionplatform.com';
const PROXY_PATH = '/sb';

// 超时必须真正中断 TCP 连接，否则挂起的请求会占满浏览器同域连接槽位。
const REQUEST_TIMEOUT_MS = 8000;
const DIRECT_TIMEOUT_MS = 3000;
const PROXY_COOLDOWN_MS = 30000;
const CHANNEL_MEMORY_MS = 10 * 60 * 1000;
const CHANNEL_STORAGE_KEY = 'hotel-decision-channel';

type Channel = 'proxy' | 'direct';

let proxyCooldownUntil = 0;
let lastGood: { channel: Channel; at: number } = readRememberedChannel() ?? {
  channel: 'proxy',
  at: 0,
};

function readRememberedChannel(): { channel: Channel; at: number } | null {
  try {
    const raw = sessionStorage.getItem(CHANNEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { channel?: unknown; at?: unknown };
    if ((parsed.channel === 'proxy' || parsed.channel === 'direct') && typeof parsed.at === 'number') {
      return { channel: parsed.channel, at: parsed.at };
    }
    return null;
  } catch {
    return null;
  }
}

function rememberChannel(channel: Channel): void {
  lastGood = { channel, at: Date.now() };
  try {
    sessionStorage.setItem(CHANNEL_STORAGE_KEY, JSON.stringify(lastGood));
  } catch {
    // 无存储权限时仅保留内存中的记录
  }
}

function rewriteToProxy(url: string): string {
  const marker = `://${SUPABASE_REDIRECT_TARGET_HOST}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const path = url.slice(idx + marker.length - 1); // 保留开头的 '/'
  return `${window.location.origin}${PROXY_PATH}${path}`;
}

function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const outer = init?.signal;
  const forwardAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException('请求超时', 'TimeoutError')),
    timeoutMs,
  );
  return fetch(input as RequestInfo, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forwardAbort);
  });
}

async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const targetsSupabase = rawUrl.includes(
    `://${SUPABASE_REDIRECT_TARGET_HOST}/`,
  );
  if (!targetsSupabase) return fetch(input as RequestInfo, init);

  if (window.location.hostname !== PROD_HOST) {
    return timedFetch(input, init, REQUEST_TIMEOUT_MS);
  }

  const direct = async () => {
    const res = await timedFetch(input, init, DIRECT_TIMEOUT_MS);
    rememberChannel('direct');
    return res;
  };

  const tryProxy = async () => {
    try {
      const res = await timedFetch(rewriteToProxy(rawUrl), init, REQUEST_TIMEOUT_MS);
      const contentType = res.headers.get('content-type') || '';
      // 非 JSON 的 404 意味着 /sb 重写规则在当前部署上不存在，请求没有到达数据库。
      if (res.status === 404 && !contentType.includes('json')) {
        throw new Error('proxy route unavailable');
      }
      rememberChannel('proxy');
      return res;
    } catch (err) {
      if (!init?.signal?.aborted) {
        proxyCooldownUntil = Date.now() + PROXY_COOLDOWN_MS;
      }
      throw err;
    }
  };

  const proxyCooling = Date.now() < proxyCooldownUntil;
  const preferDirect =
    lastGood.channel === 'direct' && Date.now() - lastGood.at < CHANNEL_MEMORY_MS;

  if (preferDirect || proxyCooling) {
    try {
      return await direct();
    } catch (directErr) {
      if (Date.now() < proxyCooldownUntil) throw directErr;
      try {
        return await tryProxy();
      } catch {
        throw directErr;
      }
    }
  }

  try {
    return await tryProxy();
  } catch {
    return direct();
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: resilientFetch },
});
