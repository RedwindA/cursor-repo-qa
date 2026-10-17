// Cursor 仓库问答 —— 后台 service worker
// 负责：调用 Cursor Cloud Agents API、读取 SSE 流并转发给页面里的浮窗。
// API key 只在这里使用，不会进入 GitHub 页面。

const DEFAULT_API_BASE = "https://api.cursor.com";
const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

// ---------- 设置 ----------

async function getSettings() {
  const s = await chrome.storage.local.get(["apiKey", "model", "language", "apiBase"]);
  return {
    apiKey: (s.apiKey || "").trim(),
    model: s.model || "",
    language: s.language || "zh",
    apiBase: (s.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

// ---------- HTTP ----------

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code || "";
  }
}

function authHeader(apiKey) {
  // Basic 认证：用户名是 key，密码为空
  return "Basic " + btoa(unescape(encodeURIComponent(apiKey + ":")));
}

async function api(settings, method, path, body, { signal, headers } = {}) {
  if (!settings.apiKey) throw new ApiError(0, "no_key", "还没有设置 Cursor API key");
  let res;
  try {
    res = await fetch(settings.apiBase + path, {
      method,
      signal,
      headers: {
        Authorization: authHeader(settings.apiKey),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "无法连接 Cursor API：" + e.message);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function toApiError(res) {
  let code = "", message = "";
  try {
    const j = await res.json();
    const err = j.error || j;
    code = err.code || "";
    message = err.message || j.message || "";
  } catch (_) { /* 非 JSON 响应 */ }
  return new ApiError(res.status, code, message || `HTTP ${res.status}`);
}

function friendlyError(e) {
  const code = e.code || "";
  const status = e.status || 0;
  let message = e.message || String(e);
  if (code === "no_key") message = "还没有设置 Cursor API key，请先打开设置填写。";
  else if (status === 401) message = "API key 无效或已过期，请到设置里检查。";
  else if (code === "feature_unavailable") message = "你的账号没有开通无仓库 Cloud Agent（feature_unavailable）。";
  else if (code === "agent_busy") message = "上一个问题还在处理中，请等它结束或先停止。";
  else if (status === 429) message = "请求太频繁或额度用完了（429），稍后再试。";
  else if (status >= 500) message = `Cursor 服务暂时出错（${status}）：${message}`;
  return { code: code || (status ? `http_${status}` : "error"), status, message };
}

// ---------- 提示词 ----------

function languageInstruction(lang) {
  if (lang === "en") return "answer in English";
  if (lang === "auto") return "使用与用户提问相同的语言回答";
  return "使用简体中文回答";
}

function repoDir(repo) {
  return `~/repo-src/${repo.owner}__${repo.name}`;
}

function firstPrompt(repo, question, pageUrl, lang, history) {
  const cloneUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
  const lines = [
    `你是一个只读的代码问答助手。用户正在 GitHub 上浏览仓库 ${repo.owner}/${repo.name}，想了解它的代码。`,
    ``,
    `准备工作：`,
    `- 如果环境里还没有这个仓库，运行：git clone --depth 1 ${cloneUrl} ${repoDir(repo)}`,
    `- 克隆失败（比如仓库是私有的、地址无效）时，直接告诉用户原因，不要编造答案。`,
    `- 用 git -C ${repoDir(repo)} rev-parse HEAD 取得 commit SHA，引用代码时使用。`,
    ``,
    `规则：`,
    `- 只读：不要修改、创建或删除仓库里的文件，不要 commit、push，不要建分支或 PR。`,
    `- 以实际读到的代码为依据回答，不确定就说明不确定。`,
    `- 引用代码位置时给出 GitHub 链接，格式：https://github.com/${repo.owner}/${repo.name}/blob/<commit SHA>/<路径>#L<起始行>-L<结束行>`,
    `- 用 Markdown 回答，${languageInstruction(lang)}。直接给结论，不用复述你执行了哪些命令。`,
    ``,
    `用户当前所在页面：${pageUrl}`,
    `（如果页面指向某个分支、文件或目录，优先结合它回答；如果是非默认分支，可以 git fetch --depth 1 origin <分支> 后再看。）`,
  ];
  if (history && history.length) {
    lines.push(``, `之前的对话（供参考，可能已截断）：`);
    for (const h of history) {
      lines.push(`${h.role === "user" ? "用户" : "助手"}：${h.text}`);
    }
  }
  lines.push(``, `用户的问题：`, question);
  return lines.join("\n");
}

function followUpPrompt(repo, question, pageUrl, lang) {
  return [
    `（这是对仓库 ${repo.owner}/${repo.name} 的追问。仓库应已克隆在 ${repoDir(repo)}，如果不存在就按之前的方式重新克隆。规则不变：只读，引用代码给 GitHub 链接，${languageInstruction(lang)}。）`,
    `用户当前所在页面：${pageUrl}`,
    ``,
    `用户的问题：`,
    question,
  ].join("\n");
}

// ---------- 创建 agent / run ----------

async function createAgent(settings, repo, question, pageUrl, history) {
  const body = {
    prompt: { text: firstPrompt(repo, question, pageUrl, settings.language, history) },
    name: `问答：${repo.owner}/${repo.name}`.slice(0, 100),
    autoCreatePR: false,
  };
  if (settings.model) body.model = { id: settings.model };
  // 不传 repos 和 env：无仓库 agent，由 agent 自己 git clone 公开仓库
  const res = await api(settings, "POST", "/v1/agents", body);
  return { agentId: res.agent.id, agentUrl: res.agent.url || "", runId: res.run.id, isNewAgent: true };
}

async function createRun(settings, agentId, repo, question, pageUrl) {
  const res = await api(settings, "POST", `/v1/agents/${encodeURIComponent(agentId)}/runs`, {
    prompt: { text: followUpPrompt(repo, question, pageUrl, settings.language) },
  });
  return { agentId, runId: res.run.id, isNewAgent: false };
}

// ---------- SSE 流 ----------

function parseSSEBlock(block) {
  let event = "message", id = null;
  const data = [];
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
  let parsed = null;
  const text = data.join("\n");
  try { parsed = text ? JSON.parse(text) : {}; } catch (_) { parsed = { raw: text }; }
  return { event, id, data: parsed };
}

// 读取一次流，返回 "result" | "ended" | "gone"
async function readStreamOnce(settings, task, send) {
  const { agentId, runId } = task;
  const headers = { Accept: "text/event-stream" };
  if (task.lastEventId) headers["Last-Event-ID"] = task.lastEventId;
  let res;
  try {
    res = await fetch(`${settings.apiBase}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`, {
      headers: { Authorization: authHeader(settings.apiKey), ...headers },
      signal: task.controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return "ended";
  }
  if (res.status === 410) return "gone";
  if (res.status === 400 && task.lastEventId) {
    // Last-Event-ID 无效：从头再读
    task.lastEventId = null;
    send({ type: "reset" });
    return "ended";
  }
  if (!res.ok) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      // 连接中途断开（网络抖动、服务端关闭）：交给上层带 Last-Event-ID 重连
      if (task.controller.signal.aborted) throw new DOMException("aborted", "AbortError");
      return "ended";
    }
    const { value, done } = chunk;
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = buf.match(/\r?\n\r?\n/))) {
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const ev = parseSSEBlock(block);
      if (!ev) continue;
      if (ev.id) task.lastEventId = ev.id;
      if (ev.event === "heartbeat" || ev.event === "interaction_update" || ev.event === "thinking") continue;
      if (ev.event === "result") {
        task.result = ev.data;
        return "result";
      }
      if (ev.event === "error") {
        throw new ApiError(0, ev.data.code || "stream_error", ev.data.message || "流式输出出错");
      }
      if (ev.event === "done") return task.result ? "result" : "ended";
      send({ type: "event", event: ev.event, data: ev.data, id: task.lastEventId });
    }
  }
  return "ended";
}

async function pollRun(settings, task) {
  const { agentId, runId } = task;
  for (;;) {
    const run = await api(settings, "GET", `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`, null, { signal: task.controller.signal });
    if (TERMINAL.has(run.status)) {
      return { status: run.status, text: run.result || "", git: run.git, durationMs: run.durationMs };
    }
    await sleep(3000, task.controller.signal);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
  });
}

async function followRun(settings, task, send) {
  let final = null;
  let attempts = 0;
  while (!final) {
    const outcome = await readStreamOnce(settings, task, send);
    if (outcome === "result") {
      const r = task.result || {};
      final = { status: r.status || "FINISHED", text: r.text || "", git: r.git, durationMs: r.durationMs };
    } else if (outcome === "gone" || ++attempts > 5) {
      final = await pollRun(settings, task);
    } else {
      // 流意外中断：带 Last-Event-ID 重连
      await sleep(1000 * attempts, task.controller.signal);
    }
  }
  // 补一个 token 用量（失败就算了）
  try {
    const u = await api(settings, "GET", `/v1/agents/${encodeURIComponent(task.agentId)}/usage?runId=${encodeURIComponent(task.runId)}`, null, { signal: task.controller.signal });
    final.totalTokens = u?.totalUsage?.totalTokens ?? null;
  } catch (_) { /* 忽略 */ }
  send({ type: "done", ...final });
}

// ---------- 与浮窗的连接 ----------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "cursor-repo-qa") return;
  const tasks = new Map(); // runId -> task
  let alive = true;
  port.onDisconnect.addListener(() => {
    alive = false;
    for (const t of tasks.values()) t.controller.abort();
    tasks.clear();
  });

  const post = (msg) => { if (alive) { try { port.postMessage(msg); } catch (_) { /* 已断开 */ } } };

  async function run(reqId, starter, lastEventId) {
    const settings = await getSettings();
    const controller = new AbortController();
    let task = null;
    const send = (m) => post({ reqId, ...m });
    try {
      const started = await starter(settings, controller.signal);
      task = { ...started, controller, lastEventId: lastEventId || null, result: null };
      tasks.set(task.runId, task);
      send({ type: "started", agentId: task.agentId, runId: task.runId, agentUrl: started.agentUrl || "", isNewAgent: !!started.isNewAgent, recreated: !!started.recreated });
      await followRun(settings, task, send);
    } catch (e) {
      if (e.name === "AbortError") return;
      send({ type: "error", ...friendlyError(e) });
    } finally {
      if (task) tasks.delete(task.runId);
    }
  }

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "ping") return;

    if (msg.type === "ask") {
      const { reqId, repo, question, pageUrl, agentId, history } = msg;
      run(reqId, async (settings) => {
        if (agentId) {
          try {
            return await createRun(settings, agentId, repo, question, pageUrl);
          } catch (e) {
            // 旧对话已归档/过期/不存在：开新 agent，并把最近的对话带上
            const gone = e.status === 404 || e.status === 410 || (e.status === 409 && e.code !== "agent_busy");
            if (!gone) throw e;
            const r = await createAgent(settings, repo, question, pageUrl, history);
            return { ...r, recreated: true };
          }
        }
        return createAgent(settings, repo, question, pageUrl, null);
      });
      return;
    }

    if (msg.type === "resume") {
      const { reqId, agentId, runId, lastEventId } = msg;
      run(reqId, async () => ({ agentId, runId }), lastEventId);
      return;
    }

    if (msg.type === "cancel") {
      const settings = await getSettings();
      try {
        await api(settings, "POST", `/v1/agents/${encodeURIComponent(msg.agentId)}/runs/${encodeURIComponent(msg.runId)}/cancel`);
      } catch (e) {
        // run 已经结束（409 run_not_cancellable）就不用管
        if (e.code !== "run_not_cancellable") post({ reqId: msg.reqId, type: "error", ...friendlyError(e) });
      }
      return;
    }
  });
});

// ---------- 一次性请求（设置页、浮窗按钮） ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "openOptions") {
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      }
      const settings = await getSettings();
      if (msg.type === "testKey") {
        const s = { ...settings, apiKey: (msg.apiKey ?? settings.apiKey).trim() };
        const me = await api(s, "GET", "/v1/me");
        return { ok: true, me };
      }
      if (msg.type === "listModels") {
        const s = { ...settings, apiKey: (msg.apiKey ?? settings.apiKey).trim() };
        const res = await api(s, "GET", "/v1/models");
        return { ok: true, models: (res.items || []).map((m) => ({ id: m.id, displayName: m.displayName || m.id })) };
      }
      if (msg.type === "archive") {
        await api(settings, "POST", `/v1/agents/${encodeURIComponent(msg.agentId)}/archive`);
        return { ok: true };
      }
      return { ok: false, error: { message: "unknown message" } };
    } catch (e) {
      return { ok: false, error: friendlyError(e) };
    }
  })().then(sendResponse);
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const { apiKey } = await chrome.storage.local.get("apiKey");
    if (!apiKey) chrome.runtime.openOptionsPage();
  }
});
