// GitHub 仓库问答 —— 后台 service worker
// 两个后端：本地 agent（local/，在这里跑 agent 循环，调用自己配置的模型 API），
// 或 Cursor Cloud Agents API（读取 SSE 流）。结果都按同样的消息格式转发给页面里的浮窗。
import { getModelCache, getSettings, migrateLegacy, MODEL_CACHE_TTL, modelCacheKey, type ModelCache } from "../shared/storage";
import type { Backend, HistoryItem, Me, ModelInfo, PortRequest, RepoRef, RuntimeRequest, RuntimeResponse, Settings } from "../shared/types";
import { api, friendlyError } from "./api";
import { isLocalId, localArchive, localAsk, localCancel, localResume } from "./local/agent";
import { listLocalModels, listProviderModels } from "./local/models";
import { firstPrompt, followUpPrompt } from "./prompts";
import { followRun, type Emit, type RunTask } from "./stream";

const PORT_NAME = "cursor-repo-qa";

interface Started {
  agentId: string;
  runId: string;
  agentUrl?: string;
  isNewAgent?: boolean;
  recreated?: boolean;
}

// ---------- 创建 agent / run ----------

async function createAgent(settings: Settings, repo: RepoRef, question: string, pageUrl: string, history: HistoryItem[] | null): Promise<Started> {
  const body: Record<string, unknown> = {
    prompt: { text: firstPrompt(repo, question, pageUrl, settings.language, history) },
    name: `问答：${repo.owner}/${repo.name}`.slice(0, 100),
    autoCreatePR: false,
  };
  if (settings.model) body.model = { id: settings.model };
  // 不传 repos 和 env：无仓库 agent，由 agent 自己 git clone 公开仓库
  const res = await api<{ agent: { id: string; url?: string }; run: { id: string } }>(settings, "POST", "/v1/agents", body);
  return { agentId: res.agent.id, agentUrl: res.agent.url || "", runId: res.run.id, isNewAgent: true };
}

async function createRun(settings: Settings, agentId: string, repo: RepoRef, question: string, pageUrl: string): Promise<Started> {
  const res = await api<{ run: { id: string } }>(settings, "POST", `/v1/agents/${encodeURIComponent(agentId)}/runs`, {
    prompt: { text: followUpPrompt(repo, question, pageUrl, settings.language) },
  });
  return { agentId, runId: res.run.id, isNewAgent: false };
}

// ---------- 与浮窗的长连接 ----------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  const tasks = new Map<string, RunTask>(); // runId -> task
  // 本地 run 不随浮窗断开而停止，只取消订阅
  const unsubs = new Set<() => void>();
  let alive = true;
  port.onDisconnect.addListener(() => {
    alive = false;
    for (const t of tasks.values()) t.controller.abort();
    tasks.clear();
    for (const u of unsubs) u();
    unsubs.clear();
  });

  const post = (msg: object) => {
    if (!alive) return;
    try {
      port.postMessage(msg);
    } catch {
      /* 已断开 */
    }
  };

  async function run(reqId: number, starter: (settings: Settings) => Promise<Started>, lastEventId: string | null = null) {
    const settings = await getSettings();
    let task: RunTask | null = null;
    const emit: Emit = (m) => post({ reqId, ...m });
    try {
      const started = await starter(settings);
      task = { agentId: started.agentId, runId: started.runId, controller: new AbortController(), lastEventId, result: null };
      tasks.set(task.runId, task);
      emit({
        type: "started",
        agentId: task.agentId,
        runId: task.runId,
        agentUrl: started.agentUrl || "",
        model: settings.model,
        backend: "cursor",
        isNewAgent: !!started.isNewAgent,
        recreated: !!started.recreated,
      });
      await followRun(settings, task, emit);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      emit({ type: "error", ...friendlyError(e) });
    } finally {
      if (task) tasks.delete(task.runId);
    }
  }

  port.onMessage.addListener(async (msg: PortRequest) => {
    switch (msg.type) {
      case "ping":
        return;

      case "ask": {
        const { reqId, repo, question, pageUrl, agentId, history } = msg;
        const settings = await getSettings();
        if (settings.backend === "local") {
          const unsub = await localAsk(settings, { repo, question, pageUrl, agentId, history }, (m) => post({ reqId, ...m }));
          if (alive) unsubs.add(unsub);
          else unsub();
          return;
        }
        run(reqId, async (settings) => {
          // 新会话、换了模型需要新开 agent，或之前是本地 agent 的会话（这时 history 里带着最近的对话）
          if (!agentId || isLocalId(agentId)) return createAgent(settings, repo, question, pageUrl, history.length ? history : null);
          try {
            return await createRun(settings, agentId, repo, question, pageUrl);
          } catch (e) {
            // 旧会话已归档/过期/不存在：开新 agent，并把最近的对话带上
            const { status = 0, code = "" } = e as { status?: number; code?: string };
            const gone = status === 404 || status === 410 || (status === 409 && code !== "agent_busy");
            if (!gone) throw e;
            const r = await createAgent(settings, repo, question, pageUrl, history);
            return { ...r, recreated: true };
          }
        });
        return;
      }

      case "resume":
        if (isLocalId(msg.runId)) {
          unsubs.add(localResume(msg.runId, msg.lastEventId, (m) => post({ reqId: msg.reqId, ...m })));
          return;
        }
        run(msg.reqId, async () => ({ agentId: msg.agentId, runId: msg.runId }), msg.lastEventId);
        return;

      case "cancel": {
        if (isLocalId(msg.runId)) return localCancel(msg.runId);
        const settings = await getSettings();
        try {
          await api(settings, "POST", `/v1/agents/${encodeURIComponent(msg.agentId)}/runs/${encodeURIComponent(msg.runId)}/cancel`);
        } catch (e) {
          // run 已经结束（409 run_not_cancellable）就不用管
          if ((e as { code?: string }).code !== "run_not_cancellable") post({ reqId: msg.reqId, type: "error", ...friendlyError(e) });
        }
        return;
      }
    }
  });
});

