// 设置页用到的小组件：Subhead、对话框、Toast、下载
import { h, icon } from "../shared/dom";
import type { IconName } from "../shared/octicons";

export function subhead(title: string, opts: { desc?: Node | string; actions?: Node; danger?: boolean } = {}): HTMLElement {
  return h(
    "div",
    { class: "Subhead" + (opts.danger ? " Subhead--danger" : "") },
    h("h2", { class: "Subhead-heading" }, title),
    opts.actions ? h("div", { class: "Subhead-actions" }, opts.actions) : null,
    opts.desc ? h("p", { class: "Subhead-description" }, opts.desc) : null,
  );
}

export function externalLink(href: string, text: string): HTMLAnchorElement {
  return h("a", { class: "Link", href, target: "_blank", rel: "noopener noreferrer" }, text);
}

/** 表单下方的校验/状态提示（Primer InlineMessage） */
export class InlineMessage {
  readonly el = h("div", { class: "inline-msg", role: "status" });

  set(text: string, kind: "" | "success" | "error" | "warn" = "", ic?: IconName): void {
    this.el.className = "inline-msg" + (kind ? " " + kind : "");
    this.el.replaceChildren();
    if (!text) return;
    const name: IconName | undefined = ic ?? (kind === "success" ? "check-circle" : kind === "error" ? "alert" : kind === "warn" ? "alert" : undefined);
    if (name) this.el.appendChild(icon(name));
    this.el.appendChild(h("span", null, text));
  }
}

/** Primer 风格的确认对话框 */
export function confirmDialog(opts: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "Dialog", "aria-labelledby": "dlg-title" });
    const close = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    const ok = h("button", { type: "button", class: "btn " + (opts.danger ? "btn-danger" : "btn-primary"), onclick: () => close(true) }, opts.confirm);
    dlg.append(
      h(
        "div",
        { class: "Dialog-header" },
        h("h1", { class: "Dialog-title", id: "dlg-title" }, opts.title),
        h("button", { type: "button", class: "btn-octicon", "aria-label": "关闭", onclick: () => close(false) }, icon("x")),
      ),
      h("div", { class: "Dialog-body" }, opts.body),
      h("div", { class: "Dialog-footer" }, h("button", { type: "button", class: "btn", onclick: () => close(false) }, "取消"), ok),
    );
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(false);
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) close(false);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    ok.focus();
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** 左下角的 Toast */
export function toast(text: string, kind: "success" | "error" | "info" = "success"): void {
  document.querySelector(".Toast")?.remove();
  clearTimeout(toastTimer);
  const ic: IconName = kind === "success" ? "check" : kind === "error" ? "alert" : "info";
  const node = h("div", { class: `Toast Toast--${kind}`, role: "status" }, h("span", { class: "Toast-icon" }, icon(ic)), h("span", { class: "Toast-content" }, text));
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3000);
}

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function send<T>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg).catch((e: Error) => ({ ok: false, error: { message: e.message } }) as T);
}
