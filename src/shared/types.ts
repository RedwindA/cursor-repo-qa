// 扩展各部分共用的数据结构和消息协议

export type Language = "zh" | "en" | "auto";

/** local：扩展里跑 agent，调用自己配置的模型 API；cursor：Cursor Cloud Agent */
export type Backend = "local" | "cursor";

export type ProviderKind = "openai" | "anthropic";

/** 一个模型服务（OpenAI 兼容或 Anthropic 接口） */
export interface LlmProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  /** 手动指定的模型 id（服务不支持列出模型时用），留空就自动获取 */
  models: string[];
}

export interface Settings {
  backend: Backend;
  apiKey: string;
  model: string;
  language: Language;
  apiBase: string;
  providers: LlmProvider[];
  /** 可选的 GitHub token：读私有仓库、提高 API 限额 */
  githubToken: string;
}

export interface RepoRef {
  owner: string;
  name: string;
}

// ---------- 会话 ----------

export type RunOutcome = "running" | "finished" | "error" | "cancelled" | "expired";

export interface ToolStep {
  callId: string;
  name: string;
  detail: string;
  status?: string;
}

export interface UserMessage {
  role: "user";
  text: string;
  ts: number;
  pageUrl?: string;
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  ts: number;
  status: RunOutcome;
  activity: ToolStep[];
  runStatus?: string;
  note?: string;
  error?: string;
  errorCode?: string;
  totalTokens?: number | null;
  /** 本地 agent：按模型目录价格估算的费用（美元） */
  costUsd?: number;
  durationMs?: number;
  agentUrl?: string;
  model?: string;
  /** 回答来自哪个后端（旧记录没有，视为 cursor） */
  backend?: Backend;
  stopping?: boolean;
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface PendingRun {
  agentId: string;
  runId: string;
  msgIndex: number;
}

export interface Conversation {
  id: string;
  repo: RepoRef;
  /** owner/name 小写，用于按仓库归类 */
  repoKey: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  agentId: string | null;
  agentUrl: string;
  /** 创建云端 agent 时用的模型（"" 表示默认）。追问不能换模型，换了就得新开 agent */
  agentModel?: string;
  messages: ChatMessage[];
  pending: PendingRun | null;
}

// ---------- 浮窗 ⇄ 后台（长连接） ----------

export interface HistoryItem {
  role: "user" | "assistant";
  text: string;
}

export type PortRequest =
  | { type: "ping" }
  | { type: "ask"; reqId: number; repo: RepoRef; question: string; pageUrl: string; agentId: string | null; history: HistoryItem[] }
  | { type: "resume"; reqId: number; agentId: string; runId: string; lastEventId: string | null }
  | { type: "cancel"; reqId: number; agentId: string; runId: string };

export interface FriendlyError {
  code: string;
  status: number;
  message: string;
}

export interface RunResult {
  status: string;
  text: string;
  durationMs?: number;
  totalTokens?: number | null;
  costUsd?: number;
}

export type PortEvent = { reqId: number } & (
  | { type: "started"; agentId: string; runId: string; agentUrl: string; model: string; backend: Backend; isNewAgent: boolean; recreated: boolean }
  | { type: "event"; event: string; data: Record<string, unknown>; id: string | null }
  | { type: "reset" }
  | ({ type: "done" } & RunResult)
  | ({ type: "error" } & FriendlyError)
);

// ---------- 一次性请求 ----------

export interface ModelInfo {
  id: string;
  displayName: string;
  /** 菜单里的第二行（本地 agent：服务名 · 模型 id） */
  detail?: string;
}

export interface Me {
  userEmail?: string;
  apiKeyName?: string;
  [k: string]: unknown;
}

export type RuntimeRequest =
  | { type: "openOptions"; hash?: string }
  | { type: "testKey"; apiKey?: string }
  | { type: "testProvider"; provider: LlmProvider }
  | { type: "listModels"; apiKey?: string; /** 允许用缓存（浮窗里用） */ cached?: boolean }
  | { type: "archive"; agentId: string };

export type RuntimeResponse<T = unknown> = ({ ok: true } & T) | { ok: false; error: FriendlyError };
