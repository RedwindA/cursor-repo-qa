// 「通用设置」：回答方式（本地 agent / Cursor）、模型服务、GitHub token、Cursor API key、模型、回答语言
import { h, icon } from "../shared/dom";
import { getBackend, modelCacheKey, modelKey, newId, normalizeProviders } from "../shared/storage";
import type { Backend, Language, LlmProvider, Me, ModelInfo, ProviderKind, RuntimeResponse } from "../shared/types";
import { InlineMessage, confirmDialog, externalLink, send, subhead, toast } from "./ui";

const LANGS: { value: Language; label: string; desc: string }[] = [
  { value: "zh", label: "简体中文", desc: "无论用什么语言提问，都用中文回答。" },
  { value: "en", label: "English", desc: "Always answer in English." },
  { value: "auto", label: "跟随提问语言", desc: "用和问题相同的语言回答。" },
];

const BACKENDS: { value: Backend; label: string; desc: string }[] = [
  {
    value: "local",
    label: "本地 agent（自带模型 API）",
    desc: "扩展下载仓库代码，在浏览器里运行 agent，调用你配置的模型服务（OpenAI 兼容或 Anthropic 接口）。不需要服务器，按你自己的 API 用量计费。",
  },
  { value: "cursor", label: "Cursor Cloud Agent", desc: "由 Cursor 在云端克隆仓库并回答，需要 Cursor User API Key，消耗 Cursor 额度。" },
];

interface Preset {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  keyUrl?: string;
}

const PRESETS: Preset[] = [
  { name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys" },
  { name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys" },
  { name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys" },
  { name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/settings/keys" },
  { name: "Kimi（月之暗面）", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  { name: "智谱 GLM", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  { name: "阿里云百炼（通义千问）", kind: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyUrl: "https://bailian.console.aliyun.com/" },
  { name: "硅基流动", kind: "openai", baseUrl: "https://api.siliconflow.cn/v1", keyUrl: "https://cloud.siliconflow.cn/account/ak" },
  { name: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey" },
  { name: "Ollama（本机）", kind: "openai", baseUrl: "http://localhost:11434/v1" },
];

const KIND_LABEL: Record<ProviderKind, string> = { openai: "OpenAI 兼容", anthropic: "Anthropic" };

function radioGroup<T extends string>(name: string, legend: string, items: { value: T; label: string; desc: string }[], onChange: (v: T) => void): HTMLFieldSetElement {
  const group = h("fieldset", { class: "radio-group" }, h("legend", { class: "sr-only" }, legend));
  for (const it of items) {
    const id = `${name}-${it.value}`;
    group.appendChild(
      h(
        "div",
        { class: "radio-item" },
        h("input", { type: "radio", name, id, value: it.value }),
        h("label", { for: id }, h("span", { class: "radio-label" }, it.label), h("span", { class: "form-caption" }, it.desc)),
      ),
    );
  }
  group.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === name) onChange(t.value as T);
  });
  return group;
}

function setRadio(group: HTMLElement, value: string): void {
  for (const r of group.querySelectorAll<HTMLInputElement>('input[type="radio"]')) r.checked = r.value === value;
}

function secretInput(id: string, placeholder: string, describedBy?: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { id, type: "password", class: "form-control mono", placeholder, autocomplete: "off", spellcheck: "false", ...(describedBy ? { "aria-describedby": describedBy } : {}) });
  const toggle = h("button", { type: "button", class: "btn-octicon sm input-trailing", title: "显示", "aria-label": "显示" }, icon("eye"));
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.replaceChildren(icon(show ? "eye-closed" : "eye"));
    toggle.title = show ? "隐藏" : "显示";
  });
  return { wrap: h("div", { class: "input-wrap" }, input, toggle), input };
}

/** 访问模型服务需要对应网站的权限（必须在点击事件里同步发起请求） */
function requestOrigin(baseUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return Promise.resolve(false);
  }
  return chrome.permissions.request({ origins: [origin + "/*"] }).catch(() => false);
}

