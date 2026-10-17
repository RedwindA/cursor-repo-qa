// 浮窗界面（Shadow DOM 内）
import { fillAssistant, renderChatMessage, statusText, type ChatViewOptions } from "../shared/chat-view";
import { h, icon, isolateKeys } from "../shared/dom";
import { fmtRelative } from "../shared/format";
import { bindCodeCopy } from "../shared/markdown";
import type { Conversation } from "../shared/types";
import css from "./panel.css?inline";
import type { CurrentRepo } from "./repo";
import { extAlive, type Session } from "./session";

const OPEN_KEY = "cursorRepoQA.open";
const MIN_W = 360;
const MIN_H = 420;

type NoticeKind = "" | "nokey" | "private" | "invalid";

export class Panel {
  readonly host = h("div", { id: "cursor-repo-qa-root" });
  private repo: CurrentRepo | null = null;
  private isOpen = sessionStorage.getItem(OPEN_KEY) === "1";
  private maximized = false;
  private model = "";
  private rafIdx = new Set<number>();
  private rafAll = false;
  private rafId = 0;

  private wrap = h("div", { class: "qa-root wrap", hidden: true });
  private fab = h("button", { type: "button", class: "fab", title: "问问这个仓库（Cursor Cloud Agent）", "aria-label": "打开 Cursor 仓库问答" }, icon("comment-discussion"), h("span", { class: "fab-dot" }));
  private panel = h("section", { class: "panel", role: "dialog", "aria-label": "Cursor 仓库问答", hidden: true });
  private titleOwner = h("span", { class: "head-owner" });
  private titleName = h("span", { class: "head-name" });
  private subtitle = h("div", { class: "head-sub" });
  private btnHistory = this.iconBtn("history", "这个仓库的历史会话", () => this.toggleMenu());
  private btnNew = this.iconBtn("plus", "新会话", () => this.repo && this.session.newChat(this.repo).then(() => this.input.focus()));
  private btnAgent = h("a", { class: "btn-octicon sm", target: "_blank", rel: "noopener noreferrer", title: "在 Cursor 中打开云端会话", "aria-label": "在 Cursor 中打开云端会话" }, icon("link-external"));
  private btnMax = this.iconBtn("screen-full", "放大", () => this.toggleMaximize());
  private menu = h("div", { class: "menu", role: "menu", hidden: true });
  private noticeEl = h("div", { class: "flash flash-warn flash-sm flash-full", hidden: true });
  private list = h("div", { class: "list", role: "log", "aria-live": "polite" });
  private toBottom = h("button", { type: "button", class: "to-bottom btn-octicon sm", title: "回到底部", "aria-label": "回到底部", hidden: true }, icon("arrow-down"));
  private input = h("textarea", { class: "composer-input", rows: 1, placeholder: "问点关于这个仓库的问题…", "aria-label": "问题" });
  private modelBtn = h("button", { type: "button", class: "composer-model", title: "选择模型（在设置里修改）" }, icon("cpu"), h("span"));
  private send = h("button", { type: "submit", class: "composer-send" });
  private composer = h(
    "form",
    { class: "composer" },
    h("div", { class: "composer-box" }, this.input, h("div", { class: "composer-bar" }, this.modelBtn, h("span", { class: "composer-hint" }, h("kbd", null, "Enter"), " 发送 · ", h("kbd", null, "Shift+Enter"), " 换行"), this.send)),
  );
  private viewOpts: ChatViewOptions = { onOpenOptions: () => this.openOptions() };

  constructor(private session: Session) {
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = h("style");
    style.textContent = css;
    shadow.append(style, this.wrap);
    this.host.style.cssText = "all: initial; position: fixed; z-index: 2147483000; inset: auto 0 0 auto;";

    this.build();
    this.watchTheme();
    this.restoreSize();
    this.loadModel();
    setInterval(() => this.tick(), 1000);
  }

  // ---------- 构建 ----------

  private iconBtn(name: Parameters<typeof icon>[0], label: string, onClick: () => void): HTMLButtonElement {
    return h("button", { type: "button", class: "btn-octicon sm", title: label, "aria-label": label, onclick: onClick }, icon(name));
  }

