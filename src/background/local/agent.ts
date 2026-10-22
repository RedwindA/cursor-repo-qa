// 本地 agent：在 service worker 里用 pi 跑 agent 循环，模型 API 由用户自己配置。
//
// 一次提问 = 一次 run。run 的事件先存在内存里再转发给浮窗，所以页面刷新、浮窗断开后
// 可以按事件序号接着读（和 Cursor 后端的 Last-Event-ID 一样）。浮窗断开不会停止 run。
// 会话（完整的消息记录，含工具调用）存在 IndexedDB，追问时接着用，并沿用同一个 commit。
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai";
import { getModelCache, newId } from "../../shared/storage";
import type { HistoryItem, LlmProvider, RepoRef, Settings } from "../../shared/types";
import { languageInstruction } from "../prompts";
import type { Emit } from "../stream";
import { evict, forget, idbGet, idbPut, touch } from "./idb";
import { buildModel, modelsFor, splitModelId } from "./models";
import { openRepo, RepoError, type RepoFS } from "./repo";
import { repoTools } from "./tools";

export const LOCAL_PREFIX = "local-";
export const isLocalId = (id: string | null | undefined) => !!id && id.startsWith(LOCAL_PREFIX);

const MAX_TOOL_CALLS = 40;
const MAX_SESSIONS = 100;
const KEEP_FINISHED_MS = 10 * 60 * 1000;
/** 回答结束后继续保活一段时间，追问时仓库代码还在内存里 */
const LINGER_MS = 5 * 60 * 1000;

type Out = Parameters<Emit>[0];

interface Run {
  id: string;
  sessionId: string;
  started: Out;
  /** 发出过的事件；事件 id 就是它在数组里的序号（从 1 开始） */
  events: Out[];
  subs: Set<Emit>;
  finished: boolean;
  controller: AbortController;
}

interface SessionRecord {
  key: string;
  repo: RepoRef;
  sha: string;
  messages: AgentMessage[];
  updatedAt: number;
}

const runs = new Map<string, Run>();

// ---------- service worker 保活 ----------

// 回答时可能长时间只是在等模型输出，期间没有扩展事件，service worker 会被回收。
// 定期调用一个扩展 API 让它保持活跃；回答结束后再保持 LINGER_MS，之后停掉。
let keepAlive: ReturnType<typeof setInterval> | undefined;
let lingerUntil = 0;
function updateKeepAlive(): void {
  const active = [...runs.values()].some((r) => !r.finished);
  if (active) lingerUntil = Date.now() + LINGER_MS;
  if ((active || Date.now() < lingerUntil) && !keepAlive) {
    keepAlive = setInterval(() => {
      chrome.runtime.getPlatformInfo().catch(() => {});
      updateKeepAlive();
    }, 20_000);
  } else if (!active && Date.now() >= lingerUntil && keepAlive) {
    clearInterval(keepAlive);
    keepAlive = undefined;
  }
}

// ---------- 事件 ----------

function push(run: Run, m: Out): void {
  if (run.finished) return;
  const out = m.type === "event" ? { ...m, id: String(run.events.length + 1) } : m;
  run.events.push(out);
  for (const s of run.subs) s(out);
  if (m.type === "done" || m.type === "error") {
    run.finished = true;
    updateKeepAlive();
    setTimeout(() => runs.delete(run.id), KEEP_FINISHED_MS);
  }
}

const status = (run: Run, s: string) => push(run, { type: "event", event: "status", data: { status: s }, id: null });

// ---------- 提示词 ----------

function systemPrompt(repo: RepoRef, fs: RepoFS): string {
  const { owner, name } = repo;
  const lines = [
    `你是一个只读的代码问答助手。用户正在 GitHub 上浏览仓库 ${owner}/${name}，想了解它的代码。`,
    ``,
    `仓库在 commit ${fs.sha} 的代码已经准备好（共 ${fs.files().length} 个文件），用这些工具查看，路径都相对仓库根目录：`,
    `- ls：列目录；find：按 glob 找文件；grep：按正则搜索内容；read：带行号读文件。`,
    `- 先用工具找到并阅读相关代码，再回答。可以一次发起多个工具调用。`,
    ``,
    `规则：`,
    `- 以实际读到的代码为依据回答，不确定就说明不确定，不要编造。`,
    `- 引用代码位置时给出 GitHub 链接，格式：https://github.com/${owner}/${name}/blob/${fs.sha}/<路径>#L<起始行>-L<结束行>`,
    `- 用 Markdown 回答。直接给结论，不用复述你调用了哪些工具。`,
  ];
  if (fs.remote) lines.push(``, `注意：这个仓库太大，没有下载完整代码，grep 不可用。请用 ls / find 定位文件，再用 read 读取。`);
  return lines.join("\n");
}

