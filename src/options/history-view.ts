// 「聊天记录」：浏览、搜索、导出、删除本地保存的会话
import { renderChatMessage } from "../shared/chat-view";
import { h, icon } from "../shared/dom";
import { fmtDateTime, fmtRelative, fmtTokens } from "../shared/format";
import { bindCodeCopy } from "../shared/markdown";
import { deleteAllChats, deleteChats, isChatKey, listChats, normalizeConversation, saveChat, setActiveId } from "../shared/storage";
import type { Conversation } from "../shared/types";
import { confirmDialog, download, subhead, toast } from "./ui";

export interface HistoryRoute {
  id?: string;
  repo?: string;
}

const questions = (c: Conversation) => c.messages.filter((m) => m.role === "user").length;
const repoName = (c: Conversation) => `${c.repo.owner}/${c.repo.name}`;

export class HistoryView {
  readonly el = h("div", { class: "history" });
  private chats: Conversation[] = [];
  private query = "";
  private repo = "";
  private selectedId = "";

  private countEl = h("span", { class: "Counter" }, "0");
  private searchInput = h("input", { type: "search", class: "form-control", placeholder: "搜索问题和回答…", "aria-label": "搜索聊天记录" });
  private repoSel = h("select", { class: "form-control", "aria-label": "按仓库筛选" });
  private listEl = h("nav", { class: "history-list", "aria-label": "会话列表" });
  private detailEl = h("section", { class: "history-detail" });
  private usageEl = h("span", { class: "f6 color-fg-muted" });
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private navigate: (hash: string) => void) {
    const exportBtn = h("button", { type: "button", class: "btn btn-sm", onclick: () => this.exportAll() }, icon("download"), "导出");
    const importInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: () => this.importFile(importInput) });
    const importBtn = h("button", { type: "button", class: "btn btn-sm", onclick: () => importInput.click() }, "导入");
    const clearBtn = h("button", { type: "button", class: "btn btn-sm btn-danger", onclick: () => this.clearAll() }, icon("trash"), "清空");

    this.el.append(
      subhead("聊天记录", {
        actions: h("div", { class: "subhead-actions" }, exportBtn, importBtn, importInput, clearBtn),
        desc: "浮窗里的每段会话都保存在这台电脑上。点“新会话”不会删除旧记录，可以在这里回看，或回到 GitHub 接着问。",
      }),
      h(
        "div",
        { class: "history-toolbar" },
        h("div", { class: "input-group grow" }, icon("search"), this.searchInput),
        h("div", { class: "select-wrap" }, this.repoSel, icon("chevron-down")),
      ),
      h("div", { class: "history-split" }, h("div", { class: "history-list-col" }, h("div", { class: "history-list-head" }, h("span", null, "会话"), this.countEl), this.listEl), this.detailEl),
      h("div", { class: "history-foot" }, this.usageEl),
    );
    bindCodeCopy(this.detailEl);

    let t: ReturnType<typeof setTimeout> | undefined;
    this.searchInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        this.query = this.searchInput.value.trim().toLowerCase();
        this.renderList();
      }, 120);
    });
    this.repoSel.addEventListener("change", () => {
      this.repo = this.repoSel.value;
      this.navigate(this.hashFor(this.selectedId));
    });

    // 浮窗里有新回答、其它页面删除了记录等：自动刷新
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !Object.keys(changes).some(isChatKey)) return;
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.reload(), 300);
    });
  }

  private hashFor(id: string): string {
    return "#/history" + (id ? "/" + encodeURIComponent(id) : "") + (this.repo ? "?repo=" + encodeURIComponent(this.repo) : "");
  }

  async show(route: HistoryRoute): Promise<void> {
    this.repo = route.repo || "";
    this.selectedId = route.id || "";
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.chats = await listChats();
    this.renderRepoFilter();
    this.renderList();
    this.renderDetail();
    chrome.storage.local.getBytesInUse(null).then((n) => {
      this.usageEl.textContent = `本地存储占用 ${n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.ceil(n / 1024) + " KB"}`;
    });
  }

  private renderRepoFilter(): void {
    const counts = new Map<string, { name: string; n: number }>();
    for (const c of this.chats) {
      const e = counts.get(c.repoKey) || { name: repoName(c), n: 0 };
      e.n++;
      counts.set(c.repoKey, e);
    }
    if (this.repo && !counts.has(this.repo)) counts.set(this.repo, { name: this.repo, n: 0 });
    this.repoSel.replaceChildren(new Option(`全部仓库（${this.chats.length}）`, ""));
    for (const [key, { name, n }] of [...counts].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) {
      this.repoSel.add(new Option(`${name}（${n}）`, key));
    }
    this.repoSel.value = this.repo;
  }

  private filtered(): Conversation[] {
    return this.chats.filter((c) => {
      if (this.repo && c.repoKey !== this.repo) return false;
      if (!this.query) return true;
      if (c.title.toLowerCase().includes(this.query) || c.repoKey.includes(this.query)) return true;
      return c.messages.some((m) => m.text.toLowerCase().includes(this.query));
    });
  }

  private renderList(): void {
    const items = this.filtered();
    this.countEl.textContent = String(items.length);
    this.el.classList.toggle("has-selection", !!this.selectedId);
    if (!items.length) {
      this.listEl.replaceChildren(
        h(
          "div",
          { class: "history-list-empty" },
          this.chats.length ? "没有符合条件的会话。" : "还没有聊天记录。在任意 GitHub 仓库页面点右下角的按钮开始提问。",
        ),
      );
      return;
    }
    const groups = new Map<string, Conversation[]>();
    for (const c of items) {
      const g = dateGroup(c.updatedAt);
      groups.set(g, [...(groups.get(g) || []), c]);
    }
    const nodes: Node[] = [];
    for (const [label, cs] of groups) {
      nodes.push(h("div", { class: "history-group" }, label));
      for (const c of cs) {
        const selected = c.id === this.selectedId;
        nodes.push(
          h(
            "a",
            { class: "history-item" + (selected ? " selected" : ""), href: this.hashFor(c.id), "aria-current": selected ? "page" : null },
            h("span", { class: "history-item-title" }, c.title || "（无标题）"),
            h(
              "span",
              { class: "history-item-meta" },
              icon("repo"),
              h("span", { class: "history-item-repo" }, repoName(c)),
              h("span", { class: "history-item-dot" }, "·"),
              h("span", { title: fmtDateTime(c.updatedAt) }, fmtRelative(c.updatedAt)),
              c.pending ? h("span", { class: "Label Label--attention" }, "进行中") : null,
            ),
          ),
        );
      }
    }
    this.listEl.replaceChildren(...nodes);
    this.listEl.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }

  private renderDetail(): void {
    const c = this.chats.find((x) => x.id === this.selectedId);
    if (!c) {
      this.detailEl.replaceChildren(
        h(
          "div",
          { class: "blankslate" },
          h("div", { class: "blankslate-icon" }, icon("history-24")),
          h("h3", { class: "blankslate-heading" }, this.chats.length ? "选择一段会话" : "还没有聊天记录"),
          h("p", { class: "blankslate-desc" }, this.chats.length ? "从左侧列表选择一段会话查看完整内容。" : "在任意 GitHub 公开仓库页面点右下角的按钮提问，会话会自动保存在这里。"),
        ),
      );
      return;
    }

    const tokens = c.messages.reduce((n, m) => n + (m.role === "assistant" ? m.totalTokens || 0 : 0), 0);
    const repoUrl = `https://github.com/${c.repo.owner}/${c.repo.name}`;
    const continueBtn = h("button", { type: "button", class: "btn btn-sm btn-primary", title: "在 GitHub 上打开这个仓库，并在浮窗里接着这段会话提问" }, icon("comment-discussion"), "在 GitHub 中继续");
    continueBtn.addEventListener("click", async () => {
      await setActiveId(c.repoKey, c.id);
      window.open(`${repoUrl}#cursor-repo-qa`, "_blank", "noopener");
    });
    const mdBtn = h("button", { type: "button", class: "btn btn-sm", title: "导出为 Markdown 文件" }, icon("download"), "Markdown");
    mdBtn.addEventListener("click", () => download(`${c.repo.owner}-${c.repo.name}-${c.id}.md`, toMarkdown(c), "text/markdown;charset=utf-8"));
    const delBtn = h("button", { type: "button", class: "btn-octicon sm danger", title: c.pending ? "回答还没结束，暂时不能删除" : "删除这段会话", "aria-label": "删除这段会话", disabled: !!c.pending }, icon("trash"));
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: "删除这段会话？", body: `“${c.title || "（无标题）"}”会从本地记录中删除，无法恢复。不会影响 Cursor 云端的 agent。`, confirm: "删除", danger: true });
      if (!ok) return;
      await deleteChats([c.id]);
      toast("已删除");
      this.navigate(this.hashFor(""));
    });
    const back = h("a", { class: "btn-octicon sm history-back", href: this.hashFor(""), title: "返回列表", "aria-label": "返回列表" }, icon("arrow-left"));

    const meta = h(
      "div",
      { class: "history-detail-meta" },
      h("a", { class: "Link--muted meta-item", href: repoUrl, target: "_blank", rel: "noopener noreferrer" }, icon("repo"), repoName(c)),
      h("span", { class: "meta-item", title: `创建于 ${fmtDateTime(c.createdAt)}` }, icon("clock"), fmtDateTime(c.updatedAt)),
      h("span", { class: "meta-item" }, icon("comment"), `${questions(c)} 个问题`),
      tokens ? h("span", { class: "meta-item" }, icon("cpu"), `${fmtTokens(tokens)} tokens`) : null,
      c.agentUrl ? h("a", { class: "Link--muted meta-item", href: c.agentUrl, target: "_blank", rel: "noopener noreferrer" }, icon("link-external"), "Cursor 会话") : null,
    );

    this.detailEl.replaceChildren(
      h(
        "header",
        { class: "history-detail-head" },
        h("div", { class: "history-detail-titlebar" }, back, h("h3", { class: "history-detail-title" }, c.title || "（无标题）"), h("div", { class: "history-detail-actions" }, continueBtn, mdBtn, delBtn)),
        meta,
      ),
      h("div", { class: "history-detail-body" }, ...c.messages.map((m, i) => renderChatMessage(m, i, { readonly: true }))),
    );
  }

  // ---------- 导入 / 导出 / 清空 ----------

  private exportAll(): void {
    if (!this.chats.length) {
      toast("没有可以导出的记录", "info");
      return;
    }
    const data = { app: "cursor-repo-qa", version: 1, exportedAt: new Date().toISOString(), conversations: this.chats };
    download(`cursor-repo-qa-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list: unknown[] = Array.isArray(data) ? data : data?.conversations;
      if (!Array.isArray(list)) throw new Error("文件格式不对");
      const existing = new Set(this.chats.map((c) => c.id));
      let n = 0;
      for (const raw of list) {
        const c = normalizeConversation(raw);
        if (!c || !c.messages.length || existing.has(c.id)) continue;
        c.pending = null;
        for (const m of c.messages) if (m.role === "assistant" && m.status === "running") m.status = "cancelled";
        await saveChat(c, false);
        n++;
      }
      toast(n ? `已导入 ${n} 段会话` : "没有新的会话需要导入", n ? "success" : "info");
      await this.reload();
    } catch (e) {
      toast("导入失败：" + (e as Error).message, "error");
    }
  }

  private async clearAll(): Promise<void> {
    if (!this.chats.length) return;
    const ok = await confirmDialog({
      title: "清空所有聊天记录？",
      body: `将删除本地保存的全部 ${this.chats.length} 段会话，无法恢复。建议先导出备份。不会影响 Cursor 云端的 agent。`,
      confirm: "全部清空",
      danger: true,
    });
    if (!ok) return;
    const n = await deleteAllChats();
    toast(`已清空 ${n} 段会话`);
    this.navigate("#/history");
  }
}

function dateGroup(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (d >= today) return "今天";
  if (d.getTime() >= today.getTime() - day) return "昨天";
  if (d.getTime() >= today.getTime() - 7 * day) return "最近 7 天";
  if (d.getTime() >= today.getTime() - 30 * day) return "最近 30 天";
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

function toMarkdown(c: Conversation): string {
  const out = [`# ${c.title || "（无标题）"}`, "", `- 仓库：[${repoName(c)}](https://github.com/${c.repo.owner}/${c.repo.name})`, `- 时间：${fmtDateTime(c.createdAt)}`];
  if (c.agentUrl) out.push(`- Cursor 会话：${c.agentUrl}`);
  for (const m of c.messages) {
    out.push("", m.role === "user" ? "## 问" : "## 答", "");
    if (m.role === "user") out.push(m.text.split("\n").map((l) => "> " + l).join("\n"));
    else out.push(m.text || (m.error ? `*${m.error}*` : "*（没有回答）*"));
  }
  return out.join("\n") + "\n";
}
