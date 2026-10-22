// 会话消息的渲染。浮窗和「聊天记录」页共用。
import { h, icon, spinner } from "./dom";
import { fmtClock, fmtCost, fmtDateTime, fmtDuration, fmtTime, fmtTokens } from "./format";
import { copyText, flashCopied, renderMarkdown } from "./markdown";
import type { IconName } from "./octicons";
import type { AssistantMessage, ChatMessage, ToolStep } from "./types";

export interface ChatViewOptions {
  /** 只读查看（聊天记录页）：进行中的消息不显示计时 */
  readonly?: boolean;
  onOpenOptions?: () => void;
}

const TOOLS: Record<string, [label: string, icon: IconName]> = {
  read_file: ["读取", "file"],
  read: ["读取", "file"],
  run_terminal_cmd: ["命令", "terminal"],
  run_terminal_command: ["命令", "terminal"],
  shell: ["命令", "terminal"],
  grep: ["搜索", "search"],
  grep_search: ["搜索", "search"],
  ripgrep: ["搜索", "search"],
  codebase_search: ["语义搜索", "search"],
  semantic_search: ["语义搜索", "search"],
  list_dir: ["目录", "file-directory"],
  ls: ["目录", "file-directory"],
  glob: ["查找文件", "file-directory"],
  file_search: ["查找文件", "file-directory"],
  glob_file_search: ["查找文件", "file-directory"],
  web_search: ["网络搜索", "globe"],
  web_fetch: ["抓取网页", "globe"],
};

export function toolDetail(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  for (const k of ["command", "path", "target_file", "targetFile", "file_path", "filePath", "pattern", "query", "glob_pattern", "globPattern", "url", "directory", "relative_workspace_path"]) {
    if (typeof a[k] === "string" && a[k]) return a[k] as string;
  }
  return "";
}

export function statusText(m: AssistantMessage): string {
  const elapsed = fmtClock(Date.now() - m.ts);
  if (m.stopping) return `正在停止… ${elapsed}`;
  const steps = m.activity?.length || 0;
  if (m.backend === "local") {
    if (m.runStatus === "DOWNLOADING") return `正在下载仓库代码… ${elapsed}`;
    if (m.runStatus === "FETCHING_REPO") return `正在加载仓库代码… ${elapsed}`;
    if (!m.runStatus) return `正在准备… ${elapsed}`;
    if (steps) return `正在阅读代码 · 已执行 ${steps} 步 · ${elapsed}`;
    return `正在思考… ${elapsed}`;
  }
  if (!m.runStatus || m.runStatus === "CREATING") return `正在启动云端环境… ${elapsed}`;
  if (steps) return `正在阅读代码 · 已执行 ${steps} 步 · ${elapsed}`;
  return `Agent 正在思考… ${elapsed}`;
}

export function renderChatMessage(m: ChatMessage, index: number, opts: ChatViewOptions = {}): HTMLElement {
  if (m.role === "user") {
    return h(
      "div",
      { class: "chat-msg user", dataset: { index: String(index) } },
      h("div", { class: "chat-bubble", title: fmtDateTime(m.ts) }, m.text),
    );
  }
  const node = h("div", { class: "chat-msg assistant", dataset: { index: String(index) } });
  fillAssistant(node, m, opts);
  return node;
}

export function fillAssistant(node: HTMLElement, m: AssistantMessage, opts: ChatViewOptions = {}): void {
  const wasOpen = node.querySelector<HTMLDetailsElement>("details.chat-activity")?.open ?? false;
  const running = m.status === "running";
  node.classList.toggle("running", running);
  node.replaceChildren();

  node.appendChild(
    h(
      "div",
      { class: "chat-msg-head" },
      h("span", { class: "chat-avatar" }, icon("sparkle-fill")),
      h("span", { class: "chat-author" }, m.backend === "local" ? "助手" : "Cursor"),
      m.model ? h("span", { class: "chat-model", title: "模型" }, m.model) : null,
      h("span", { class: "chat-time", title: fmtDateTime(m.ts) }, fmtTime(m.ts)),
    ),
  );

  const body = h("div", { class: "chat-msg-body" });
  node.appendChild(body);

  if (m.note) body.appendChild(h("div", { class: "chat-note" }, icon("info"), h("span", null, m.note)));

  if (running) {
    body.appendChild(
      opts.readonly
        ? h("div", { class: "chat-status" }, icon("clock"), h("span", null, "回答未完成。在对应的 GitHub 仓库页打开浮窗会接着读取。"))
        : h("div", { class: "chat-status", role: "status" }, spinner(16), h("span", { class: "chat-status-text" }, statusText(m))),
    );
  }

  if (m.activity?.length) body.appendChild(renderActivity(m.activity, wasOpen));

  if (m.text) body.appendChild(renderMarkdown(m.text, { highlight: !running }));

  if (m.status === "error" || m.status === "expired") {
    const err = h("div", { class: "flash flash-error flash-sm chat-error" }, icon("alert"), h("div", { class: "flash-body" }, m.error || "出错了。"));
    if (opts.onOpenOptions && (m.errorCode === "no_key" || /API key/.test(m.error || ""))) {
      err.lastElementChild!.append(" ", h("button", { type: "button", class: "link-btn", onclick: opts.onOpenOptions }, "打开设置"));
    }
    body.appendChild(err);
  }
  if (m.status === "cancelled") body.appendChild(h("div", { class: "chat-cancelled" }, icon("x-circle"), "已停止"));

  if (!running && (m.text || m.status === "finished")) {
    const bits: string[] = [];
    if (m.durationMs) bits.push(`用时 ${fmtDuration(m.durationMs)}`);
    if (m.totalTokens) bits.push(`${fmtTokens(m.totalTokens)} tokens`);
    if (m.costUsd) bits.push(fmtCost(m.costUsd));
    const foot = h("div", { class: "chat-foot" });
    if (m.text) {
      const copy = h(
        "button",
        { type: "button", class: "btn-octicon xs", title: "复制回答（Markdown）", "aria-label": "复制回答" },
        icon("copy"),
        icon("check", "copied-icon"),
      );
      copy.addEventListener("click", () => copyText(m.text).then((ok) => flashCopied(copy, ok)));
      foot.appendChild(copy);
    }
    if (m.agentUrl) {
      foot.appendChild(
        h("a", { class: "btn-octicon xs", href: m.agentUrl, target: "_blank", rel: "noopener noreferrer", title: "在 Cursor 中查看这次运行", "aria-label": "在 Cursor 中查看" }, icon("link-external")),
      );
    }
    if (bits.length) foot.appendChild(h("span", { class: "chat-foot-meta" }, bits.join(" · ")));
    if (foot.childNodes.length) body.appendChild(foot);
  }
}

function renderActivity(steps: ToolStep[], open: boolean): HTMLElement {
  const det = h("details", { class: "chat-activity" });
  det.open = open;
  det.appendChild(
    h("summary", null, icon("chevron-right", "chevron"), h("span", null, "执行了操作"), h("span", { class: "Counter" }, String(steps.length))),
  );
  const ol = h("ol");
  for (const t of steps.slice(-100)) {
    const [label, ic] = TOOLS[t.name] || [t.name, "tools" as IconName];
    const detail = t.detail.length > 160 ? t.detail.slice(0, 160) + "…" : t.detail;
    ol.appendChild(
      h(
        "li",
        { class: t.status === "running" ? "pending" : "", title: t.detail || label },
        t.status === "running" ? spinner(12) : icon(ic),
        h("span", { class: "chat-tool" }, label),
        detail ? h("code", null, detail) : null,
      ),
    );
  }
  det.appendChild(ol);
  return det;
}
