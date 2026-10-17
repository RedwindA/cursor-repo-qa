// 极简 DOM 构造工具
import { OCTICONS, type IconName } from "./octicons";

type Child = Node | string | number | null | undefined | false;
type Handler = (e: never) => void;
export type Props = {
  class?: string;
  dataset?: Record<string, string>;
  style?: string;
  [attr: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = String(v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v as Handler as EventListener);
      else if (k in node && typeof v !== "string") (node as unknown as Record<string, unknown>)[k] = v;
      else node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(node, ...children);
  return node;
}

export function append(node: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

const svgCache = new Map<string, SVGSVGElement>();

/** Octicon 图标。size 16 / 24 */
export function icon(name: IconName, cls = ""): SVGSVGElement {
  let tpl = svgCache.get(name);
  if (!tpl) {
    const o = OCTICONS[name];
    const t = document.createElement("template");
    t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.w} ${o.h}" width="${o.w}" height="${o.h}" fill="currentColor" aria-hidden="true" focusable="false">${o.d}</svg>`;
    tpl = t.content.firstChild as SVGSVGElement;
    svgCache.set(name, tpl);
  }
  const n = tpl.cloneNode(true) as SVGSVGElement;
  n.setAttribute("class", `octicon octicon-${name}${cls ? " " + cls : ""}`);
  return n;
}

/** Primer 风格的加载圈 */
export function spinner(size = 16): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="spinner" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" vector-effect="non-scaling-stroke"></circle><path d="M15 8a7.002 7.002 0 00-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"></path></svg>`;
  return t.content.firstChild as SVGSVGElement;
}

/** 阻止键盘事件冒泡到宿主页面（GitHub 有很多单键快捷键） */
export function isolateKeys(node: HTMLElement): void {
  for (const t of ["keydown", "keyup", "keypress"]) node.addEventListener(t, (e) => e.stopPropagation());
}