export function settingsView(): HTMLElement {
  const root = h("div", { class: "settings" });
  let backend: Backend = "local";

  // ---------- 回答方式 ----------

  const backendRadios = radioGroup("backend", "回答方式", BACKENDS, async (v) => {
    backend = v;
    await chrome.storage.local.set({ backend: v });
    applyBackend();
    loadModels();
    toast(v === "local" ? "已切换到本地 agent" : "已切换到 Cursor Cloud Agent");
  });
  root.append(subhead("回答方式"), backendRadios);

  // ---------- 本地 agent：模型服务 ----------

  const localSection = h("div", { class: "backend-section" });
  const providerList = h("div", { class: "Box provider-list" });
  const addBtn = h("button", { type: "button", class: "btn" }, icon("plus"), "添加模型服务");
  const addRow = h("div", { class: "form-actions" }, addBtn);
  const editorSlot = h("div");
  let providers: LlmProvider[] = [];

  async function saveProviders(next: LlmProvider[]) {
    providers = next;
    const { localModel } = await chrome.storage.local.get("localModel");
    const selected = String(localModel || "");
    const keep = providers.some((p) => selected.startsWith(p.id + "/"));
    await chrome.storage.local.set({ providers });
    await chrome.storage.local.remove([modelCacheKey("local"), ...(keep ? [] : ["localModel"])]);
    renderProviders();
    loadModels();
  }

  function renderProviders() {
    providerList.hidden = !providers.length;
    providerList.replaceChildren(
      ...providers.map((p) =>
        h(
          "div",
          { class: "Box-row provider-row" },
          h("span", { class: "account-icon" }, icon("server")),
          h(
            "div",
            { class: "account-text" },
            h("div", { class: "account-name" }, p.name, " ", h("span", { class: "Label" }, KIND_LABEL[p.kind])),
            h("div", { class: "f6 color-fg-muted mono provider-url" }, p.baseUrl),
            p.models.length ? h("div", { class: "f6 color-fg-muted" }, `手动指定的模型：${p.models.join("、")}`) : null,
          ),
          h(
            "div",
            { class: "provider-actions" },
            h("button", { type: "button", class: "btn-octicon sm", title: "编辑", "aria-label": `编辑 ${p.name}`, onclick: () => openEditor(p) }, icon("pencil")),
            h(
              "button",
              {
                type: "button",
                class: "btn-octicon sm danger",
                title: "删除",
                "aria-label": `删除 ${p.name}`,
                onclick: async () => {
                  const ok = await confirmDialog({ title: `删除 ${p.name}？`, body: "这个模型服务的地址和 API key 会从本机删除。", confirm: "删除", danger: true });
                  if (ok) saveProviders(providers.filter((x) => x.id !== p.id));
                },
              },
              icon("trash"),
            ),
          ),
        ),
      ),
    );
  }

  function openEditor(existing?: LlmProvider) {
    addRow.hidden = true;
    const msg = new InlineMessage();
    const presetSel = h("select", { id: "provider-preset", class: "form-control" }, new Option("自定义", ""));
    PRESETS.forEach((p, i) => presetSel.add(new Option(p.name, String(i))));
    const nameInput = h("input", { id: "provider-name", type: "text", class: "form-control", placeholder: "例如 DeepSeek", value: existing?.name || "" });
    const kindSel = h("select", { id: "provider-kind", class: "form-control" }, new Option("OpenAI 兼容（/chat/completions）", "openai"), new Option("Anthropic（/v1/messages）", "anthropic"));
    kindSel.value = existing?.kind || "openai";
    const urlInput = h("input", { id: "provider-url", type: "url", class: "form-control mono", placeholder: "https://api.example.com/v1", value: existing?.baseUrl || "", spellcheck: "false" });
    const key = secretInput("provider-key", "sk-…");
    key.input.value = existing?.apiKey || "";
    const modelsInput = h("input", { id: "provider-models", type: "text", class: "form-control mono", placeholder: "留空则自动获取，例如 deepseek-chat, deepseek-reasoner", value: existing?.models.join(", ") || "", spellcheck: "false" });
    const keyLink = h("p", { class: "form-caption" });

    presetSel.addEventListener("change", () => {
      const p = PRESETS[Number(presetSel.value)];
      if (!presetSel.value || !p) return;
      nameInput.value = p.name;
      kindSel.value = p.kind;
      urlInput.value = p.baseUrl;
      keyLink.replaceChildren(...(p.keyUrl ? ["在 ", externalLink(p.keyUrl, p.name + " 控制台"), " 创建 API key。"] : ["本机服务一般不需要 API key。"]));
    });

    const saveBtn = h("button", { type: "button", class: "btn btn-primary" }, "保存并测试");
    const cancelBtn = h("button", { type: "button", class: "btn" }, "取消");
    const close = () => {
      editorSlot.replaceChildren();
      addRow.hidden = false;
    };
    cancelBtn.addEventListener("click", close);

    saveBtn.addEventListener("click", async () => {
      const baseUrl = urlInput.value.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^/]+/.test(baseUrl)) {
        msg.set("请填写以 https:// 或 http:// 开头的服务地址。", "error");
        urlInput.focus();
        return;
      }
      // 先申请访问这个地址的权限（需要用户点击触发）
      if (!(await requestOrigin(baseUrl))) {
        msg.set("需要允许扩展访问这个地址才能调用模型服务。", "error");
        return;
      }
      const provider: LlmProvider = normalizeProviders([
        {
          id: existing?.id || newId(),
          name: nameInput.value.trim() || new URL(baseUrl).host,
          kind: kindSel.value,
          baseUrl,
          apiKey: key.input.value.trim(),
          models: modelsInput.value.split(/[,，\s]+/).filter(Boolean),
        },
      ])[0];
      saveBtn.disabled = true;
      msg.set("正在测试连接…", "", "sync");
      const res = await send<RuntimeResponse<{ count: number }>>({ type: "testProvider", provider });
      saveBtn.disabled = false;
      if (!res?.ok) {
        msg.set(`测试失败：${res?.error?.message || "未知错误"}（没有保存）。如果这个服务不支持列出模型，可以在“模型”里手动填写模型 id。`, "error");
        return;
      }
      await saveProviders(existing ? providers.map((p) => (p.id === existing.id ? provider : p)) : [...providers, provider]);
      toast(`已保存 ${provider.name}，找到 ${res.count} 个模型`);
      close();
    });

    const field = (id: string, label: string, control: Node, caption?: Node | string) =>
      h("div", { class: "form-group" }, h("label", { class: "form-label", for: id }, label), control, caption ? (typeof caption === "string" ? h("p", { class: "form-caption" }, caption) : caption) : null);

    editorSlot.replaceChildren(
      h(
        "div",
        { class: "Box provider-editor" },
        h(
          "div",
          { class: "Box-row" },
          h("h3", { class: "provider-editor-title" }, existing ? `编辑 ${existing.name}` : "添加模型服务"),
          existing ? null : field("provider-preset", "预设", h("div", { class: "select-wrap" }, presetSel, icon("chevron-down")), "选一个常见服务自动填好地址，或者选“自定义”。"),
          field("provider-name", "名称", nameInput),
          field("provider-kind", "接口类型", h("div", { class: "select-wrap" }, kindSel, icon("chevron-down"))),
          field("provider-url", "服务地址", urlInput, "OpenAI 兼容接口一般以 /v1 结尾；Anthropic 填到域名或 /anthropic 这一级即可。"),
          h("div", { class: "form-group" }, h("label", { class: "form-label", for: "provider-key" }, "API key"), key.wrap, keyLink),
          field("provider-models", "模型（可选）", modelsInput, "用逗号分隔。服务不支持列出模型，或者只想在列表里显示几个时填写。"),
          msg.el,
          h("div", { class: "form-actions" }, saveBtn, cancelBtn),
        ),
      ),
    );
    (existing ? nameInput : presetSel).focus();
  }

  addBtn.addEventListener("click", () => openEditor());

  // GitHub token
  const gh = secretInput("githubToken", "github_pat_… 或 ghp_…", "githubToken-caption");
  const ghSave = h("button", { type: "button", class: "btn" }, "保存");
  const ghClear = h("button", { type: "button", class: "btn btn-danger" }, "移除");
  const ghMsg = new InlineMessage();
  ghSave.addEventListener("click", async () => {
    const token = gh.input.value.trim();
    if (!token) {
      ghMsg.set("请先粘贴 token。", "error");
      return;
    }
    ghSave.disabled = true;
    ghMsg.set("正在验证…", "", "sync");
    try {
      const res = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(res.status === 401 ? "token 无效或已过期" : `HTTP ${res.status}`);
      const user = await res.json();
      await chrome.storage.local.set({ githubToken: token });
      ghMsg.set(`已保存（${user.login}）。`, "success");
    } catch (e) {
      ghMsg.set(`验证失败：${(e as Error).message}（没有保存）`, "error");
    } finally {
      ghSave.disabled = false;
    }
  });
  ghClear.addEventListener("click", async () => {
    await chrome.storage.local.remove("githubToken");
    gh.input.value = "";
    ghMsg.set("已移除 GitHub token。", "");
  });

  localSection.append(
    subhead("模型服务", {
      desc: "添加一个或多个模型服务，浮窗里可以在它们的模型之间切换。地址和 key 只保存在这台电脑的浏览器里，只在扩展后台使用。",
    }),
    providerList,
    editorSlot,
    addRow,
    subhead("GitHub token（可选）", {
      desc: h(
        "span",
        null,
        "公开仓库不需要。要问私有仓库时，在 ",
        externalLink("https://github.com/settings/personal-access-tokens/new", "GitHub → Fine-grained tokens"),
        " 创建一个对相应仓库有 Contents 只读权限的 token。",
      ),
    }),
    h(
      "div",
      { class: "form-group" },
      h("label", { class: "form-label", for: "githubToken" }, "Token"),
      gh.wrap,
      h("p", { class: "form-caption", id: "githubToken-caption" }, "只用来下载仓库代码。"),
      ghMsg.el,
    ),
    h("div", { class: "form-actions" }, ghSave, ghClear),
  );

  // ---------- Cursor API key ----------

  const cursorSection = h("div", { class: "backend-section" });
  const cursorKey = secretInput("apiKey", "crsr_…", "apiKey-caption");
  const keyInput = cursorKey.input;
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

  cursorSection.append(
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
      cursorKey.wrap,
      h("p", { class: "form-caption", id: "apiKey-caption" }, "以 crsr_ 开头。User API Key 对你的 Cursor 账号有管理员级权限，不要分享给别人。"),
      keyMsg.el,
    ),
    account,
    h("div", { class: "form-actions" }, saveBtn, clearBtn),
  );

  root.append(localSection, cursorSection);

  // ---------- 模型 ----------

  const modelSel = h("select", { id: "model", class: "form-control" });
  const reloadBtn = h("button", { type: "button", class: "btn" }, icon("sync"), "刷新列表");
  const modelMsg = new InlineMessage();
  const modelDesc = h("span");
  const emptyOption = () => new Option(backend === "local" ? "（未选择）" : "默认（跟随 Cursor 设置）", "");

  async function loadModels() {
    const s = await chrome.storage.local.get(["apiKey", "providers", modelKey(backend)]);
    const selected = String(s[modelKey(backend)] || "");
    modelSel.replaceChildren(emptyOption());
    if (selected) modelSel.add(new Option(selected, selected));
    modelSel.value = selected;
    const ready = backend === "local" ? normalizeProviders(s.providers).length > 0 : !!s.apiKey;
    if (!ready) {
      modelMsg.set(backend === "local" ? "先添加模型服务，才能获取模型列表。" : "先填写并保存 API key，才能获取模型列表。", "warn");
      return;
    }
    reloadBtn.disabled = true;
    modelMsg.set("正在获取模型列表…", "", "sync");
    const requested = backend;
    const res = await send<RuntimeResponse<{ models: ModelInfo[]; warning?: string }>>({ type: "listModels" });
    reloadBtn.disabled = false;
    if (requested !== backend) return;
    if (!res?.ok) {
      modelMsg.set(res?.error?.message || "获取失败", "error");
      return;
    }
    modelSel.replaceChildren(emptyOption());
    for (const m of res.models) modelSel.add(new Option(m.detail ? `${m.displayName}（${m.detail}）` : m.displayName === m.id ? m.id : `${m.displayName}（${m.id}）`, m.id));
    if (selected && !res.models.some((m) => m.id === selected)) modelSel.add(new Option(`${selected}（当前设置，已不在列表中）`, selected));
    modelSel.value = selected;
    if (res.warning) modelMsg.set(`共 ${res.models.length} 个可用模型。部分服务获取失败：${res.warning}`, "warn");
    else modelMsg.set(`共 ${res.models.length} 个可用模型。${backend === "local" && !selected ? "请选择一个模型。" : ""}`, "");
  }

  reloadBtn.addEventListener("click", () => loadModels());
  modelSel.addEventListener("change", async () => {
    await chrome.storage.local.set({ [modelKey(backend)]: modelSel.value });
    toast(modelSel.value ? `已切换到 ${modelSel.options[modelSel.selectedIndex].text}` : "已清除模型选择");
  });

  root.append(
    subhead("模型", { desc: modelDesc }),
    h(
      "div",
      { class: "form-group" },
      h("label", { class: "form-label", for: "model" }, "回答问题使用的模型"),
      h("div", { class: "input-row" }, h("div", { class: "select-wrap grow" }, modelSel, icon("chevron-down")), reloadBtn),
      modelMsg.el,
    ),
  );

  // ---------- 回答语言 ----------

  const langRadios = radioGroup("lang", "回答语言", LANGS, async () => {
    await chrome.storage.local.set({ language: (langRadios.querySelector<HTMLInputElement>('input[name="lang"]:checked') || { value: "zh" }).value });
    toast("回答语言已保存");
  });
  root.append(subhead("回答语言"), langRadios);

  function applyBackend() {
    setRadio(backendRadios, backend);
    localSection.hidden = backend !== "local";
    cursorSection.hidden = backend !== "cursor";
    modelDesc.textContent =
      backend === "local"
        ? "读代码回答问题，便宜一些的模型通常就够用。也可以直接在浮窗输入框左下角切换，换模型不影响继续追问。"
        : "留空就用你在 Cursor 里设置的默认模型。只是读代码回答问题，选便宜一点的模型更省额度。也可以直接在浮窗输入框左下角切换。";
  }

  // 浮窗里切换了模型：同步到下拉框
  chrome.storage.onChanged.addListener((changes, area) => {
    const ch = area === "local" ? changes[modelKey(backend)] : undefined;
    if (!ch) return;
    const id = String(ch.newValue || "");
    if (id && ![...modelSel.options].some((o) => o.value === id)) modelSel.add(new Option(id, id));
    modelSel.value = id;
  });

  // ---------- 初始值 ----------

  (async () => {
    backend = await getBackend();
    applyBackend();
    const s = await chrome.storage.local.get(["apiKey", "language", "providers", "githubToken"]);
    providers = normalizeProviders(s.providers);
    renderProviders();
    if (!providers.length && backend === "local") openEditor();
    gh.input.value = String(s.githubToken || "");
    keyInput.value = String(s.apiKey || "");
    setRadio(langRadios, String(s.language || "zh"));
    loadModels();
    if (s.apiKey) {
      const res = await send<RuntimeResponse<{ me: Me }>>({ type: "testKey" });
      if (res?.ok) showAccount(res.me || {});
      else keyMsg.set(`当前 key 无法使用：${res?.error?.message || "未知错误"}`, "error");
    } else keyMsg.set("还没有设置 API key。", "warn");
  })();

  return root;
}
