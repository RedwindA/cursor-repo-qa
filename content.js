// Cursor 仓库问答 —— GitHub 页面上的浮窗
(() => {
  if (window.__cursorRepoQA) return;
  window.__cursorRepoQA = true;

  const PORT_NAME = "cursor-repo-qa";
  const MAX_MESSAGES = 60;
  const RESERVED = new Set([
    "about", "account", "apps", "codespaces", "collections", "contact", "copilot", "customer-stories",
    "dashboard", "enterprise", "events", "explore", "features", "github-copilot", "issues", "login",
    "logout", "marketplace", "models", "new", "notifications", "orgs", "organizations", "pricing",
    "pulls", "readme", "resources", "search", "security", "sessions", "settings", "signup", "site",
    "solutions", "sponsors", "stars", "team", "topics", "trending", "users", "watching",
  ]);

  // ---------- 工具函数 ----------

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  };
  const ICON = {
    chat: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>',
    gear: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
    send: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.343 1.343 0 0 1-1.85-1.463L.99 8Zm.603-5.288L2.38 7.25h4.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.538L13.929 8Z"/></svg>',
    stop: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>',
    copy: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>',
    external: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/></svg>',
  };

  const fmtDuration = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));

  // Markdown：marked 解析 + DOMPurify 清洗，链接统一新标签打开
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  const renderMarkdown = (text) =>
    DOMPurify.sanitize(marked.parse(text || "", { gfm: true, breaks: false }), { ADD_ATTR: ["target"] });

  const extAlive = () => {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  };

  // ---------- 识别当前仓库 ----------

  function detectRepo() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, rawName] = parts;
    if (RESERVED.has(owner.toLowerCase())) return null;
    const name = rawName.replace(/\.git$/, "");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;

    const nwo = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')?.content;
    if (nwo && nwo.toLowerCase() !== `${owner}/${name}`.toLowerCase()) return null;
    const pub = document.querySelector('meta[name="octolytics-dimension-repository_public"]')?.content;
    return {
      owner, name,
      key: `${owner}/${name}`.toLowerCase(),
      isPrivate: pub === "false",
      subPath: parts.slice(2).join("/"),
    };
  }

  // ---------- 会话存储（每个仓库一份） ----------

  const convCache = new Map();
  const saveTimers = new Map();

  const storageKey = (repoKey) => `conv:${repoKey}`;
  const emptyConv = () => ({ agentId: null, agentUrl: "", messages: [], pending: null });

  async function loadConv(repoKey) {
    if (convCache.has(repoKey)) return convCache.get(repoKey);
    const k = storageKey(repoKey);
    let conv = emptyConv();
    try {
      const got = await chrome.storage.local.get(k);
      if (got[k]) conv = { ...emptyConv(), ...got[k] };
    } catch (_) { /* 扩展上下文失效 */ }
    convCache.set(repoKey, conv);
    return conv;
  }

  function saveConv(repoKey, immediate) {
    clearTimeout(saveTimers.get(repoKey));
    const doSave = () => {
      const conv = convCache.get(repoKey);
      if (!conv || !extAlive()) return;
      chrome.storage.local.set({ [storageKey(repoKey)]: conv }).catch(() => {});
    };
    if (immediate) doSave();
    else saveTimers.set(repoKey, setTimeout(doSave, 400));
  }

  // ---------- 与后台的连接 ----------

  let port = null;
  let reqSeq = Date.now();
  const active = new Map(); // reqId -> { repoKey, msgIndex, agentId, runId, lastEventId, afterTool, cancelRequested }

  function ensurePort() {
    if (port) return port;
    if (!extAlive()) throw new Error("ext_invalidated");
    port = chrome.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      if (!active.size) return;
      // service worker 被回收或重启：重新连上，从断点继续读
      setTimeout(() => {
        if (!extAlive()) {
          for (const [reqId, a] of active) failRun(reqId, a, "扩展已更新或重新加载，请刷新页面。");
          return;
        }
        for (const [reqId, a] of active) {
          if (a.runId) post({ type: "resume", reqId, agentId: a.agentId, runId: a.runId, lastEventId: a.lastEventId });
        }
      }, 600);
    });
    return port;
  }

  function post(msg) {
    try {
      ensurePort().postMessage(msg);
      return true;
    } catch (_) {
      return false;
    }
  }

  setInterval(() => { if (active.size && port) post({ type: "ping" }); }, 20000);

  function currentMsg(a) {
    const conv = convCache.get(a.repoKey);
    return conv ? conv.messages[a.msgIndex] : null;
  }

  function onPortMessage(msg) {
    const a = active.get(msg.reqId);
    if (!a) return;
    const conv = convCache.get(a.repoKey);
    const m = currentMsg(a);
    if (!conv || !m) { active.delete(msg.reqId); return; }

    switch (msg.type) {
      case "started":
        a.agentId = msg.agentId;
        a.runId = msg.runId;
        conv.agentId = msg.agentId;
        if (msg.agentUrl) conv.agentUrl = msg.agentUrl;
        m.agentUrl = conv.agentUrl || "";
        if (msg.recreated) m.note = "之前的会话已失效，已开启新会话（带上了最近的对话）。";
        conv.pending = { agentId: msg.agentId, runId: msg.runId, msgIndex: a.msgIndex };
        saveConv(a.repoKey, true);
        if (a.cancelRequested) post({ type: "cancel", reqId: msg.reqId, agentId: a.agentId, runId: a.runId });
        break;

      case "event": {
        if (msg.id) a.lastEventId = msg.id;
        const d = msg.data || {};
        if (msg.event === "status") m.runStatus = d.status;
        else if (msg.event === "assistant" && typeof d.text === "string") {
          if (a.afterTool && m.text && !/\n\s*$/.test(m.text)) m.text += "\n\n";
          a.afterTool = false;
          m.text += d.text;
        } else if (msg.event === "tool_call") {
          a.afterTool = true;
          m.activity = m.activity || [];
          const existing = m.activity.find((x) => x.callId === d.callId);
          const item = { callId: d.callId, name: d.name || "tool", detail: toolDetail(d.args), status: d.status };
          if (existing) Object.assign(existing, item, { detail: item.detail || existing.detail });
          else m.activity.push(item);
        }
        saveConv(a.repoKey);
        break;
      }

      case "reset":
        m.text = "";
        m.activity = [];
        a.lastEventId = null;
        break;

      case "done": {
        const map = { FINISHED: "finished", ERROR: "error", CANCELLED: "cancelled", EXPIRED: "expired" };
        m.status = map[msg.status] || "finished";
        if (msg.text) m.text = msg.text;
        if (m.status === "error" && !m.error) m.error = "Agent 运行出错。";
        if (m.status === "expired") m.error = "这次运行已过期。";
        m.totalTokens = msg.totalTokens ?? null;
        m.durationMs = msg.durationMs ?? (Date.now() - m.ts);
        conv.pending = null;
        active.delete(msg.reqId);
        saveConv(a.repoKey, true);
        break;
      }

      case "error":
        failRun(msg.reqId, a, msg.message, msg.code);
        return;
    }
    if (a.repoKey === currentRepo?.key) {
      updateMessage(a.msgIndex);
      refreshComposer();
    }
    refreshFab();
  }

  function failRun(reqId, a, message, code) {
    const conv = convCache.get(a.repoKey);
    const m = currentMsg(a);
    if (m) {
      m.status = "error";
      m.error = message;
      m.errorCode = code || "";
      m.durationMs = Date.now() - m.ts;
    }
    if (conv) conv.pending = null;
    active.delete(reqId);
    saveConv(a.repoKey, true);
    if (a.repoKey === currentRepo?.key) {
      updateMessage(a.msgIndex);
      refreshComposer();
    }
    refreshFab();
  }

  function toolDetail(args) {
    if (!args || typeof args !== "object") return "";
    for (const k of ["command", "path", "target_file", "targetFile", "file_path", "filePath", "pattern", "query", "glob_pattern", "globPattern", "url", "directory", "relative_workspace_path"]) {
      if (typeof args[k] === "string" && args[k]) return args[k];
    }
    return "";
  }

  const TOOL_LABEL = {
    read_file: "读取", read: "读取", run_terminal_cmd: "命令", shell: "命令", grep: "搜索", grep_search: "搜索",
    codebase_search: "语义搜索", semantic_search: "语义搜索", list_dir: "目录", ls: "目录", glob: "查找文件",
    file_search: "查找文件", glob_file_search: "查找文件", web_search: "网络搜索", web_fetch: "抓取网页",
  };

  function runningRequestFor(repoKey) {
    for (const [reqId, a] of active) if (a.repoKey === repoKey) return [reqId, a];
    return null;
  }

  // ---------- 提问 / 停止 / 新对话 ----------

  async function ask(question) {
    question = question.trim();
    if (!question || !currentRepo) return;
    const repo = currentRepo;
    if (runningRequestFor(repo.key)) return;
    const conv = await loadConv(repo.key);

    if (conv.messages.length > MAX_MESSAGES) conv.messages = conv.messages.slice(-MAX_MESSAGES);
    const history = conv.messages
      .filter((x) => x.text)
      .slice(-6)
      .map((x) => ({ role: x.role, text: x.text.length > 1500 ? x.text.slice(0, 1500) + "…" : x.text }));

    conv.messages.push({ role: "user", text: question, ts: Date.now() });
    conv.messages.push({ role: "assistant", text: "", status: "running", activity: [], ts: Date.now() });
    const msgIndex = conv.messages.length - 1;
    const reqId = ++reqSeq;
    active.set(reqId, { repoKey: repo.key, msgIndex, agentId: null, runId: null, lastEventId: null, afterTool: false });
    saveConv(repo.key, true);
    renderMessages();
    refreshComposer();
    refreshFab();

    const ok = post({
      type: "ask", reqId,
      repo: { owner: repo.owner, name: repo.name },
      question,
      pageUrl: location.href,
      agentId: conv.agentId,
      history,
    });
    if (!ok) failRun(reqId, active.get(reqId), "扩展已更新或重新加载，请刷新页面。");
  }

  function stop() {
    const r = currentRepo && runningRequestFor(currentRepo.key);
    if (!r) return;
    const [reqId, a] = r;
    if (a.runId) post({ type: "cancel", reqId, agentId: a.agentId, runId: a.runId });
    else a.cancelRequested = true;
    const m = currentMsg(a);
    if (m) { m.stopping = true; updateMessage(a.msgIndex); }
  }

  async function newConversation() {
    if (!currentRepo || runningRequestFor(currentRepo.key)) return;
    const conv = await loadConv(currentRepo.key);
    if (conv.agentId && extAlive()) {
      chrome.runtime.sendMessage({ type: "archive", agentId: conv.agentId }).catch(() => {});
    }
    convCache.set(currentRepo.key, emptyConv());
    saveConv(currentRepo.key, true);
    renderAll();
    ui.input.focus();
  }

  // 页面刷新/重开后，接着跟进还没结束的那次运行
  function resumePending(repoKey, conv) {
    const p = conv.pending;
    if (!p || runningRequestFor(repoKey)) return;
    const m = conv.messages[p.msgIndex];
    if (!m || m.role !== "assistant") { conv.pending = null; saveConv(repoKey, true); return; }
    m.text = "";
    m.activity = [];
    m.status = "running";
    const reqId = ++reqSeq;
    active.set(reqId, { repoKey, msgIndex: p.msgIndex, agentId: p.agentId, runId: p.runId, lastEventId: null, afterTool: false });
    post({ type: "resume", reqId, agentId: p.agentId, runId: p.runId, lastEventId: null });
  }

  // ---------- 界面 ----------

  const host = document.createElement("div");
  host.id = "cursor-repo-qa-root";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483000; inset: auto 0 0 auto;";
  const shadow = host.attachShadow({ mode: "open" });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("panel.css");
  shadow.appendChild(link);

  const ui = {};
  const wrap = el("div", "wrap");
  wrap.hidden = true;
  shadow.appendChild(wrap);

  // 悬浮按钮
  ui.fab = el("button", "fab");
  ui.fab.type = "button";
  ui.fab.title = "问问这个仓库（Cursor Cloud Agent）";
  ui.fab.append(svg(ICON.chat), el("span", "fab-dot"));
  ui.fab.addEventListener("click", () => togglePanel());
  wrap.appendChild(ui.fab);

  // 面板
  ui.panel = el("section", "panel");
  ui.panel.hidden = true;
  ui.panel.setAttribute("role", "dialog");
  ui.panel.setAttribute("aria-label", "Cursor 仓库问答");

  ui.resize = el("div", "resize");
  ui.resize.title = "拖动调整大小";
  ui.panel.appendChild(ui.resize);

  const header = el("header", "head");
  const titleBox = el("div", "title");
  ui.title = el("div", "repo");
  ui.subtitle = el("div", "sub");
  titleBox.append(ui.title, ui.subtitle);
  const actions = el("div", "actions");
  ui.btnNew = iconButton(ICON.plus, "新对话", newConversation);
  ui.btnSettings = iconButton(ICON.gear, "设置", openOptions);
  ui.btnClose = iconButton(ICON.close, "关闭", () => togglePanel(false));
  actions.append(ui.btnNew, ui.btnSettings, ui.btnClose);
  header.append(titleBox, actions);
  ui.panel.appendChild(header);

  ui.notice = el("div", "notice");
  ui.notice.hidden = true;
  ui.panel.appendChild(ui.notice);

  ui.list = el("div", "list");
  ui.panel.appendChild(ui.list);

  const composer = el("form", "composer");
  ui.input = el("textarea", "input");
  ui.input.rows = 1;
  ui.input.placeholder = "问点关于这个仓库的问题…";
  ui.send = el("button", "send");
  ui.send.type = "submit";
  composer.append(ui.input, ui.send);
  ui.hint = el("div", "hint", "Enter 发送 · Shift+Enter 换行 · 在 Cursor 云端运行，消耗你的额度");
  ui.panel.append(composer, ui.hint);
  wrap.appendChild(ui.panel);

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (currentRepo && runningRequestFor(currentRepo.key)) { stop(); return; }
    const q = ui.input.value;
    if (!q.trim()) return;
    ui.input.value = "";
    autoGrow();
    ask(q);
  });
  ui.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      composer.requestSubmit();
    } else if (e.key === "Escape") {
      togglePanel(false);
    }
    e.stopPropagation(); // 不触发 GitHub 的快捷键
  });
  ui.input.addEventListener("keyup", (e) => e.stopPropagation());
  ui.input.addEventListener("keypress", (e) => e.stopPropagation());
  ui.input.addEventListener("input", autoGrow);
  function autoGrow() {
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight, 160) + "px";
  }

  function iconButton(icon, label, onClick) {
    const b = el("button", "icon-btn");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(svg(icon));
    b.addEventListener("click", onClick);
    return b;
  }

  function openOptions() {
    if (extAlive()) chrome.runtime.sendMessage({ type: "openOptions" }).catch(() => {});
  }

  // 面板大小（左上角拖动）
  (async () => {
    try {
      const { panelSize } = await chrome.storage.local.get("panelSize");
      if (panelSize) applySize(panelSize.w, panelSize.h);
    } catch (_) { /* ignore */ }
  })();
  function applySize(w, h) {
    const maxW = window.innerWidth - 32, maxH = window.innerHeight - 100;
    ui.panel.style.width = Math.max(340, Math.min(w, maxW)) + "px";
    ui.panel.style.height = Math.max(380, Math.min(h, maxH)) + "px";
  }
  ui.resize.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const r = ui.panel.getBoundingClientRect();
    ui.resize.setPointerCapture(e.pointerId);
    const move = (ev) => applySize(r.width + (startX - ev.clientX), r.height + (startY - ev.clientY));
    const up = () => {
      ui.resize.removeEventListener("pointermove", move);
      ui.resize.removeEventListener("pointerup", up);
      const nr = ui.panel.getBoundingClientRect();
      if (extAlive()) chrome.storage.local.set({ panelSize: { w: nr.width, h: nr.height } }).catch(() => {});
    };
    ui.resize.addEventListener("pointermove", move);
    ui.resize.addEventListener("pointerup", up);
  });

  // 主题：跟随 GitHub
  function applyTheme() {
    const root = document.documentElement;
    const mode = root.getAttribute("data-color-mode");
    let dark;
    if (mode === "dark") dark = true;
    else if (mode === "light") dark = false;
    else dark = matchMedia("(prefers-color-scheme: dark)").matches;
    if (mode === "auto") {
      const theme = dark ? root.getAttribute("data-dark-theme") : root.getAttribute("data-light-theme");
      if (theme) dark = theme.startsWith("dark");
    }
    wrap.dataset.theme = dark ? "dark" : "light";
  }
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode", "data-dark-theme", "data-light-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  applyTheme();

  let panelOpen = sessionStorage.getItem("cursorRepoQA.open") === "1";

  function togglePanel(force) {
    panelOpen = force ?? !panelOpen;
    sessionStorage.setItem("cursorRepoQA.open", panelOpen ? "1" : "0");
    ui.panel.hidden = !panelOpen;
    ui.fab.classList.toggle("open", panelOpen);
    if (panelOpen) {
      renderAll();
      setTimeout(() => ui.input.focus(), 0);
    }
  }

  function refreshFab() {
    wrap.hidden = !currentRepo;
    ui.fab.classList.toggle("busy", active.size > 0);
  }

  function refreshComposer() {
    const running = currentRepo && runningRequestFor(currentRepo.key);
    ui.send.replaceChildren(svg(running ? ICON.stop : ICON.send));
    ui.send.title = running ? "停止" : "发送";
    ui.send.classList.toggle("stop", !!running);
    ui.input.disabled = !!running;
    ui.btnNew.disabled = !!running;
    if (currentRepo) ui.input.placeholder = running ? "等这次回答结束后再追问…" : `问点关于 ${currentRepo.owner}/${currentRepo.name} 的问题…`;
  }

  async function renderAll() {
    if (!currentRepo) return;
    const repo = currentRepo;
    ui.title.textContent = `${repo.owner}/${repo.name}`;
    ui.title.title = ui.title.textContent;
    const conv = await loadConv(repo.key);
    if (repo !== currentRepo) return;

    ui.subtitle.replaceChildren();
    if (conv.agentUrl) {
      const a = el("a", "", "在 Cursor 中打开会话 ");
      a.href = conv.agentUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.appendChild(svg(ICON.external));
      ui.subtitle.appendChild(a);
    } else {
      ui.subtitle.textContent = "Cursor Cloud Agent 只读问答";
    }

    let notice = "";
    try {
      const { apiKey } = await chrome.storage.local.get("apiKey");
      if (!apiKey) notice = "nokey";
    } catch (_) { notice = "invalid"; }
    if (!notice && repo.isPrivate) notice = "private";
    renderNotice(notice);
    renderMessages();
    refreshComposer();
  }

  function renderNotice(kind) {
    ui.notice.hidden = !kind;
    ui.notice.className = "notice " + (kind || "");
    ui.notice.replaceChildren();
    if (kind === "nokey") {
      ui.notice.append(el("span", "", "还没有设置 Cursor API key。"));
      const b = el("button", "link-btn", "去设置");
      b.type = "button";
      b.addEventListener("click", openOptions);
      ui.notice.appendChild(b);
    } else if (kind === "private") {
      ui.notice.textContent = "这是私有仓库：Cloud Agent 只能匿名克隆公开仓库，回答很可能会失败。";
    } else if (kind === "invalid") {
      ui.notice.textContent = "扩展已更新或重新加载，请刷新页面。";
    }
  }

  function renderMessages() {
    const conv = currentRepo && convCache.get(currentRepo.key);
    ui.list.replaceChildren();
    if (!conv || !conv.messages.length) {
      ui.list.appendChild(renderEmpty());
      return;
    }
    conv.messages.forEach((m, i) => ui.list.appendChild(renderMessage(m, i)));
    scrollToBottom();
  }

  function renderEmpty() {
    const box = el("div", "empty");
    box.appendChild(el("div", "empty-title", "问问这个仓库"));
    box.appendChild(el("div", "empty-sub", "Cursor 会在云端克隆仓库、阅读代码后回答。第一次提问需要启动环境，通常要等几十秒。"));
    const chips = el("div", "chips");
    const sugg = ["这个仓库是做什么的？", "项目的整体结构和核心模块是怎样的？", "怎么在本地跑起来？"];
    const sub = currentRepo?.subPath || "";
    if (/^blob\//.test(sub)) sugg.unshift("解释一下我正在看的这个文件");
    else if (/^tree\/[^/]+\/.+/.test(sub)) sugg.unshift("这个目录里的代码负责什么？");
    else if (/^(pull|issues)\/\d+/.test(sub)) sugg.unshift("结合代码，解释一下当前页面讨论的问题");
    for (const s of sugg) {
      const c = el("button", "chip", s);
      c.type = "button";
      c.addEventListener("click", () => ask(s));
      chips.appendChild(c);
    }
    box.appendChild(chips);
    return box;
  }

  function renderMessage(m, i) {
    const node = el("div", `msg ${m.role}`);
    node.dataset.index = i;
    if (m.role === "user") {
      node.appendChild(el("div", "bubble", m.text));
      return node;
    }
    fillAssistant(node, m);
    return node;
  }

  function fillAssistant(node, m) {
    const wasOpen = node.querySelector("details.activity")?.open ?? false;
    node.replaceChildren();
    const running = m.status === "running";
    node.classList.toggle("running", running);

    if (m.note) node.appendChild(el("div", "note", m.note));

    if (running) {
      const st = el("div", "status");
      st.append(el("span", "spinner"), el("span", "status-text", statusText(m)));
      node.appendChild(st);
    }

    if (m.activity?.length) {
      const det = el("details", "activity");
      det.open = wasOpen;
      const sum = el("summary", "", `执行了 ${m.activity.length} 步操作`);
      det.appendChild(sum);
      const ol = el("ol");
      for (const t of m.activity.slice(-80)) {
        const li = el("li", t.status === "running" ? "pending" : "");
        li.append(el("span", "tool", TOOL_LABEL[t.name] || t.name));
        if (t.detail) li.append(el("code", "", t.detail.length > 120 ? t.detail.slice(0, 120) + "…" : t.detail));
        ol.appendChild(li);
      }
      det.appendChild(ol);
      node.appendChild(det);
    }

    if (m.text) {
      const md = el("div", "md");
      md.innerHTML = renderMarkdown(m.text);
      node.appendChild(md);
    }

    if (m.status === "error" || m.status === "expired") {
      const err = el("div", "error", m.error || "出错了。");
      if (m.errorCode === "no_key" || /API key/.test(m.error || "")) {
        const b = el("button", "link-btn", "打开设置");
        b.type = "button";
        b.addEventListener("click", openOptions);
        err.appendChild(b);
      }
      node.appendChild(err);
    }
    if (m.status === "cancelled") node.appendChild(el("div", "muted", "已停止。"));

    if (!running && (m.text || m.status === "finished")) {
      const foot = el("div", "foot");
      const bits = [];
      if (m.durationMs) bits.push(`用时 ${fmtDuration(m.durationMs)}`);
      if (m.totalTokens) bits.push(`${fmtTokens(m.totalTokens)} tokens`);
      if (bits.length) foot.appendChild(el("span", "", bits.join(" · ")));
      if (m.text) {
        const c = el("button", "foot-btn");
        c.type = "button";
        c.append(svg(ICON.copy), document.createTextNode(" 复制"));
        c.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(m.text);
            c.lastChild.textContent = " 已复制";
            setTimeout(() => (c.lastChild.textContent = " 复制"), 1500);
          } catch (_) { /* ignore */ }
        });
        foot.appendChild(c);
      }
      if (m.agentUrl) {
        const a = el("a", "foot-btn", "在 Cursor 中查看 ");
        a.href = m.agentUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.appendChild(svg(ICON.external));
        foot.appendChild(a);
      }
      if (foot.childNodes.length) node.appendChild(foot);
    }
  }

  function statusText(m) {
    const elapsed = fmtDuration(Date.now() - m.ts);
    if (m.stopping) return `正在停止… ${elapsed}`;
    const steps = m.activity?.length || 0;
    if (!m.runStatus || m.runStatus === "CREATING") return `正在启动云端环境… ${elapsed}`;
    if (steps) return `正在阅读代码（${steps} 步）… ${elapsed}`;
    return `Agent 正在工作… ${elapsed}`;
  }

  let rafPending = new Set();
  function updateMessage(i) {
    rafPending.add(i);
    if (rafPending.size > 1) return;
    requestAnimationFrame(() => {
      const conv = currentRepo && convCache.get(currentRepo.key);
      const idxs = [...rafPending];
      rafPending = new Set();
      if (!conv) return;
      const nearBottom = ui.list.scrollHeight - ui.list.scrollTop - ui.list.clientHeight < 80;
      for (const idx of idxs) {
        const m = conv.messages[idx];
        const node = ui.list.querySelector(`.msg[data-index="${idx}"]`);
        if (!m) continue;
        if (!node) { renderMessages(); return; }
        if (m.role === "assistant") fillAssistant(node, m);
      }
      if (nearBottom) scrollToBottom();
    });
  }

  function scrollToBottom() {
    ui.list.scrollTop = ui.list.scrollHeight;
  }

  // 运行中的计时
  setInterval(() => {
    if (!currentRepo || ui.panel.hidden) return;
    const r = runningRequestFor(currentRepo.key);
    if (!r) return;
    const node = ui.list.querySelector(`.msg[data-index="${r[1].msgIndex}"] .status-text`);
    const m = currentMsg(r[1]);
    if (node && m) node.textContent = statusText(m);
  }, 1000);

  // ---------- 页面切换（GitHub 是单页应用） ----------

  let currentRepo = null;
  let lastHref = "";

  async function onLocationChange() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const repo = detectRepo();
    const changed = (repo?.key || null) !== (currentRepo?.key || null);
    currentRepo = repo;
    if (!host.isConnected) document.documentElement.appendChild(host);
    refreshFab();
    if (!repo) return;
    const conv = await loadConv(repo.key);
    resumePending(repo.key, conv);
    if (changed || panelOpen) {
      ui.panel.hidden = !panelOpen;
      ui.fab.classList.toggle("open", panelOpen);
      if (panelOpen) renderAll();
    }
    refreshComposer();
  }

  document.addEventListener("turbo:load", onLocationChange);
  document.addEventListener("turbo:render", onLocationChange);
  document.addEventListener("pjax:end", onLocationChange);
  window.addEventListener("popstate", onLocationChange);
  setInterval(onLocationChange, 1000);

  // 其它标签页更新了同一个仓库的会话时同步过来
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.apiKey && currentRepo && panelOpen) renderAll();
    for (const [k, ch] of Object.entries(changes)) {
      if (!k.startsWith("conv:")) continue;
      const repoKey = k.slice(5);
      if (runningRequestFor(repoKey)) continue;
      convCache.set(repoKey, ch.newValue ? { ...emptyConv(), ...ch.newValue } : emptyConv());
      if (repoKey === currentRepo?.key && panelOpen) renderMessages();
    }
  });

  document.documentElement.appendChild(host);
  onLocationChange();
})();
