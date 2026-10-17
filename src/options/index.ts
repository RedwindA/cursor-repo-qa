// 设置页 / 聊天记录页（扩展自己的页面）
import { h, icon } from "../shared/dom";
import type { IconName } from "../shared/octicons";
import { isChatKey, listChats } from "../shared/storage";
import { aboutView } from "./about-view";
import { HistoryView } from "./history-view";
import { settingsView } from "./settings-view";

// 尽早设置主题，避免闪烁（脚本在 <head> 里同步执行）
const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => (document.documentElement.dataset.theme = dark.matches ? "dark" : "light");
applyTheme();
dark.addEventListener("change", applyTheme);

type ViewName = "settings" | "history" | "about";

const NAV: { view: ViewName; label: string; icon: IconName }[] = [
  { view: "settings", label: "通用设置", icon: "gear" },
  { view: "history", label: "聊天记录", icon: "history" },
  { view: "about", label: "使用说明", icon: "info" },
];

const TITLES: Record<ViewName, string> = { settings: "设置", history: "聊天记录", about: "使用说明" };

function parseHash(): { view: ViewName; id?: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const [view, id] = path.split("/");
  const params = new URLSearchParams(query);
  if (view === "history") return { view, id: id ? decodeURIComponent(id) : undefined, params };
  if (view === "about") return { view, params };
  return { view: "settings", params };
}

function boot() {
  const main = h("main", { class: "layout-main", id: "main" });
  const crumb = h("strong");
  const counter = h("span", { class: "Counter", hidden: true });
  const navItems = new Map<ViewName, HTMLAnchorElement>();

  const nav = h("nav", { class: "navlist", "aria-label": "设置" });
  for (const n of NAV) {
    const a = h("a", { class: "navlist-item", href: `#/${n.view}` }, icon(n.icon), h("span", { class: "navlist-label" }, n.label), n.view === "history" ? counter : null);
    navItems.set(n.view, a);
    nav.appendChild(a);
  }

  document.body.append(
    h(
      "header",
      { class: "app-header" },
      h("a", { class: "app-logo", href: "#/settings", "aria-label": "Cursor 仓库问答" }, h("img", { src: "icons/icon32.png", width: 32, height: 32, alt: "" })),
      h("div", { class: "app-crumbs" }, h("span", { class: "app-name" }, "Cursor 仓库问答"), h("span", { class: "app-sep" }, "/"), crumb),
      h("a", { class: "btn-octicon", href: "https://cursor.com/dashboard", target: "_blank", rel: "noopener noreferrer", title: "打开 Cursor Dashboard", "aria-label": "打开 Cursor Dashboard" }, icon("link-external")),
    ),
    h(
      "div",
      { class: "layout" },
      h(
        "aside",
        { class: "layout-sidebar" },
        h(
          "div",
          { class: "sidebar-profile" },
          h("img", { src: "icons/icon48.png", width: 40, height: 40, alt: "" }),
          h("div", null, h("div", { class: "sidebar-title" }, "Cursor 仓库问答"), h("div", { class: "f6 color-fg-muted" }, `版本 ${chrome.runtime.getManifest().version}`)),
        ),
        nav,
      ),
      main,
    ),
  );

  const views: Partial<Record<ViewName, HTMLElement>> = {};
  let history: HistoryView | null = null;
  let current: ViewName | null = null;

  const route = () => {
    const r = parseHash();
    for (const [v, a] of navItems) {
      if (v === r.view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    crumb.textContent = TITLES[r.view];
    document.title = `${TITLES[r.view]} · Cursor 仓库问答`;
    document.body.dataset.view = r.view;

    if (r.view === "history") {
      history ??= new HistoryView((hash) => (location.hash = hash));
      views.history = history.el;
      history.show({ id: r.id, repo: r.params.get("repo") || undefined });
    } else {
      views[r.view] ??= r.view === "settings" ? settingsView() : aboutView();
    }
    if (current !== r.view) {
      main.replaceChildren(views[r.view]!);
      window.scrollTo(0, 0);
      current = r.view;
    }
  };
  window.addEventListener("hashchange", route);
  route();

  const refreshCount = async () => {
    const n = (await listChats()).length;
    counter.textContent = String(n);
    counter.hidden = !n;
  };
  refreshCount();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some(isChatKey)) refreshCount();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
