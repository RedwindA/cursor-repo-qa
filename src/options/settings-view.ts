// 「通用设置」：API key、模型、回答语言
import { h, icon } from "../shared/dom";
import type { Language, Me, ModelInfo, RuntimeResponse } from "../shared/types";
import { InlineMessage, externalLink, send, subhead, toast } from "./ui";

const LANGS: { value: Language; label: string; desc: string }[] = [
  { value: "zh", label: "简体中文", desc: "无论用什么语言提问，都用中文回答。" },
  { value: "en", label: "English", desc: "Always answer in English." },
  { value: "auto", label: "跟随提问语言", desc: "用和问题相同的语言回答。" },
];

export function settingsView(): HTMLElement {
  const root = h("div", { class: "settings" });

  // ---------- API key ----------

  const keyInput = h("input", {
    id: "apiKey",
    type: "password",
    class: "form-control mono",
    placeholder: "crsr_…",
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": "apiKey-caption",
  });
  const toggle = h("button", { type: "button", class: "btn-octicon sm input-trailing", title: "显示", "aria-label": "显示 key" }, icon("eye"));
  toggle.addEventListener("click", () => {
    const show = keyInput.type === "password";
    keyInput.type = show ? "text" : "password";
    toggle.replaceChildren(icon(show ? "eye-closed" : "eye"));
    toggle.title = show ? "隐藏" : "显示";
  });
  const saveBtn = h("button", { type: "button", class: "btn btn-primary" }, "保存并测试");
  const clearBtn = h("button", { type: "button", class: "btn btn-danger" }, "移除 key");
  const keyMsg = new InlineMessage();
  const account = h("div", { class: "Box account", hidden: true });

  function showAccount(me: Me | null) {
    account.hidden = !me;
    if (!me) return;
    const who = me.userEmail || me.apiKeyName || "已连接";
    account.replaceChildren(
      h(
        "div",
        { class: "Box-row account-row" },
        h("span", { class: "account-icon" }, icon("key")),
        h("div", { class: "account-text" }, h("div", { class: "account-name" }, who), me.apiKeyName && me.userEmail ? h("div", { class: "f6 color-fg-muted" }, `Key：${me.apiKeyName}`) : null),
        h("span", { class: "Label Label--success" }, icon("check"), "已连接"),
      ),
    );
  }

  saveBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) {
      keyMsg.set("请先粘贴 API key。", "error");
      keyInput.focus();
      return;
    }
    saveBtn.disabled = true;
    keyMsg.set("正在测试连接…", "", "sync");
    const res = await send<RuntimeResponse<{ me: Me }>>({ type: "testKey", apiKey: key });
    saveBtn.disabled = false;
    if (!res?.ok) {
      keyMsg.set(`测试失败：${res?.error?.message || "未知错误"}（key 没有保存）`, "error");
      return;
    }
    await chrome.storage.local.set({ apiKey: key });
    keyMsg.set("已保存，连接正常。", "success");
    showAccount(res.me || {});
    toast("API key 已保存");
    loadModels();
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove("apiKey");
    keyInput.value = "";
    showAccount(null);
    keyMsg.set("已移除 API key。", "");
  });

  root.append(
    subhead("Cursor API key", {
      desc: h(
        "span",
        null,
        "在 ",
        externalLink("https://cursor.com/dashboard/api", "Cursor Dashboard → API Keys"),
        " 创建 User API Key，粘贴到这里。key 只保存在这台电脑的浏览器里，不会同步。",
      ),
    }),
    h(
      "div",
      { class: "form-group" },
      h("label", { class: "form-label", for: "apiKey" }, "API key"),
      h("div", { class: "input-wrap" }, keyInput, toggle),
      h("p", { class: "form-caption", id: "apiKey-caption" }, "以 crsr_ 开头。User API Key 对你的 Cursor 账号有管理员级权限，不要分享给别人。"),
      keyMsg.el,
    ),
    account,
    h("div", { class: "form-actions" }, saveBtn, clearBtn),
  );

  // ---------- 模型 ----------

  const modelSel = h("select", { id: "model", class: "form-control" }, new Option("默认（跟随 Cursor 设置）", ""));
  const reloadBtn = h("button", { type: "button", class: "btn" }, icon("sync"), "刷新列表");
  const modelMsg = new InlineMessage();

  async function loadModels() {
    const { apiKey, model } = await chrome.storage.local.get(["apiKey", "model"]);
    const selected = String(model || "");
    if (!apiKey) {
      modelMsg.set("先填写并保存 API key，才能获取模型列表。", "warn");
      return;
    }
    reloadBtn.disabled = true;
    modelMsg.set("正在获取模型列表…", "", "sync");
    const res = await send<RuntimeResponse<{ models: ModelInfo[] }>>({ type: "listModels" });
    reloadBtn.disabled = false;
    if (!res?.ok) {
      modelMsg.set(res?.error?.message || "获取失败", "error");
      return;
    }
    modelSel.replaceChildren(new Option("默认（跟随 Cursor 设置）", ""));
    for (const m of res.models) modelSel.add(new Option(m.displayName === m.id ? m.id : `${m.displayName}（${m.id}）`, m.id));
    if (selected && !res.models.some((m) => m.id === selected)) modelSel.add(new Option(`${selected}（当前设置，已不在列表中）`, selected));
    modelSel.value = selected;
    modelMsg.set(`共 ${res.models.length} 个可用模型。`, "");
  }

  reloadBtn.addEventListener("click", () => loadModels());
  modelSel.addEventListener("change", async () => {
    await chrome.storage.local.set({ model: modelSel.value });
    toast(modelSel.value ? `已切换到 ${modelSel.value}` : "已改为默认模型");
  });

  root.append(
    subhead("模型", { desc: "留空就用你在 Cursor 里设置的默认模型。只是读代码回答问题，选便宜一点的模型更省额度。" }),
    h(
      "div",
      { class: "form-group" },
      h("label", { class: "form-label", for: "model" }, "回答问题使用的模型"),
      h("div", { class: "input-row" }, h("div", { class: "select-wrap grow" }, modelSel, icon("chevron-down")), reloadBtn),
      modelMsg.el,
    ),
  );

  // ---------- 回答语言 ----------

  const radios = h("fieldset", { class: "radio-group" }, h("legend", { class: "sr-only" }, "回答语言"));
  for (const l of LANGS) {
    const id = `lang-${l.value}`;
    radios.appendChild(
      h(
        "div",
        { class: "radio-item" },
        h("input", { type: "radio", name: "lang", id, value: l.value }),
        h("label", { for: id }, h("span", { class: "radio-label" }, l.label), h("span", { class: "form-caption" }, l.desc)),
      ),
    );
  }
  radios.addEventListener("change", async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name !== "lang") return;
    await chrome.storage.local.set({ language: t.value });
    toast("回答语言已保存");
  });

  root.append(subhead("回答语言"), radios);

  // ---------- 初始值 ----------

  (async () => {
    const s = await chrome.storage.local.get(["apiKey", "model", "language"]);
    keyInput.value = String(s.apiKey || "");
    const lang = String(s.language || "zh");
    for (const r of radios.querySelectorAll<HTMLInputElement>('input[name="lang"]')) r.checked = r.value === lang;
    if (s.model) {
      modelSel.add(new Option(String(s.model), String(s.model)));
      modelSel.value = String(s.model);
    }
    if (s.apiKey) {
      loadModels();
      const res = await send<RuntimeResponse<{ me: Me }>>({ type: "testKey" });
      if (res?.ok) showAccount(res.me || {});
      else keyMsg.set(`当前 key 无法使用：${res?.error?.message || "未知错误"}`, "error");
    } else {
      keyMsg.set("还没有设置 API key。", "warn");
      modelMsg.set("先填写并保存 API key，才能获取模型列表。", "warn");
    }
  })();

  return root;
}
