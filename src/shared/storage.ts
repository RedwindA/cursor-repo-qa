// chrome.storage.local 的读写封装
//
// 存储结构：
//   apiKey / model / language / apiBase   设置
//   panelSize                              浮窗尺寸
//   chat:<id>                              一段会话（Conversation）
//   active:<owner/name 小写>               该仓库在浮窗里当前打开的会话 id

import type { Conversation, Language, RepoRef, Settings } from "./types";

export const DEFAULT_API_BASE = "https://api.cursor.com";
export const MAX_MESSAGES = 80;

const CHAT_PREFIX = "chat:";
const ACTIVE_PREFIX = "active:";
const LEGACY_PREFIX = "conv:";

export const chatKey = (id: string) => CHAT_PREFIX + id;
export const activeKey = (repoKey: string) => ACTIVE_PREFIX + repoKey;
export const isChatKey = (k: string) => k.startsWith(CHAT_PREFIX);
export const isActiveKey = (k: string) => k.startsWith(ACTIVE_PREFIX);
export const repoKeyOf = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase();

const local = () => chrome.storage.local;

// ---------- 设置 ----------

export async function getSettings(): Promise<Settings> {
  const s = await local().get(["apiKey", "model", "language", "apiBase"]);
  return {
    apiKey: String(s.apiKey || "").trim(),
    model: String(s.model || ""),
    language: (s.language as Language) || "zh",
    apiBase: String(s.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

// ---------- 会话 ----------

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createConversation(repo: RepoRef): Conversation {
  const now = Date.now();
  return {
    id: newId(),
    repo: { owner: repo.owner, name: repo.name },
    repoKey: repoKeyOf(repo),
    title: "",
    createdAt: now,
    updatedAt: now,
    agentId: null,
    agentUrl: "",
    messages: [],
    pending: null,
  };
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? line.slice(0, 80) + "…" : line;
}

/** 规范化从存储读出的会话（兼容旧数据、缺字段） */
export function normalizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Conversation>;
  if (!c.id || !c.repo?.owner || !c.repo?.name) return null;
  const messages = Array.isArray(c.messages) ? c.messages : [];
  const firstQ = messages.find((m) => m.role === "user")?.text || "";
  return {
    id: c.id,
    repo: { owner: c.repo.owner, name: c.repo.name },
    repoKey: c.repoKey || repoKeyOf(c.repo),
    title: c.title || titleFrom(firstQ),
    createdAt: c.createdAt || messages[0]?.ts || Date.now(),
    updatedAt: c.updatedAt || messages[messages.length - 1]?.ts || Date.now(),
    agentId: c.agentId || null,
    agentUrl: c.agentUrl || "",
    messages: messages.map((m) => (m.role === "assistant" ? { ...m, activity: m.activity || [] } : m)),
    pending: c.pending || null,
  };
}

export async function getChat(id: string): Promise<Conversation | null> {
  const k = chatKey(id);
  const got = await local().get(k);
  return normalizeConversation(got[k]);
}

export async function saveChat(conv: Conversation, touch = true): Promise<void> {
  if (touch) conv.updatedAt = Date.now();
  if (!conv.title) conv.title = titleFrom(conv.messages.find((m) => m.role === "user")?.text || "");
  await local().set({ [chatKey(conv.id)]: conv });
}

export async function listChats(): Promise<Conversation[]> {
  const all = await local().get(null);
  const out: Conversation[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!isChatKey(k)) continue;
    const c = normalizeConversation(v);
    if (c && c.messages.length) out.push(c);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getActiveId(repoKey: string): Promise<string | null> {
  const k = activeKey(repoKey);
  const got = await local().get(k);
  return typeof got[k] === "string" ? (got[k] as string) : null;
}

export async function setActiveId(repoKey: string, id: string | null): Promise<void> {
  if (id) await local().set({ [activeKey(repoKey)]: id });
  else await local().remove(activeKey(repoKey));
}

export async function deleteChats(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const all = await local().get(null);
  const idSet = new Set(ids);
  const keys = ids.map(chatKey);
  for (const [k, v] of Object.entries(all)) {
    if (isActiveKey(k) && typeof v === "string" && idSet.has(v)) keys.push(k);
  }
  await local().remove(keys);
}

export async function deleteAllChats(): Promise<number> {
  const all = await local().get(null);
  const chats = Object.keys(all).filter(isChatKey);
  const keys = Object.keys(all).filter((k) => isChatKey(k) || isActiveKey(k) || k.startsWith(LEGACY_PREFIX));
  await local().remove(keys);
  return chats.length;
}

/** 1.0 版本按仓库存一份 conv:<repo>，迁移成 chat:<id> + active:<repo> */
export async function migrateLegacy(): Promise<void> {
  const all = await local().get(null);
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(LEGACY_PREFIX)) continue;
    remove.push(k);
    const old = v as { agentId?: string; agentUrl?: string; messages?: Conversation["messages"] } | undefined;
    if (!old?.messages?.length) continue;
    const repoKey = k.slice(LEGACY_PREFIX.length);
    const [owner, name] = repoKey.split("/");
    if (!owner || !name) continue;
    const conv = normalizeConversation({
      id: newId(),
      repo: { owner, name },
      repoKey,
      agentId: old.agentId || null,
      agentUrl: old.agentUrl || "",
      messages: old.messages,
      pending: null,
    });
    if (!conv) continue;
    for (const m of conv.messages) if (m.role === "assistant" && m.status === "running") m.status = "cancelled";
    set[chatKey(conv.id)] = conv;
    set[activeKey(repoKey)] = conv.id;
  }
  if (Object.keys(set).length) await local().set(set);
  if (remove.length) await local().remove(remove);
}