function userPrompt(question: string, pageUrl: string, settings: Settings, history: HistoryItem[] | null, note?: string): string {
  const lines = [`用户当前所在页面：${pageUrl}`, `（如果页面指向某个文件或目录，优先结合它回答。）`];
  if (note) lines.push(`说明：${note}`);
  if (history?.length) {
    lines.push(``, `之前的对话（供参考，可能已截断）：`);
    for (const h of history) lines.push(`${h.role === "user" ? "用户" : "助手"}：${h.text}`);
  }
  lines.push(``, `请${languageInstruction(settings.language)}。`, ``, `用户的问题：`, question);
  return lines.join("\n");
}

// ---------- 上下文裁剪 ----------

const msgChars = (m: AgentMessage): number => {
  const c = (m as { content?: unknown }).content;
  return typeof c === "string" ? c.length : JSON.stringify(c ?? "").length;
};

/** 上下文太长时，把较早的工具输出替换成占位文字（最近的 8 个保留） */
function pruneContext(messages: AgentMessage[], contextWindow: number): AgentMessage[] {
  const budget = contextWindow * 0.6 * 3; // 粗略按 1 token ≈ 3 个字符
  let total = messages.reduce((n, m) => n + msgChars(m), 0);
  if (total <= budget) return messages;
  const toolIdx = messages.flatMap((m, i) => (m.role === "toolResult" ? [i] : []));
  const out = messages.slice();
  for (const i of toolIdx.slice(0, -8)) {
    if (total <= budget) break;
    const m = out[i] as AgentMessage & { role: "toolResult" };
    total -= msgChars(m);
    out[i] = { ...m, content: [{ type: "text", text: "（较早的工具输出已省略，需要的话请重新查看）" }] };
    total += msgChars(out[i]);
  }
  return out;
}

// ---------- 运行 ----------

export interface LocalAsk {
  repo: RepoRef;
  question: string;
  pageUrl: string;
  agentId: string | null;
  history: HistoryItem[];
}

class SetupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function pickModel(settings: Settings): Promise<{ provider: LlmProvider; modelId: string }> {
  if (!settings.providers.length) throw new SetupError("no_key", "还没有配置模型服务（API key），请先打开设置添加。");
  let id = settings.model;
  if (!id) id = (await getModelCache("local"))?.models[0]?.id || "";
  const parsed = id ? splitModelId(id) : null;
  const provider = parsed && settings.providers.find((p) => p.id === parsed.providerId);
  if (!parsed || !provider) throw new SetupError("no_model", "还没有选择模型：点输入框左下角选择一个模型。");
  return { provider, modelId: parsed.modelId };
}

function friendlyModelError(msg: string): string {
  if (/\b401\b|unauthori[sz]ed|invalid.*(api.?key|token)|authentication/i.test(msg)) return `模型服务拒绝了请求，API key 无效或已过期：${msg}`;
  if (/\b429\b|rate.?limit|quota|insufficient/i.test(msg)) return `模型服务限流或额度不足：${msg}`;
  return `模型服务出错：${msg}`;
}

/** 开始一次提问。返回取消订阅函数（浮窗断开时调用，run 本身继续跑） */
export async function localAsk(settings: Settings, req: LocalAsk, emit: Emit): Promise<() => void> {
  let pick: { provider: LlmProvider; modelId: string };
  try {
    pick = await pickModel(settings);
  } catch (e) {
    const err = e as SetupError;
    emit({ type: "error", code: err.code || "error", status: 0, message: err.message });
    return () => {};
  }
  const reuse = isLocalId(req.agentId);
  const sessionId = reuse ? req.agentId! : LOCAL_PREFIX + newId();
  const run: Run = {
    id: LOCAL_PREFIX + newId(),
    sessionId,
    started: {
      type: "started",
      agentId: sessionId,
      runId: "",
      agentUrl: "",
      model: pick.modelId,
      backend: "local",
      isNewAgent: !reuse,
      recreated: false,
    },
    events: [],
    subs: new Set([emit]),
    finished: false,
    controller: new AbortController(),
  };
  run.started = { ...run.started, runId: run.id } as Out;
  runs.set(run.id, run);
  updateKeepAlive();
  emit(run.started);
  execute(run, settings, req, pick.provider, pick.modelId, reuse).catch((e) => {
    if (run.controller.signal.aborted) push(run, { type: "done", status: "CANCELLED", text: "" });
    else if (e instanceof RepoError || e instanceof SetupError) push(run, { type: "error", code: e.code, status: 0, message: e.message });
    else push(run, { type: "error", code: "error", status: 0, message: (e as Error).message || String(e) });
  });
  return () => run.subs.delete(emit);
}