// ---------- 一次性请求（设置页、浮窗按钮） ----------

async function handle(msg: RuntimeRequest): Promise<RuntimeResponse<Record<string, unknown>>> {
  try {
    if (msg.type === "openOptions") {
      if (msg.hash) await chrome.tabs.create({ url: chrome.runtime.getURL("options.html" + msg.hash) });
      else await chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    const settings = await getSettings();
    if (msg.type === "testKey") {
      const me = await api<Me>({ ...settings, apiKey: (msg.apiKey ?? settings.apiKey).trim() }, "GET", "/v1/me");
      return { ok: true, me };
    }
    if (msg.type === "testProvider") {
      const models = await listProviderModels(msg.provider, AbortSignal.timeout(15000));
      return { ok: true, count: models.length };
    }
    if (msg.type === "listModels") {
      const backend: Backend = settings.backend;
      if (msg.cached && !msg.apiKey) {
        const cache = await getModelCache(backend);
        if (cache && Date.now() - cache.ts < MODEL_CACHE_TTL) return { ok: true, models: cache.models };
      }
      let models: ModelInfo[];
      let warning = "";
      if (backend === "local") {
        if (!settings.providers.length) return { ok: false, error: { code: "no_key", status: 0, message: "还没有配置模型服务，请先在设置里添加。" } };
        const r = await listLocalModels(settings.providers);
        if (!r.models.length && r.errors.length) return { ok: false, error: { code: "list_failed", status: 0, message: r.errors.join("；") } };
        models = r.models;
        warning = r.errors.join("；");
      } else {
        const res = await api<{ items?: { id: string; displayName?: string }[] }>({ ...settings, apiKey: (msg.apiKey ?? settings.apiKey).trim() }, "GET", "/v1/models");
        models = (res?.items || []).map((m) => ({ id: m.id, displayName: m.displayName || m.id }));
      }
      const cache: ModelCache = { ts: Date.now(), models };
      await chrome.storage.local.set({ [modelCacheKey(backend)]: cache });
      return { ok: true, models, warning };
    }
    if (msg.type === "archive") {
      if (isLocalId(msg.agentId)) await localArchive(msg.agentId);
      else await api(settings, "POST", `/v1/agents/${encodeURIComponent(msg.agentId)}/archive`);
      return { ok: true };
    }
    return { ok: false, error: { code: "unknown", status: 0, message: "unknown message" } };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeRequest, _sender, sendResponse) => {
  handle(msg).then(sendResponse);
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateLegacy().catch(() => {});
  if (details.reason === "install") {
    const { apiKey, providers } = await chrome.storage.local.get(["apiKey", "providers"]);
    if (!apiKey && !(Array.isArray(providers) && providers.length)) chrome.runtime.openOptionsPage();
  }
});
