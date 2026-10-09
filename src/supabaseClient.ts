import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── 同源代理（国内网络连通性保障） ──────────────────────────────────────────
// *.supabase.co 在部分中国大陆网络中被按 SNI 精准阻断：TCP 能连通，但携带
// supabase SNI 的 TLS 握手被重置，浏览器表现为 "TypeError: Failed to fetch"，
// 而本站本身（Netlify 托管）可正常访问。因此把数据库请求改走本站域名：
// netlify.toml 中的重写规则会把 /sb/* 在 Netlify 边缘节点转发到 Supabase。
//
// 兜底策略：代理不可用时自动回落直连；直连也被阻断时再给代理一次机会。
// 这样无论部署环境是否带转发规则、网络是否间歇性干扰，都取当前可用的路径。
//
// 注意：SUPABASE_REDIRECT_TARGET_HOST 必须与 netlify.toml 中的转发目标一致。
const SUPABASE_REDIRECT_TARGET_HOST = 'faldvtbftbiusovpchqb.supabase.co';
const PROD_HOST = 'zjbchotelchanneloperationdecisionplatform.com';
const PROXY_PATH = '/sb';

// 只有部署在生产域名上时才默认走代理（开发环境本地没有转发规则）。
let proxyUsable =
  typeof window !== 'undefined' && window.location.hostname === PROD_HOST;

function rewriteToProxy(url: string): string {
  const marker = `://${SUPABASE_REDIRECT_TARGET_HOST}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const path = url.slice(idx + marker.length - 1); // 保留开头的 '/'
  return `${window.location.origin}${PROXY_PATH}${path}`;
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

  const viaProxy = () => fetch(rewriteToProxy(rawUrl), init);
  const direct = () => fetch(input as RequestInfo, init);

  if (proxyUsable) {
    try {
      const res = await viaProxy();
      const contentType = res.headers.get('content-type') || '';
      // 非 JSON 的 404 意味着 /sb 重写规则在当前部署上不存在（netlify.toml
      // 未生效），请求根本没到数据库——此时回落直连永远是安全的。
      if (res.status === 404 && !contentType.includes('json')) {
        proxyUsable = false;
      } else {
        return res;
      }
    } catch {
      // 代理路径网络级失败：记为不可用，改走直连。
      proxyUsable = false;
    }
  }

  try {
    return await direct();
  } catch (directErr) {
    // 生产域名上直连被阻断、而代理还没被证明可用时，再给代理一次机会
    // （首次请求可能只是撞上了瞬时故障）。被 SNI 阻断的连接从未发出
    // 任何 HTTP 内容，因此这里重试不会造成重复写入。
    if (!proxyUsable && window.location.hostname === PROD_HOST) {
      try {
        const res = await viaProxy();
        proxyUsable = true;
        return res;
      } catch {
        // 代理也失败：把直连的原始错误抛给上层。
      }
    }
    throw directErr;
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: resilientFetch },
});
