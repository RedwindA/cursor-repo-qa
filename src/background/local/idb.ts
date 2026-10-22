// 后台用的 IndexedDB：仓库快照（zip）、分支 → commit 的短期缓存、本地 agent 的会话记录。
// 快照和会话可能很大，它们的大小和最后使用时间另存在 meta 里，清理时只扫 meta。
const DB_NAME = "repo-qa";
const DB_VERSION = 1;

export type StoreName = "snapshots" | "refs" | "sessions" | "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["snapshots", "refs", "sessions", "meta"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  return wrap<T | undefined>(db.transaction(store).objectStore(store).get(key));
}

export async function idbPut<T extends { key: string }>(store: StoreName, value: T): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, "readwrite").objectStore(store).put(value));
}

export async function idbDelete(store: StoreName, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  for (const k of keys) tx.objectStore(store).delete(k);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return wrap<T[]>(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}

// ---------- 大记录的元数据和 LRU 清理 ----------

interface Meta {
  key: string; // `${store}:${id}`
  store: StoreName;
  id: string;
  size: number;
  lastUsed: number;
}

export async function touch(store: StoreName, id: string, size?: number): Promise<void> {
  const key = `${store}:${id}`;
  const old = await idbGet<Meta>("meta", key);
  await idbPut<Meta>("meta", { key, store, id, size: size ?? old?.size ?? 0, lastUsed: Date.now() });
}

/** 按最后使用时间淘汰，直到总大小不超过 maxBytes、条数不超过 maxCount */
export async function evict(store: StoreName, { maxBytes = Infinity, maxCount = Infinity }: { maxBytes?: number; maxCount?: number }): Promise<void> {
  const metas = (await idbAll<Meta>("meta")).filter((m) => m.store === store).sort((a, b) => b.lastUsed - a.lastUsed);
  let total = 0;
  const drop: Meta[] = [];
  metas.forEach((m, i) => {
    total += m.size;
    if (i >= maxCount || (i > 0 && total > maxBytes)) drop.push(m);
  });
  await idbDelete(store, drop.map((m) => m.id));
  await idbDelete("meta", drop.map((m) => m.key));
}

export async function forget(store: StoreName, id: string): Promise<void> {
  await idbDelete(store, [id]);
  await idbDelete("meta", [`${store}:${id}`]);
}
