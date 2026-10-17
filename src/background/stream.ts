// 读取 run 的 SSE 流；断线带 Last-Event-ID 重连，流不可用时退回轮询
import type { PortEvent, RunResult, Settings } from "../shared/types";
import { ApiError, api, authHeader, sleep, toApiError } from "./api";

const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);
const SILENT_EVENTS = new Set(["heartbeat", "interaction_update", "thinking"]);

export interface RunTask {
  agentId: string;
  runId: string;
  controller: AbortController;
  lastEventId: string | null;
  result: Record<string, unknown> | null;
}

/** 发给浮窗的消息（reqId 由调用方补上） */
export type Emit = (m: DistributiveOmit<PortEvent, "reqId">) => void;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

interface SSEEvent {
  event: string;
  id: string | null;
  data: Record<string, unknown>;
}

function parseSSEBlock(block: string): SSEEvent | null {
  let event = "message";
  let id: string | null = null;
  const data: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    if (!raw || raw.startsWith(":")) continue;
    const i = raw.indexOf(":");
    const field = i === -1 ? raw : raw.slice(0, i);
    let value = i === -1 ? "" : raw.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (!data.length && event === "message") return null;
  const text = data.join("\n");
  let parsed: Record<string, unknown>;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { event, id, data: parsed };
}

const runPath = (t: RunTask) => `/v1/agents/${encodeURIComponent(t.agentId)}/runs/${encodeURIComponent(t.runId)}`;

/** 读一次流："result" 拿到结果；"ended" 中断可重连；"gone" 流已不可用 */
async function readStreamOnce(settings: Settings, task: RunTask, emit: Emit): Promise<"result" | "ended" | "gone"> {
  const headers: Record<string, string> = { Accept: "text/event-stream", Authorization: authHeader(settings.apiKey) };
  if (task.lastEventId) headers["Last-Event-ID"] = task.lastEventId;
  let res: Response;
  try {
    res = await fetch(settings.apiBase + runPath(task) + "/stream", { headers, signal: task.controller.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return "ended";
  }
  if (res.status === 410) return "gone";
  if (res.status === 400 && task.lastEventId) {
    // Last-Event-ID 无效：从头再读
    task.lastEventId = null;
    emit({ type: "reset" });
    return "ended";
  }
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      // 连接中途断开：交给上层带 Last-Event-ID 重连
      if (task.controller.signal.aborted) throw new DOMException("aborted", "AbortError");
      return "ended";
    }
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let m: RegExpMatchArray | null;
    while ((m = buf.match(/\r?\n\r?\n/))) {
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index! + m[0].length);
      const ev = parseSSEBlock(block);
      if (!ev) continue;
      if (ev.id) task.lastEventId = ev.id;
      if (SILENT_EVENTS.has(ev.event)) continue;
      if (ev.event === "result") {
        task.result = ev.data;
        return "result";
      }
      if (ev.event === "error") {
        throw new ApiError(0, String(ev.data.code || "stream_error"), String(ev.data.message || "流式输出出错"));
      }
      if (ev.event === "done") return task.result ? "result" : "ended";
      emit({ type: "event", event: ev.event, data: ev.data, id: task.lastEventId });
    }
  }
  return "ended";
}

async function pollRun(settings: Settings, task: RunTask): Promise<RunResult> {
  for (;;) {
    const run = await api<{ status: string; result?: string; durationMs?: number }>(settings, "GET", runPath(task), null, { signal: task.controller.signal });
    if (TERMINAL.has(run.status)) return { status: run.status, text: run.result || "", durationMs: run.durationMs };
    await sleep(3000, task.controller.signal);
  }
}

export async function followRun(settings: Settings, task: RunTask, emit: Emit): Promise<void> {
  let final: RunResult | null = null;
  let attempts = 0;
  while (!final) {
    const outcome = await readStreamOnce(settings, task, emit);
    if (outcome === "result") {
      const r = task.result || {};
      final = { status: String(r.status || "FINISHED"), text: String(r.text || ""), durationMs: r.durationMs as number | undefined };
    } else if (outcome === "gone" || ++attempts > 5) {
      final = await pollRun(settings, task);
    } else {
      await sleep(1000 * attempts, task.controller.signal);
    }
  }
  // 补一个 token 用量（失败就算了）
  try {
    const u = await api<{ totalUsage?: { totalTokens?: number } }>(
      settings,
      "GET",
      `/v1/agents/${encodeURIComponent(task.agentId)}/usage?runId=${encodeURIComponent(task.runId)}`,
      null,
      { signal: task.controller.signal },
    );
    final.totalTokens = u?.totalUsage?.totalTokens ?? null;
  } catch {
    /* 忽略 */
  }
  emit({ type: "done", ...final });
}
