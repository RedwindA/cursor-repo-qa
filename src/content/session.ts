// 浮窗里的会话状态：每个仓库一个“当前会话”，负责提问、跟进运行、保存和多标签页同步
import { toolDetail } from "../shared/chat-view";
import {
  activeKey,
  chatKey,
  createConversation,
  getActiveId,
  getBackendModel,
  getChat,
  isActiveKey,
  isChatKey,
  listChats,
  MAX_MESSAGES,
  normalizeConversation,
  saveChat,
  setActiveId,
  titleFrom,
} from "../shared/storage";
import type { AssistantMessage, Conversation, HistoryItem, PortEvent, PortRequest, RepoRef } from "../shared/types";

const PORT_NAME = "cursor-repo-qa";

interface ActiveRun {
  repoKey: string;
  convId: string;
  msgIndex: number;
  agentId: string | null;
  runId: string | null;
  lastEventId: string | null;
  afterTool: boolean;
  cancelRequested?: boolean;
}

export interface SessionListener {
  /** 会话内容变了；msgIndex 为空表示整段重绘 */
  onChange(repoKey: string, msgIndex?: number): void;
  /** 有运行开始/结束 */
  onRunsChange(): void;
}

export const extAlive = (): boolean => {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

const RELOAD_HINT = "扩展已更新或重新加载，请刷新页面。";

export class Session {
  private convs = new Map<string, Conversation>(); // repoKey -> 当前会话
  private runs = new Map<number, ActiveRun>(); // reqId -> run
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private port: chrome.runtime.Port | null = null;
  private reqSeq = Date.now();

  constructor(private listener: SessionListener) {
    setInterval(() => {
      if (this.runs.size && this.port) this.post({ type: "ping" });
    }, 20000);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") this.onStorageChanged(changes);
      });
    } catch {
      /* 扩展上下文失效 */
    }
  }

  // ---------- 读取 ----------

  get(repoKey: string): Conversation | undefined {
    return this.convs.get(repoKey);
  }

  async load(repo: RepoRef & { key: string }): Promise<Conversation> {
    const cached = this.convs.get(repo.key);
    if (cached) return cached;
    let conv: Conversation | null = null;
    try {
      const id = await getActiveId(repo.key);
      if (id) conv = await getChat(id);
    } catch {
      /* 扩展上下文失效 */
    }
    // 并发加载时以先到的为准
    const again = this.convs.get(repo.key);
    if (again) return again;
    conv = conv || createConversation(repo);
    this.convs.set(repo.key, conv);
    return conv;
  }

  /** 这个仓库的所有历史会话（新的在前） */
  async listForRepo(repoKey: string): Promise<Conversation[]> {
    try {
      return (await listChats()).filter((c) => c.repoKey === repoKey);
    } catch {
      return [];
    }
  }

  running(repoKey: string): [number, ActiveRun] | null {
    for (const entry of this.runs) if (entry[1].repoKey === repoKey) return entry;
    return null;
  }

  /** 浮窗里切换模型前调用：给旧会话记下 agent 当时的模型，换模型后追问才会新开 agent */
  rememberAgentModel(repoKey: string, previous: string): void {
    const conv = this.convs.get(repoKey);
    if (conv?.agentId && conv.agentModel === undefined) {
      conv.agentModel = previous;
      this.save(repoKey, true);
    }
  }

  get busy(): boolean {
    return this.runs.size > 0;
  }

  // ---------- 保存 ----------

  private save(repoKey: string, immediate = false): void {
    clearTimeout(this.saveTimers.get(repoKey));
    const doSave = () => {
      const conv = this.convs.get(repoKey);
      if (!conv || !conv.messages.length || !extAlive()) return;
      saveChat(conv).catch(() => {});
      getActiveId(repoKey)
        .then((id) => (id !== conv.id ? setActiveId(repoKey, conv.id) : undefined))
        .catch(() => {});
    };
    if (immediate) doSave();
    else this.saveTimers.set(repoKey, setTimeout(doSave, 400));
  }

  // ---------- 提问 / 停止 / 切换 ----------

  async ask(repo: RepoRef & { key: string }, question: string, pageUrl: string): Promise<void> {
    question = question.trim();
    if (!question || this.running(repo.key)) return;
    const conv = await this.load(repo);
    let backend = "local";
    let model = "";
    try {
      ({ backend, model } = await getBackendModel());
    } catch {
      /* 扩展上下文失效，下面 post 会失败 */
    }
    // Cursor 的云端 agent 创建后不能换模型：和当前选择不同就新开一个 agent（带上最近的对话）。
    // 本地 agent 每次提问都可以换模型，不受这个限制。
    const cursorAgent = backend === "cursor" && !!conv.agentId && !conv.agentId.startsWith("local-");
    if (cursorAgent && conv.agentModel === undefined) conv.agentModel = model;
    const switching = cursorAgent && conv.agentModel !== model;
    if (switching && extAlive()) chrome.runtime.sendMessage({ type: "archive", agentId: conv.agentId }).catch(() => {});
    // 只保留最近的消息（成对裁剪；此时这个仓库没有进行中的运行，下标不会错位）
    if (conv.messages.length > MAX_MESSAGES - 2) conv.messages = conv.messages.slice(-(MAX_MESSAGES - 2));

    const history: HistoryItem[] = conv.messages
      .filter((x) => x.text)
      .slice(-6)
      .map((x) => ({ role: x.role, text: x.text.length > 1500 ? x.text.slice(0, 1500) + "…" : x.text }));

    const now = Date.now();
    conv.messages.push({ role: "user", text: question, ts: now, pageUrl });
    conv.messages.push({
      role: "assistant",
      text: "",
      status: "running",
      activity: [],
      ts: now,
      ...(switching ? { note: `已切换到${model ? ` ${model}` : "默认模型"}，新开了云端会话（带上了最近的对话）。` } : {}),
    });
    if (!conv.title) conv.title = titleFrom(question);
    const msgIndex = conv.messages.length - 1;
    const reqId = ++this.reqSeq;
    this.runs.set(reqId, { repoKey: repo.key, convId: conv.id, msgIndex, agentId: null, runId: null, lastEventId: null, afterTool: false });
    this.save(repo.key, true);
    this.listener.onChange(repo.key);
    this.listener.onRunsChange();

    const ok = this.post({
      type: "ask",
      reqId,
      repo: { owner: repo.owner, name: repo.name },
      question,
      pageUrl,
      agentId: switching ? null : conv.agentId,
      history,
    });
    if (!ok) this.fail(reqId, RELOAD_HINT);
  }

  stop(repoKey: string): void {
    const r = this.running(repoKey);
    if (!r) return;
    const [reqId, a] = r;
    if (a.runId && a.agentId) this.post({ type: "cancel", reqId, agentId: a.agentId, runId: a.runId });
    else a.cancelRequested = true;
    const m = this.msgOf(a);
    if (m) {
      m.stopping = true;
      this.listener.onChange(repoKey, a.msgIndex);
    }
  }

  /** 开新会话：旧会话留在本地记录里，云端 agent 归档 */
  async newChat(repo: RepoRef & { key: string }): Promise<void> {
    if (this.running(repo.key)) return;
    const old = await this.load(repo);
    if (!old.messages.length) return;
    if (old.agentId && extAlive()) chrome.runtime.sendMessage({ type: "archive", agentId: old.agentId }).catch(() => {});
    this.convs.set(repo.key, createConversation(repo));
    if (extAlive()) setActiveId(repo.key, null).catch(() => {});
    this.listener.onChange(repo.key);
  }

  /** 切换到这个仓库的某段历史会话 */
  async open(repo: RepoRef & { key: string }, id: string): Promise<void> {
    if (this.running(repo.key)) return;
    const conv = await getChat(id).catch(() => null);
    if (!conv || conv.repoKey !== repo.key) return;
    this.convs.set(repo.key, conv);
    await setActiveId(repo.key, id).catch(() => {});
    this.listener.onChange(repo.key);
    this.resumePending(repo.key);
  }

  /** 页面刷新/重开后，接着跟进还没结束的那次运行 */
  resumePending(repoKey: string): void {
    const conv = this.convs.get(repoKey);
    const p = conv?.pending;
    if (!conv || !p || this.running(repoKey)) return;
    const m = conv.messages[p.msgIndex];
    if (!m || m.role !== "assistant") {
      conv.pending = null;
      this.save(repoKey, true);
      return;
    }
    m.text = "";
    m.activity = [];
    m.status = "running";
    const reqId = ++this.reqSeq;
    this.runs.set(reqId, { repoKey, convId: conv.id, msgIndex: p.msgIndex, agentId: p.agentId, runId: p.runId, lastEventId: null, afterTool: false });
    this.listener.onRunsChange();
    if (!this.post({ type: "resume", reqId, agentId: p.agentId, runId: p.runId, lastEventId: null })) this.fail(reqId, RELOAD_HINT);
  }

  // ---------- 与后台的连接 ----------

  private ensurePort(): chrome.runtime.Port {
    if (this.port) return this.port;
    if (!extAlive()) throw new Error("ext_invalidated");
    const port = chrome.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener((m: PortEvent) => this.onPortMessage(m));
    port.onDisconnect.addListener(() => {
      this.port = null;
      if (!this.runs.size) return;
      // service worker 被回收或重启：重新连上，从断点继续读
      setTimeout(() => {
        if (!extAlive()) {
          for (const reqId of [...this.runs.keys()]) this.fail(reqId, RELOAD_HINT);
          return;
        }
        for (const [reqId, a] of this.runs) {
          if (a.runId && a.agentId) this.post({ type: "resume", reqId, agentId: a.agentId, runId: a.runId, lastEventId: a.lastEventId });
        }
      }, 600);
    });
    this.port = port;
    return port;
  }

  private post(msg: PortRequest): boolean {
    try {
      this.ensurePort().postMessage(msg);
      return true;
    } catch {
      return false;
    }
  }

  private convOf(a: ActiveRun): Conversation | null {
    const conv = this.convs.get(a.repoKey);
    return conv && conv.id === a.convId ? conv : null;
  }

  private msgOf(a: ActiveRun): AssistantMessage | null {
    const m = this.convOf(a)?.messages[a.msgIndex];
    return m && m.role === "assistant" ? m : null;
  }

  private onPortMessage(msg: PortEvent): void {
    const a = this.runs.get(msg.reqId);
    if (!a) return;
    const conv = this.convOf(a);
    const m = this.msgOf(a);
    if (!conv || !m) {
      this.runs.delete(msg.reqId);
      this.listener.onRunsChange();
      return;
    }

    switch (msg.type) {
      case "started":
        a.agentId = msg.agentId;
        a.runId = msg.runId;
        conv.agentId = msg.agentId;
        if (msg.agentUrl) conv.agentUrl = msg.agentUrl;
        m.agentUrl = conv.agentUrl || "";
        if (msg.model) m.model = msg.model;
        m.backend = msg.backend;
        if (msg.isNewAgent) conv.agentModel = msg.model;
        if (msg.recreated) m.note = "之前的云端会话已失效，已开启新会话（带上了最近的对话）。";
        conv.pending = { agentId: msg.agentId, runId: msg.runId, msgIndex: a.msgIndex };
        this.save(a.repoKey, true);
        if (a.cancelRequested) this.post({ type: "cancel", reqId: msg.reqId, agentId: msg.agentId, runId: msg.runId });
        break;

      case "event": {
        if (msg.id) a.lastEventId = msg.id;
        const d = msg.data || {};
        if (msg.event === "status") m.runStatus = String(d.status || "");
        else if (msg.event === "assistant" && typeof d.text === "string") {
          if (a.afterTool && m.text && !/\n\s*$/.test(m.text)) m.text += "\n\n";
          a.afterTool = false;
          m.text += d.text;
        } else if (msg.event === "tool_call") {
          a.afterTool = true;
          const callId = String(d.callId || "");
          const item = { callId, name: String(d.name || "tool"), detail: toolDetail(d.args), status: d.status as string | undefined };
          const existing = m.activity.find((x) => x.callId === callId);
          if (existing) Object.assign(existing, item, { detail: item.detail || existing.detail });
          else m.activity.push(item);
        }
        this.save(a.repoKey);
        break;
      }

      case "reset":
        m.text = "";
        m.activity = [];
        a.lastEventId = null;
        break;

      case "done": {
        const map = { FINISHED: "finished", ERROR: "error", CANCELLED: "cancelled", EXPIRED: "expired" } as const;
        m.status = map[msg.status as keyof typeof map] || "finished";
        if (msg.text) m.text = msg.text;
        if (m.status === "error" && !m.error) m.error = "Agent 运行出错。";
        if (m.status === "expired") m.error = "这次运行已过期。";
        m.totalTokens = msg.totalTokens ?? null;
        if (msg.costUsd) m.costUsd = msg.costUsd;
        m.durationMs = msg.durationMs ?? Date.now() - m.ts;
        delete m.stopping;
        conv.pending = null;
        this.runs.delete(msg.reqId);
        this.save(a.repoKey, true);
        this.listener.onRunsChange();
        break;
      }

      case "error":
        this.fail(msg.reqId, msg.message, msg.code);
        return;
    }
    this.listener.onChange(a.repoKey, a.msgIndex);
  }

  private fail(reqId: number, message: string, code = ""): void {
    const a = this.runs.get(reqId);
    if (!a) return;
    const conv = this.convOf(a);
    const m = this.msgOf(a);
    if (m) {
      m.status = "error";
      m.error = message;
      m.errorCode = code;
      m.durationMs = Date.now() - m.ts;
      delete m.stopping;
    }
    if (conv) conv.pending = null;
    this.runs.delete(reqId);
    this.save(a.repoKey, true);
    this.listener.onChange(a.repoKey, a.msgIndex);
    this.listener.onRunsChange();
  }

  // ---------- 其它标签页 / 聊天记录页的改动 ----------

  private onStorageChanged(changes: Record<string, chrome.storage.StorageChange>): void {
    for (const [k, ch] of Object.entries(changes)) {
      if (isActiveKey(k)) {
        const repoKey = k.slice(activeKey("").length);
        const conv = this.convs.get(repoKey);
        if (!conv || this.running(repoKey)) continue;
        const id = typeof ch.newValue === "string" ? ch.newValue : null;
        if (id === conv.id) continue;
        if (!id) {
          // 当前会话被删除或在别处开了新会话
          if (ch.oldValue === conv.id && conv.messages.length) this.reset(repoKey, conv);
          continue;
        }
        getChat(id)
          .then((c) => {
            if (!c || this.running(repoKey) || this.convs.get(repoKey)?.id === id) return;
            this.convs.set(repoKey, c);
            this.listener.onChange(repoKey);
            this.resumePending(repoKey);
          })
          .catch(() => {});
      } else if (isChatKey(k)) {
        const id = k.slice(chatKey("").length);
        for (const [repoKey, conv] of this.convs) {
          if (conv.id !== id || this.running(repoKey)) continue;
          if (!ch.newValue) {
            this.reset(repoKey, conv);
            continue;
          }
          const next = normalizeConversation(ch.newValue);
          if (!next || next.updatedAt <= conv.updatedAt) continue;
          this.convs.set(repoKey, next);
          this.listener.onChange(repoKey);
        }
      }
    }
  }

  private reset(repoKey: string, conv: Conversation): void {
    this.convs.set(repoKey, createConversation(conv.repo));
    this.listener.onChange(repoKey);
  }
}
