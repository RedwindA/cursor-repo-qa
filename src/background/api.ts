// Cursor API 的 HTTP 封装。API key 只在后台使用，不会进入 GitHub 页面。
import type { FriendlyError, Settings } from "../shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message || code || `HTTP ${status}`);
  }
}

export function authHeader(apiKey: string): string {
  // Basic 认证：用户名是 key，密码为空
  const bytes = new TextEncoder().encode(apiKey + ":");
  return "Basic " + btoa(String.fromCharCode(...bytes));
}

export async function api<T = unknown>(
  settings: Settings,
  method: string,
  path: string,
  body?: unknown,
  { signal, headers }: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<T> {
  if (!settings.apiKey) throw new ApiError(0, "no_key", "还没有设置 Cursor API key");
  let res: Response;
  try {
    res = await fetch(settings.apiBase + path, {
      method,
      signal,
      headers: {
        Authorization: authHeader(settings.apiKey),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "无法连接 Cursor API：" + (e as Error).message);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function toApiError(res: Response): Promise<ApiError> {
  let code = "";
  let message = "";
  try {
    const j = await res.json();
    const err = j.error || j;
    code = err.code || "";
    message = err.message || j.message || "";
  } catch {
    /* 非 JSON 响应 */
  }
  return new ApiError(res.status, code, message || `HTTP ${res.status}`);
}

export function friendlyError(e: unknown): FriendlyError {
  const err = e as Partial<ApiError>;
  const code = err.code || "";
  const status = err.status || 0;
  let message = err.message || String(e);
  if (code === "no_key") message = "还没有设置 Cursor API key，请先打开设置填写。";
  else if (status === 401) message = "API key 无效或已过期，请到设置里检查。";
  else if (code === "feature_unavailable") message = "你的账号没有开通无仓库 Cloud Agent（feature_unavailable）。";
  else if (code === "agent_busy") message = "上一个问题还在处理中，请等它结束或先停止。";
  else if (status === 429) message = "请求太频繁或额度用完了（429），稍后再试。";
  else if (status >= 500) message = `Cursor 服务暂时出错（${status}）：${message}`;
  return { code: code || (status ? `http_${status}` : "error"), status, message };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
