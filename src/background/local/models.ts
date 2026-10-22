// 本地 agent 的模型：列出各个模型服务的模型，并为选中的模型构造 pi 的 Model。
//
// 模型 id 存成 “服务 id/模型 id”。上下文长度、价格、是否推理模型以及各家接口的兼容参数
// 尽量从 pi 自带的模型目录里查（按服务地址和模型 id 匹配），查不到就用保守的默认值。
import { createModels, createProvider, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { FIREWORKS_MODELS } from "@earendil-works/pi-ai/providers/fireworks.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { GROQ_MODELS } from "@earendil-works/pi-ai/providers/groq.models";
import { MINIMAX_CN_MODELS } from "@earendil-works/pi-ai/providers/minimax-cn.models";
import { MINIMAX_MODELS } from "@earendil-works/pi-ai/providers/minimax.models";
import { MISTRAL_MODELS } from "@earendil-works/pi-ai/providers/mistral.models";
import { MOONSHOTAI_CN_MODELS } from "@earendil-works/pi-ai/providers/moonshotai-cn.models";
import { MOONSHOTAI_MODELS } from "@earendil-works/pi-ai/providers/moonshotai.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { TOGETHER_MODELS } from "@earendil-works/pi-ai/providers/together.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import { XIAOMI_MODELS } from "@earendil-works/pi-ai/providers/xiaomi.models";
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models";
import type { LlmProvider, ModelInfo } from "../../shared/types";
import { ApiError } from "../api";

type AnyModel = Model<Api>;

// 目录是 { 模型 id: Model } 的对象
const CATALOGS: [host: RegExp, models: object][] = [
  [/anthropic\.com/, ANTHROPIC_MODELS],
  [/openai\.com/, OPENAI_MODELS],
  [/deepseek\.com/, DEEPSEEK_MODELS],
  [/moonshot\.ai/, MOONSHOTAI_MODELS],
  [/moonshot\.cn/, MOONSHOTAI_CN_MODELS],
  [/z\.ai|bigmodel\.cn/, ZAI_MODELS],
  [/minimax\.io/, MINIMAX_MODELS],
  [/minimaxi\.com/, MINIMAX_CN_MODELS],
  [/x\.ai/, XAI_MODELS],
  [/groq\.com/, GROQ_MODELS],
  [/openrouter\.ai/, OPENROUTER_MODELS],
  [/googleapis\.com/, GOOGLE_MODELS],
  [/mistral\.ai/, MISTRAL_MODELS],
  [/xiaomimimo\.com/, XIAOMI_MODELS],
  [/together\.(ai|xyz)/, TOGETHER_MODELS],
  [/fireworks\.ai/, FIREWORKS_MODELS],
];

const isChat = (m: unknown): m is AnyModel => !!m && typeof m === "object" && (!("type" in m) || (m as { type?: string }).type === "chat");

/** 在模型目录里找这个模型：先找服务地址对应的目录，再在所有目录里按 id 找（代理、中转站常用原名） */
export function catalogModel(baseUrl: string, modelId: string): AnyModel | undefined {
  const id = modelId.toLowerCase();
  const chats = (catalog: object) => Object.values(catalog).filter(isChat);
  for (const [host, catalog] of CATALOGS) {
    if (!host.test(baseUrl)) continue;
    const m = chats(catalog).find((x) => x.id.toLowerCase() === id);
    if (m) return m;
  }
  // 中转站常见的 “厂商/模型” 写法
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  for (const [, catalog] of CATALOGS) {
    const m = chats(catalog).find((x) => x.id.toLowerCase() === id || x.id.toLowerCase() === bare);
    if (m) return m;
  }
  return undefined;
}

export const apiOf = (p: LlmProvider): Api => (p.kind === "anthropic" ? "anthropic-messages" : "openai-completions");

/** Anthropic SDK 会自己拼 /v1/messages，用户填了 /v1 就去掉 */
export const effectiveBaseUrl = (p: LlmProvider) => (p.kind === "anthropic" ? p.baseUrl.replace(/\/v1$/, "") : p.baseUrl);

export function buildModel(p: LlmProvider, modelId: string): AnyModel {
  const api = apiOf(p);
  const known = catalogModel(p.baseUrl, modelId);
  const sameApi = known?.api === api;
  return {
    id: modelId,
    name: known?.name || modelId,
    api,
    provider: p.id,
    baseUrl: effectiveBaseUrl(p),
    reasoning: known?.reasoning ?? false,
    input: ["text"],
    cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: known?.contextWindow ?? 128_000,
    // 回答问题用不到太长的输出；目录里没有的模型保守一点，避免超过服务端上限
    maxTokens: Math.min(known?.maxTokens ?? 8192, 32_000),
    ...(sameApi && known?.compat ? { compat: known.compat } : {}),
    ...(sameApi && known?.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {}),
  } as AnyModel;
}

/** 为一次运行准备 pi 的 Models（只注册用到的这个服务和模型） */
export function modelsFor(p: LlmProvider, model: AnyModel) {
  const models = createModels();
  models.setProvider(
    createProvider({
      id: p.id,
      name: p.name,
      baseUrl: model.baseUrl,
      // 没填 key 的本地服务（Ollama 等）也算已配置
      auth: { apiKey: { name: p.name, resolve: async () => ({ auth: p.apiKey ? { apiKey: p.apiKey } : {} }) } },
      models: [model],
      api: p.kind === "anthropic" ? anthropicMessagesApi() : openAICompletionsApi(),
    }),
  );
  return models;
}

// ---------- 模型列表 ----------

export const localModelId = (p: LlmProvider, modelId: string) => `${p.id}/${modelId}`;

export function splitModelId(id: string): { providerId: string; modelId: string } | null {
  const i = id.indexOf("/");
  return i > 0 ? { providerId: id.slice(0, i), modelId: id.slice(i + 1) } : null;
}

async function fetchJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    throw new ApiError(0, "network", "无法连接模型服务：" + (e as Error).message);
  }
  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || "";
    } catch {
      /* 非 JSON */
    }
    throw new ApiError(res.status, `http_${res.status}`, msg || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 列出一个服务的模型 id（服务填了模型列表就直接用） */
export async function listProviderModels(p: LlmProvider, signal?: AbortSignal): Promise<{ id: string; name?: string }[]> {
  if (p.models.length) return p.models.map((id) => ({ id }));
  if (!p.baseUrl) throw new ApiError(0, "no_base_url", "没有填写服务地址");
  if (p.kind === "anthropic") {
    const headers: Record<string, string> = { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    if (p.apiKey) headers["x-api-key"] = p.apiKey;
    const j = (await fetchJson(`${effectiveBaseUrl(p)}/v1/models?limit=1000`, headers, signal)) as { data?: { id: string; display_name?: string }[] };
    return (j.data || []).map((m) => ({ id: m.id, name: m.display_name }));
  }
  const headers: Record<string, string> = p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {};
  const j = (await fetchJson(`${p.baseUrl}/models`, headers, signal)) as { data?: { id: string; name?: string }[] };
  return (j.data || []).map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listLocalModels(providers: LlmProvider[]): Promise<{ models: ModelInfo[]; errors: string[] }> {
  const models: ModelInfo[] = [];
  const errors: string[] = [];
  const results = await Promise.allSettled(providers.map((p) => listProviderModels(p, AbortSignal.timeout(15000))));
  results.forEach((r, i) => {
    const p = providers[i];
    if (r.status === "rejected") {
      errors.push(`${p.name}：${(r.reason as Error).message}`);
      return;
    }
    for (const m of r.value) {
      const known = catalogModel(p.baseUrl, m.id);
      models.push({ id: localModelId(p, m.id), displayName: m.name || known?.name || m.id, detail: `${p.name} · ${m.id}` });
    }
  });
  return { models, errors };
}
