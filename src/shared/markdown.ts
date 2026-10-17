// Markdown 渲染：marked 解析 → DOMPurify 清洗 → highlight.js 着色（配色用 GitHub 的 prettylights 变量）
import DOMPurify from "dompurify";
import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { h, icon } from "./dom";

const LANGS = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, python, ruby, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);
hljs.registerAliases(["sh", "shell", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["toml"], { languageName: "ini" });
hljs.registerAliases(["vue", "svelte"], { languageName: "xml" });

const marked = new Marked({ gfm: true, breaks: false });

let hooked = false;
function sanitize(html: string): DocumentFragment {
  if (!hooked) {
    // 链接一律新标签页打开
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"], RETURN_DOM_FRAGMENT: true });
}

export interface RenderOptions {
  /** 代码高亮（流式输出时关掉，结束后再开） */
  highlight?: boolean;
}

/** 渲染成 .markdown-body 节点；代码块带复制按钮（点击由调用方用 bindCodeCopy 统一处理） */
export function renderMarkdown(text: string, opts: RenderOptions = {}): HTMLElement {
  const body = h("div", { class: "markdown-body" });
  body.appendChild(sanitize(marked.parse(text || "", { async: false })));

  for (const pre of Array.from(body.querySelectorAll("pre"))) {
    const code = pre.querySelector("code");
    if (opts.highlight && code) {
      const lang = /language-([\w+#-]+)/.exec(code.className)?.[1]?.toLowerCase();
      if (lang && hljs.getLanguage(lang)) {
        try {
          code.innerHTML = hljs.highlight(code.textContent || "", { language: lang, ignoreIllegals: true }).value;
        } catch { /* 保持纯文本 */ }
      }
    }
    const box = h("div", { class: "highlight" });
    pre.replaceWith(box);
    box.append(
      pre,
      h("button", { type: "button", class: "code-copy btn-octicon", title: "复制代码", "aria-label": "复制代码" }, icon("copy"), icon("check", "copied-icon")),
    );
  }
  for (const table of Array.from(body.querySelectorAll("table"))) {
    const wrap = h("div", { class: "table-wrap" });
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
  return body;
}

/** 在容器上委托处理代码块复制 */
export function bindCodeCopy(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest?.(".code-copy");
    if (!btn) return;
    const code = btn.parentElement?.querySelector("pre")?.textContent || "";
    copyText(code).then((ok) => flashCopied(btn as HTMLElement, ok));
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function flashCopied(btn: HTMLElement, ok = true): void {
  if (!ok) return;
  btn.classList.add("copied");
  const prev = btn.title;
  btn.title = "已复制";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.title = prev;
  }, 1500);
}
