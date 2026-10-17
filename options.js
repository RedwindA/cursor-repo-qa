const $ = (id) => document.getElementById(id);

function setStatus(id, text, kind) {
  const n = $(id);
  n.textContent = text || "";
  n.className = "status" + (kind ? " " + kind : "");
}

async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    return { ok: false, error: { message: e.message } };
  }
}

async function loadModels(selected) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) { setStatus("modelStatus", "先填写并保存 API key。"); return; }
  setStatus("modelStatus", "正在获取模型列表…");
  const res = await send({ type: "listModels" });
  if (!res?.ok) { setStatus("modelStatus", res?.error?.message || "获取失败", "err"); return; }
  const sel = $("model");
  sel.replaceChildren(new Option("默认（跟随 Cursor 设置）", ""));
  for (const m of res.models) sel.add(new Option(`${m.displayName}（${m.id}）`, m.id));
  if (selected && !res.models.some((m) => m.id === selected)) sel.add(new Option(`${selected}（当前设置）`, selected));
  sel.value = selected || "";
  setStatus("modelStatus", `共 ${res.models.length} 个可用模型。`, "ok");
}

async function init() {
  const s = await chrome.storage.local.get(["apiKey", "model", "language"]);
  $("apiKey").value = s.apiKey || "";
  const lang = s.language || "zh";
  for (const r of document.querySelectorAll('input[name="lang"]')) r.checked = r.value === lang;
  if (s.model) {
    $("model").add(new Option(s.model, s.model));
    $("model").value = s.model;
  }
  if (s.apiKey) loadModels(s.model);
}

$("toggleKey").addEventListener("click", () => {
  const i = $("apiKey");
  i.type = i.type === "password" ? "text" : "password";
  $("toggleKey").textContent = i.type === "password" ? "显示" : "隐藏";
});

$("saveKey").addEventListener("click", async () => {
  const key = $("apiKey").value.trim();
  if (!key) {
    await chrome.storage.local.remove("apiKey");
    setStatus("keyStatus", "已清除 API key。");
    return;
  }
  setStatus("keyStatus", "正在测试…");
  const res = await send({ type: "testKey", apiKey: key });
  if (!res?.ok) {
    setStatus("keyStatus", "测试失败：" + (res?.error?.message || "未知错误") + "（key 没有保存）", "err");
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  const me = res.me || {};
  const who = me.userEmail || me.apiKeyName || "";
  setStatus("keyStatus", "已保存，连接正常" + (who ? `：${who}` : "。"), "ok");
  const { model } = await chrome.storage.local.get("model");
  loadModels(model);
});

$("reloadModels").addEventListener("click", async () => {
  const { model } = await chrome.storage.local.get("model");
  loadModels(model);
});

$("model").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ model: e.target.value });
  setStatus("modelStatus", e.target.value ? `已选择 ${e.target.value}` : "已改为默认模型", "ok");
});

$("language").addEventListener("change", async (e) => {
  if (e.target.name === "lang") await chrome.storage.local.set({ language: e.target.value });
});

$("clearAll").addEventListener("click", async () => {
  if (!confirm("确定清空所有仓库的问答记录？（不会删除 Cursor 云端的 agent）")) return;
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("conv:"));
  await chrome.storage.local.remove(keys);
  setStatus("clearStatus", `已清空 ${keys.length} 个仓库的记录。`, "ok");
});

init();
