// 扩展各部分共用的数据结构和消息协议

export type Language = "zh" | "en" | "auto";

export interface Settings {
  apiKey: string;
  model: string;
  language: Language;
  apiBase: string;
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
  durationMs?: number;
  agentUrl?: string;
  model?: string;
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
}

export type PortEvent = { reqId: number } & (
  | { type: "started"; agentId: string; runId: string; agentUrl: string; model: string; isNewAgent: boolean; recreated: boolean }
  | { type: "event"; event: string; data: Record<string, unknown>; id: string | null }
  | { type: "reset" }
  | ({ type: "done" } & RunResult)
  | ({ type: "error" } & FriendlyError)
);

// ---------- 一次性请求 ----------

export interface ModelInfo {
  id: string;
  displayName: string;
}

export interface Me {
  userEmail?: string;
  apiKeyName?: string;
  [k: string]: unknown;
}

export type RuntimeRequest =
  | { type: "openOptions"; hash?: string }
  | { type: "testKey"; apiKey?: string }
  | { type: "listModels"; apiKey?: string }
  | { type: "archive"; agentId: string };

export type RuntimeResponse<T = unknown> = ({ ok: true } & T) | { ok: false; error: FriendlyError };