  private build(): void {
    this.fab.addEventListener("click", () => this.toggle(true));

    const resize = h("div", { class: "resize", title: "拖动调整大小" });
    this.bindResize(resize);

    const head = h(
      "header",
      { class: "head" },
      h("span", { class: "head-icon" }, icon("repo")),
      h("div", { class: "head-title" }, h("div", { class: "head-repo" }, this.titleOwner, h("span", { class: "head-sep" }, "/"), this.titleName), this.subtitle),
      h("div", { class: "head-actions" }, this.btnHistory, this.btnNew, this.btnAgent, this.btnMax, this.iconBtn("gear", "设置", () => this.openOptions()), this.iconBtn("x", "关闭", () => this.toggle(false))),
      this.menu,
    );

    const body = h("div", { class: "body" }, this.list, this.toBottom);
    this.panel.append(resize, head, this.noticeEl, body, this.composer);
    this.wrap.append(this.fab, this.panel);
    isolateKeys(this.panel);
    bindCodeCopy(this.list);

    this.list.addEventListener("scroll", () => {
      this.toBottom.hidden = this.nearBottom(200);
    });
    this.toBottom.addEventListener("click", () => this.scrollToBottom(true));

    this.composer.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!this.repo) return;
      if (this.session.running(this.repo.key)) {
        this.session.stop(this.repo.key);
        return;
      }
      const q = this.input.value;
      if (!q.trim()) return;
      this.input.value = "";
      this.autoGrow();
      this.session.ask(this.repo, q, location.href);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        this.composer.requestSubmit();
      }
    });
    this.input.addEventListener("input", () => {
      this.autoGrow();
      this.refreshComposer();
    });
    this.modelBtn.addEventListener("click", () => this.openOptions());

    this.panel.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!this.menu.hidden) this.closeMenu();
      else this.toggle(false);
    });
    // 点菜单外面关闭菜单
    this.wrap.addEventListener("pointerdown", (e) => {
      if (this.menu.hidden) return;
      const path = e.composedPath();
      if (!path.includes(this.menu) && !path.includes(this.btnHistory)) this.closeMenu();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !e.composedPath().includes(this.host)) this.closeMenu();
    });
  }

  private autoGrow(): void {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 200) + "px";
  }

  // ---------- 打开 / 关闭 / 尺寸 ----------

  toggle(force?: boolean): void {
    this.isOpen = force ?? !this.isOpen;
    sessionStorage.setItem(OPEN_KEY, this.isOpen ? "1" : "0");
    this.applyOpen();
    if (this.isOpen) {
      this.render();
      setTimeout(() => this.input.focus(), 0);
    } else {
      this.closeMenu();
      this.fab.focus({ preventScroll: true });
    }
  }

  private applyOpen(): void {
    this.panel.hidden = !this.isOpen;
    this.fab.hidden = this.isOpen;
  }

  private toggleMaximize(): void {
    this.maximized = !this.maximized;
    this.panel.classList.toggle("maximized", this.maximized);
    this.btnMax.replaceChildren(icon(this.maximized ? "screen-normal" : "screen-full"));
    this.btnMax.title = this.maximized ? "还原" : "放大";
    this.btnMax.setAttribute("aria-label", this.btnMax.title);
  }

  private restoreSize(): void {
    chrome.storage.local
      .get("panelSize")
      .then(({ panelSize }) => {
        const s = panelSize as { w: number; h: number } | undefined;
        if (s) this.applySize(s.w, s.h);
      })
      .catch(() => {});
  }

  private applySize(w: number, hgt: number): void {
    const maxW = window.innerWidth - 32;
    const maxH = window.innerHeight - 48;
    this.panel.style.width = Math.max(MIN_W, Math.min(w, maxW)) + "px";
    this.panel.style.height = Math.max(MIN_H, Math.min(hgt, maxH)) + "px";
  }

  private bindResize(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (e) => {
      if (this.maximized) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const r = this.panel.getBoundingClientRect();
      handle.setPointerCapture(e.pointerId);
      this.panel.classList.add("resizing");
      const move = (ev: PointerEvent) => this.applySize(r.width + (startX - ev.clientX), r.height + (startY - ev.clientY));
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        this.panel.classList.remove("resizing");
        const nr = this.panel.getBoundingClientRect();
        if (extAlive()) chrome.storage.local.set({ panelSize: { w: nr.width, h: nr.height } }).catch(() => {});
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // 主题和语言：跟随 GitHub（Primer 变量本身会被继承；这里决定兜底配色）
  private watchTheme(): void {
    const apply = () => {
      const root = document.documentElement;
      const mode = root.getAttribute("data-color-mode");
      let dark = mode === "dark" ? true : mode === "light" ? false : matchMedia("(prefers-color-scheme: dark)").matches;
      if (mode === "auto") {
        const theme = root.getAttribute(dark ? "data-dark-theme" : "data-light-theme");
        if (theme) dark = theme.startsWith("dark");
      }
      this.wrap.dataset.theme = dark ? "dark" : "light";
      // 宿主的 all: initial 会把语言（-webkit-locale）重置掉，导致中文回退字体和 GitHub 页面不一致；跟页面保持同一个 lang
      this.wrap.lang = root.lang || "en";
    };
    new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode", "data-dark-theme", "data-light-theme", "lang"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
    apply();
  }

  private openOptions(hash?: string): void {
    if (extAlive()) chrome.runtime.sendMessage({ type: "openOptions", hash }).catch(() => {});
  }

  // ---------- 状态同步 ----------

  async setRepo(repo: CurrentRepo | null): Promise<void> {
    const changed = (repo?.key || null) !== (this.repo?.key || null);
    this.repo = repo;
    this.wrap.hidden = !repo;
    this.refreshFab();
    if (!repo) return;
    await this.session.load(repo);
    this.session.resumePending(repo.key);
    if (changed) this.closeMenu();
    this.applyOpen();
    if (this.isOpen) this.render();
    else this.refreshComposer();
  }

  async onSettingsChanged(): Promise<void> {
    await this.loadModel();
    if (this.isOpen) this.render();
  }

  private async loadModel(): Promise<void> {
    try {
      const { model } = await chrome.storage.local.get("model");
      this.model = String(model || "");
    } catch {
      this.model = "";
    }
    const label = this.modelBtn.lastElementChild!;
    label.textContent = this.model || "默认模型";
  }

  onChange(repoKey: string, msgIndex?: number): void {
    if (repoKey !== this.repo?.key || !this.isOpen) {
      this.refreshComposer();
      return;
    }
    if (msgIndex == null) this.rafAll = true;
    else this.rafIdx.add(msgIndex);
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const all = this.rafAll;
      const idxs = [...this.rafIdx];
      this.rafAll = false;
      this.rafIdx.clear();
      if (all) {
        this.render();
        return;
      }
      const conv = this.repo && this.session.get(this.repo.key);
      if (!conv) return;
      const stick = this.nearBottom(80);
      for (const i of idxs) {
        const m = conv.messages[i];
        const node = this.list.querySelector<HTMLElement>(`.chat-msg[data-index="${i}"]`);
        if (!m || !node) {
          this.renderMessages(conv);
          break;
        }
        if (m.role === "assistant") fillAssistant(node, m, this.viewOpts);
      }
      if (stick) this.scrollToBottom();
      this.refreshComposer();
    });
  }

  refreshFab(): void {
    this.fab.classList.toggle("busy", this.session.busy);
    this.fab.title = this.session.busy ? "Cursor 正在回答…" : "问问这个仓库（Cursor Cloud Agent）";
  }

  private refreshComposer(): void {
    const repo = this.repo;
    const running = !!repo && !!this.session.running(repo.key);
    const conv = repo ? this.session.get(repo.key) : undefined;
    this.send.replaceChildren(icon(running ? "square-fill" : "paper-airplane"));
    this.send.title = running ? "停止" : "发送";
    this.send.setAttribute("aria-label", this.send.title);
    this.send.classList.toggle("stop", running);
    this.send.disabled = !running && !this.input.value.trim();
    this.input.disabled = running;
    this.btnNew.disabled = running || !conv?.messages.length;
    this.btnHistory.disabled = running;
    if (repo) this.input.placeholder = running ? "等这次回答结束后再追问…" : conv?.messages.length ? "继续追问…" : `问点关于 ${repo.owner}/${repo.name} 的问题…`;
  }

  // ---------- 渲染 ----------

  async render(): Promise<void> {
    const repo = this.repo;
    if (!repo) return;
    const conv = await this.session.load(repo);
    if (repo !== this.repo) return;

    this.titleOwner.textContent = repo.owner;
    this.titleName.textContent = repo.name;
    this.titleName.parentElement!.title = `${repo.owner}/${repo.name}`;
    this.subtitle.textContent = conv.title || "新会话";
    this.subtitle.title = conv.title || "";
    this.btnAgent.hidden = !conv.agentUrl;
    if (conv.agentUrl) this.btnAgent.href = conv.agentUrl;

    let notice: NoticeKind = "";
    try {
      const { apiKey } = await chrome.storage.local.get("apiKey");
      if (!apiKey) notice = "nokey";
    } catch {
      notice = "invalid";
    }
    if (!notice && repo.isPrivate) notice = "private";
    this.renderNotice(notice);
    this.renderMessages(conv);
    this.refreshComposer();
  }

  private renderNotice(kind: NoticeKind): void {
    this.noticeEl.hidden = !kind;
    this.noticeEl.className = `flash flash-sm flash-full ${kind === "invalid" ? "flash-error" : "flash-warn"}`;
    if (!kind) return;
    const body = h("div", { class: "flash-body" });
    if (kind === "nokey") body.append("还没有设置 Cursor API key。", " ", h("button", { type: "button", class: "link-btn", onclick: () => this.openOptions() }, "去设置"));
    else if (kind === "private") body.append("这是私有仓库：Cloud Agent 只能匿名克隆公开仓库，回答很可能会失败。");
    else body.append("扩展已更新或重新加载，请刷新页面。");
    this.noticeEl.replaceChildren(icon("alert"), body);
  }

  private renderMessages(conv: Conversation): void {
    if (!conv.messages.length) {
      this.list.replaceChildren(this.renderEmpty());
      this.toBottom.hidden = true;
      return;
    }
    this.list.replaceChildren(...conv.messages.map((m, i) => renderChatMessage(m, i, this.viewOpts)));
    this.scrollToBottom();
  }

  private renderEmpty(): HTMLElement {
    const repo = this.repo!;
    const sugg = ["这个仓库是做什么的？", "项目的整体结构和核心模块是怎样的？", "怎么在本地把它跑起来？"];
    const sub = repo.subPath;
    if (/^blob\//.test(sub)) sugg.unshift("解释一下我正在看的这个文件");
    else if (/^tree\/[^/]+\/.+/.test(sub)) sugg.unshift("这个目录里的代码负责什么？");
    else if (/^(pull|issues)\/\d+/.test(sub)) sugg.unshift("结合代码，解释一下当前页面讨论的问题");
    return h(
      "div",
      { class: "blankslate" },
      h("div", { class: "blankslate-icon" }, icon("sparkle-fill-24")),
      h("h3", { class: "blankslate-heading" }, "问问这个仓库"),
      h("p", { class: "blankslate-desc" }, "Cursor 会在云端克隆仓库、阅读代码后回答。第一次提问需要启动环境，通常要等几十秒。"),
      h(
        "div",
        { class: "suggestions" },
        ...sugg.map((s) =>
          h("button", { type: "button", class: "suggestion", onclick: () => this.repo && this.session.ask(this.repo, s, location.href) }, icon("comment"), h("span", null, s)),
        ),
      ),
    );
  }

  private nearBottom(px: number): boolean {
    return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < px;
  }

  private scrollToBottom(smooth = false): void {
    this.list.scrollTo({ top: this.list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    this.toBottom.hidden = true;
  }

  /** 每秒刷新进行中的计时 */
  private tick(): void {
    if (!this.repo || !this.isOpen) return;
    const r = this.session.running(this.repo.key);
    if (!r) return;
    const m = this.session.get(this.repo.key)?.messages[r[1].msgIndex];
    const node = this.list.querySelector(`.chat-msg[data-index="${r[1].msgIndex}"] .chat-status-text`);
    if (node && m?.role === "assistant") node.textContent = statusText(m);
  }

  // ---------- 历史会话菜单 ----------

  private async toggleMenu(): Promise<void> {
    if (!this.menu.hidden) {
      this.closeMenu();
      return;
    }
    const repo = this.repo;
    if (!repo) return;
    const chats = await this.session.listForRepo(repo.key);
    const current = this.session.get(repo.key);
    const items = chats.slice(0, 30).map((c) => {
      const active = c.id === current?.id;
      const count = c.messages.filter((m) => m.role === "user").length;
      return h(
        "button",
        {
          type: "button",
          class: "menu-item" + (active ? " active" : ""),
          role: "menuitemradio",
          "aria-checked": active ? "true" : "false",
          onclick: () => {
            this.closeMenu();
            if (!active) this.session.open(repo, c.id);
          },
        },
        h("span", { class: "menu-check" }, active ? icon("check") : null),
        h(
          "span",
          { class: "menu-text" },
          h("span", { class: "menu-title" }, c.title || "（无标题）"),
          h("span", { class: "menu-desc" }, `${count} 个问题 · ${fmtRelative(c.updatedAt)}`, c.pending ? h("span", { class: "Label Label--attention" }, "进行中") : null),
        ),
      );
    });
    this.menu.replaceChildren(
      h("div", { class: "menu-header" }, h("span", null, "这个仓库的会话"), h("span", { class: "Counter" }, String(chats.length))),
      items.length ? h("div", { class: "menu-list" }, ...items) : h("div", { class: "menu-empty" }, "还没有保存的会话。"),
      h("div", { class: "menu-divider" }),
      h(
        "button",
        { type: "button", class: "menu-item", onclick: () => (this.closeMenu(), this.openOptions(`#/history?repo=${encodeURIComponent(repo.key)}`)) },
        h("span", { class: "menu-check" }, icon("history")),
        h("span", { class: "menu-text" }, h("span", { class: "menu-title" }, "查看全部聊天记录")),
      ),
    );
    this.menu.hidden = false;
    this.btnHistory.setAttribute("aria-expanded", "true");
    (this.menu.querySelector(".menu-item.active") as HTMLElement | null)?.focus();
  }

  private closeMenu(): void {
    this.menu.hidden = true;
    this.btnHistory.setAttribute("aria-expanded", "false");
  }
}