async function execute(run: Run, settings: Settings, req: LocalAsk, provider: LlmProvider, modelId: string, reuse: boolean): Promise<void> {
  const signal = run.controller.signal;
  const t0 = Date.now();
  status(run, "FETCHING_REPO");
  const rec = reuse ? await idbGet<SessionRecord>("sessions", run.sessionId).catch(() => undefined) : undefined;
  const { fs, note } = await openRepo(req.repo, {
    pageUrl: req.pageUrl,
    pinnedSha: rec?.sha,
    token: settings.githubToken,
    signal,
    onDownload: () => status(run, "DOWNLOADING"),
  });
  signal.throwIfAborted();
  status(run, "RUNNING");

  const model = buildModel(provider, modelId);
  const models = modelsFor(provider, model);
  let toolCalls = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: systemPrompt(req.repo, fs),
      model,
      thinkingLevel: model.reasoning ? "medium" : "off",
      tools: repoTools(fs),
      messages: rec?.messages ?? [],
    },
    streamFn: models.streamSimple.bind(models),
    sessionId: run.sessionId,
    identity: { attribution: null },
    transformContext: async (messages) => pruneContext(messages, model.contextWindow),
    beforeToolCall: async () =>
      ++toolCalls > MAX_TOOL_CALLS ? { block: true, reason: "这次回答的工具调用次数已达上限，请根据已经获得的信息直接回答。" } : undefined,
  });
  signal.addEventListener("abort", () => agent.abort(), { once: true });

  agent.subscribe((ev) => {
    if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
      push(run, { type: "event", event: "assistant", data: { text: ev.assistantMessageEvent.delta }, id: null });
    } else if (ev.type === "tool_execution_start") {
      push(run, { type: "event", event: "tool_call", data: { callId: ev.toolCallId, name: ev.toolName, args: ev.args, status: "running" }, id: null });
    } else if (ev.type === "tool_execution_end") {
      push(run, { type: "event", event: "tool_call", data: { callId: ev.toolCallId, name: ev.toolName, status: ev.isError ? "error" : "completed" }, id: null });
    }
  });

  const before = agent.state.messages.length;
  // 会话记录丢了（被清理或上次失败）时，把浮窗带来的最近对话放进问题里
  const history = !rec && req.history.length ? req.history : null;
  await agent.prompt(userPrompt(req.question, req.pageUrl, settings, history, note));

  const added = agent.state.messages.slice(before);
  const replies = added.filter((m): m is PiAssistantMessage => m.role === "assistant");
  const last = replies[replies.length - 1];
  const totalTokens = replies.reduce((n, m) => n + (m.usage?.totalTokens || 0), 0);
  const costUsd = replies.reduce((n, m) => n + (m.usage?.cost?.total || 0), 0);
  const ok = !signal.aborted && last && last.stopReason !== "error" && last.stopReason !== "aborted";

  // 失败或被停止的这一轮不写进会话，避免下次带着半截的工具调用继续
  const messages = ok ? agent.state.messages : agent.state.messages.slice(0, before);
  if (messages.length) await saveSession({ key: run.sessionId, repo: req.repo, sha: fs.sha, messages, updatedAt: Date.now() });

  const durationMs = Date.now() - t0;
  if (signal.aborted || last?.stopReason === "aborted") push(run, { type: "done", status: "CANCELLED", text: "", totalTokens, costUsd, durationMs });
  else if (!last || last.stopReason === "error") {
    push(run, { type: "error", code: "model_error", status: 0, message: friendlyModelError(last?.errorMessage || agent.state.errorMessage || "没有返回内容") });
  } else push(run, { type: "done", status: "FINISHED", text: "", totalTokens, costUsd, durationMs });
}

async function saveSession(rec: SessionRecord): Promise<void> {
  try {
    await idbPut("sessions", rec);
    await touch("sessions", rec.key, JSON.stringify(rec.messages).length);
    await evict("sessions", { maxCount: MAX_SESSIONS });
  } catch {
    /* 存不下也不影响这次回答 */
  }
}

/** 浮窗重连：先重发 started，再补发 lastEventId 之后的事件 */
export function localResume(runId: string, lastEventId: string | null, emit: Emit): () => void {
  const run = runs.get(runId);
  if (!run) {
    emit({ type: "error", code: "run_lost", status: 0, message: "这次回答在后台中断了（浏览器回收了扩展的后台进程），请重新提问。" });
    return () => {};
  }
  emit(run.started);
  for (const m of run.events.slice(Number(lastEventId) || 0)) emit(m);
  if (run.finished) return () => {};
  run.subs.add(emit);
  return () => run.subs.delete(emit);
}

export function localCancel(runId: string): void {
  runs.get(runId)?.controller.abort();
}

export async function localArchive(sessionId: string): Promise<void> {
  await forget("sessions", sessionId);
}
