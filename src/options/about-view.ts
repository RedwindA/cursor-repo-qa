// 「使用说明」
import { h, icon } from "../shared/dom";
import type { IconName } from "../shared/octicons";
import { externalLink, subhead } from "./ui";

const tip = (ic: IconName, title: string, body: string) =>
  h("div", { class: "Box-row tip" }, h("span", { class: "tip-icon" }, icon(ic)), h("div", null, h("div", { class: "tip-title" }, title), h("div", { class: "tip-body" }, body)));

export function aboutView(): HTMLElement {
  return h(
    "div",
    { class: "about" },
    subhead("使用说明"),
    h(
      "div",
      { class: "Box" },
      tip("comment-discussion", "在仓库页面提问", "打开任意 GitHub 公开仓库，点右下角的圆形按钮。提问时会把你当前所在的页面地址一起发给 agent，正在看某个文件时可以直接问“解释一下这个文件”。"),
      tip("clock", "第一次会慢一些", "第一次提问要启动云端环境并克隆仓库，通常要等几十秒；同一段会话里的追问会复用这个 agent，不用重新克隆。"),
      tip("history", "会话会保存在本机", "点浮窗的“＋”开新会话，旧会话不会丢：浮窗的历史按钮可以切回去，“聊天记录”页可以搜索、导出和删除。刷新页面后，没跑完的回答会自动接着读。"),
      tip("screen-full", "调整浮窗", "拖动浮窗左上角调整大小，或用头部的放大按钮临时放大。按 Esc 关闭浮窗。"),
    ),
    subhead("注意事项"),
    h(
      "ul",
      { class: "notes" },
      h("li", null, "只支持公开仓库：agent 用匿名 git clone 拉代码，私有仓库会克隆失败。"),
      h("li", null, "每次提问都会在 Cursor 云端运行 agent，按 Cloud Agent 计费，消耗你的 Cursor 额度。每个回答下方会显示用了多少 tokens。"),
      h("li", null, "agent 被要求只读：不修改文件、不提交、不开 PR（创建时也关闭了 autoCreatePR）。"),
      h("li", null, "API key 只保存在本机（chrome.storage.local，不同步），只在扩展后台使用，不会注入到 GitHub 页面。"),
    ),
    subhead("相关链接"),
    h(
      "ul",
      { class: "notes" },
      h("li", null, externalLink("https://cursor.com/dashboard/api", "Cursor Dashboard · API Keys")),
      h("li", null, externalLink("https://cursor.com/dashboard", "Cursor Dashboard · 用量与账单")),
    ),
  );
}
