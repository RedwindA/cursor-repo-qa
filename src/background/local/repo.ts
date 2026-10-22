// 仓库快照：下载 GitHub 的 zip 包，在内存里当作只读文件系统给 agent 用。
//
// - 公开仓库直接从 codeload.github.com 下载，不调 GitHub API（没有每小时 60 次的限额）。
//   zip 的注释就是 commit SHA（git archive 的行为），所以下载完就知道具体版本。
// - 填了 GitHub token 时走 api.github.com 的 zipball，私有仓库也能读。
// - zip 原样缓存在 IndexedDB（按 commit 区分，超过容量按最近使用淘汰），同一 commit 不重复下载。
//   打开时只解析 zip 的目录，文件用到时才解压，所以 service worker 被回收后重新打开也很快。
// - 仓库太大（zip 超过上限）时退回“远程模式”：目录树用 Git Trees API，文件按需读取。
//   目录树同样按 commit 缓存，并记住这个仓库太大，之后不再尝试下载 zip。
import { inflateSync, unzipSync } from "fflate";
import type { RepoRef } from "../../shared/types";
import { evict, idbGet, idbPut, touch } from "./idb";

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const CACHE_MAX_BYTES = 512 * 1024 * 1024;
/** 超过这个大小的文件只列出，不解压、不搜索 */
export const MAX_FILE_BYTES = 1024 * 1024;
const REF_TTL = 10 * 60 * 1000;
/** 记住“这个仓库太大”多久，期间直接用远程模式 */
const TOO_BIG_TTL = 7 * 24 * 3600 * 1000;

export class RepoError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface FileEntry {
  path: string;
  size: number;
}

/** agent 工具看到的仓库 */
export interface RepoFS {
  readonly repo: RepoRef;
  readonly sha: string;
  /** 远程模式：grep 不可用或受限 */
  readonly remote: boolean;
  files(): FileEntry[];
  /** 读文本文件；不存在抛 RepoError，二进制或太大返回 null */
  readText(path: string, signal?: AbortSignal): Promise<string | null>;
}

const repoId = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase();
const encodeRef = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");

export function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

const decoder = new TextDecoder();

// ---------- zip 快照 ----------

/** zip 里的一个文件：读取时再解压 */
interface ZipEntry {
  size: number;
  /** 已解压的内容；还没解压时是 zip 里的位置 */
  data?: Uint8Array;
  method?: number;
  csize?: number;
  offset?: number;
}

class ZipFS implements RepoFS {
  readonly remote = false;
  private entries: FileEntry[];

  constructor(
    readonly repo: RepoRef,
    readonly sha: string,
    private zip: Uint8Array,
    private index: Map<string, ZipEntry>,
  ) {
    this.entries = [...index].map(([path, e]) => ({ path, size: e.size })).sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  files(): FileEntry[] {
    return this.entries;
  }

  private bytes(e: ZipEntry): Uint8Array {
    if (e.data) return e.data;
    const z = this.zip;
    const at = e.offset!;
    // 本地文件头：30 字节固定部分 + 文件名 + 扩展字段，之后是数据
    const start = at + 30 + (z[at + 26] | (z[at + 27] << 8)) + (z[at + 28] | (z[at + 29] << 8));
    const raw = z.subarray(start, start + e.csize!);
    e.data = e.method === 0 ? raw : inflateSync(raw, { out: new Uint8Array(e.size) });
    return e.data;
  }

  async readText(path: string): Promise<string | null> {
    const e = this.index.get(path);
    if (!e) throw new RepoError("not_found", `文件不存在：${path}`);
    if (e.size > MAX_FILE_BYTES) return null;
    const bytes = this.bytes(e);
    return isBinary(bytes) ? null : decoder.decode(bytes);
  }
}

const stripRoot = (name: string) => name.slice(name.indexOf("/") + 1);

/** 读 zip 的中央目录建立索引（不解压）；遇到 zip64 等不支持的格式返回 null */
function indexZip(zip: Uint8Array): Map<string, ZipEntry> | null {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) return null;
  const index = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const offset = dv.getUint32(p + 42, true);
    if (csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff || (method !== 0 && method !== 8)) return null;
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (!name.endsWith("/")) index.set(stripRoot(name), { size, method, csize, offset });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  index.delete("");
  return index;
}

function openZip(repo: RepoRef, sha: string, zip: Uint8Array): ZipFS {
  const index = indexZip(zip);
  if (index) return new ZipFS(repo, sha, zip, index);
  // 不常见的 zip 格式：整包解压
  const eager = new Map<string, ZipEntry>();
  const unzipped = unzipSync(zip, {
    filter: (f) => {
      if (f.name.endsWith("/")) return false;
      eager.set(stripRoot(f.name), { size: f.originalSize });
      return f.originalSize <= MAX_FILE_BYTES;
    },
  });
  for (const [name, bytes] of Object.entries(unzipped)) eager.get(stripRoot(name))!.data = bytes;
  eager.delete("");
  return new ZipFS(repo, sha, zip, eager);
}

/** zip 末尾的 End of Central Directory 里的注释 */
function zipComment(zip: Uint8Array): string {
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      const len = zip[i + 20] | (zip[i + 21] << 8);
      return decoder.decode(zip.subarray(i + 22, i + 22 + len)).trim();
    }
  }
  return "";
}

function ghHeaders(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return token ? { Accept: accept, Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } : { Accept: accept };
}

/** 下载 zip；超过上限返回 null */
async function downloadZip(repo: RepoRef, ref: string, token: string, signal: AbortSignal): Promise<Uint8Array | null> {
  const url = token
    ? `https://api.github.com/repos/${repo.owner}/${repo.name}/zipball/${encodeRef(ref)}`
    : `https://codeload.github.com/${repo.owner}/${repo.name}/zip/${encodeRef(ref)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: token ? ghHeaders(token) : {}, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new RepoError("network", "无法连接 GitHub 下载仓库代码：" + (e as Error).message);
  }
  if (res.status === 404) throw new RepoError("not_found", "404");
  if (res.status === 401) throw new RepoError("github_auth", "GitHub token 无效或已过期，请到设置里检查。");
  if (res.status === 403 || res.status === 429) throw new RepoError("rate_limited", "GitHub 拒绝了下载请求（可能触发了限额），稍后再试，或在设置里填 GitHub token。");
  if (!res.ok || !res.body) throw new RepoError("download", `下载仓库代码失败（HTTP ${res.status}）`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_ZIP_BYTES) {
    res.body.cancel().catch(() => {});
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ZIP_BYTES) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---------- 远程模式（大仓库） ----------

class RemoteFS implements RepoFS {
  readonly remote = true;
  private cache = new Map<string, string | null>();

  constructor(
    readonly repo: RepoRef,
    readonly sha: string,
    private entries: FileEntry[],
    private token: string,
    readonly truncated: boolean,
  ) {}

  files(): FileEntry[] {
    return this.entries;
  }

  async readText(path: string, signal?: AbortSignal): Promise<string | null> {
    if (this.cache.has(path)) return this.cache.get(path)!;
    const entry = this.entries.find((e) => e.path === path);
    if (!entry && !this.truncated) throw new RepoError("not_found", `文件不存在：${path}`);
    if (entry && entry.size > MAX_FILE_BYTES) return null;
    const { owner, name } = this.repo;
    const url = this.token
      ? `https://api.github.com/repos/${owner}/${name}/contents/${encodeRef(path)}?ref=${this.sha}`
      : `https://raw.githubusercontent.com/${owner}/${name}/${this.sha}/${encodeRef(path)}`;
    const res = await fetch(url, { headers: this.token ? ghHeaders(this.token, "application/vnd.github.raw") : {}, signal });
    if (res.status === 404) throw new RepoError("not_found", `文件不存在：${path}`);
    if (!res.ok) throw new RepoError("download", `读取 ${path} 失败（HTTP ${res.status}）`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = isBinary(bytes) ? null : decoder.decode(bytes);
    this.cache.set(path, text);
    return text;
  }
}

async function githubApi<T>(path: string, token: string, signal: AbortSignal, accept?: string): Promise<T> {
  const res = await fetch("https://api.github.com" + path, { headers: ghHeaders(token, accept), signal });
  if (res.status === 404 || res.status === 422) throw new RepoError("not_found", "404");
  if (res.status === 403 || res.status === 429) throw new RepoError("rate_limited", "GitHub API 达到限额（未登录每小时 60 次），在设置里填 GitHub token 可以提高限额。");
  if (!res.ok) throw new RepoError("github", `GitHub API 出错（HTTP ${res.status}）`);
  return (accept === "application/vnd.github.sha" ? await res.text() : await res.json()) as T;
}

async function openRemote(repo: RepoRef, ref: string, token: string, signal: AbortSignal): Promise<RemoteFS> {
  const base = `/repos/${repo.owner}/${repo.name}`;
  const sha = (await githubApi<string>(`${base}/commits/${encodeRef(ref)}`, token, signal, "application/vnd.github.sha")).trim();
  const tree = await githubApi<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(`${base}/git/trees/${sha}?recursive=1`, token, signal);
  const entries = tree.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size || 0 }));
  return new RemoteFS(repo, sha, entries, token, tree.truncated);
}

// ---------- 对外接口 ----------

/** zip 快照，或大仓库的目录树 */
type SnapshotRecord = { key: string; zip: Uint8Array } | { key: string; tree: FileEntry[]; truncated: boolean };

interface RefRecord {
  key: string;
  sha: string;
  ts: number;
}

/** 最近用过的快照留在内存里（service worker 被回收后从 IndexedDB 重新打开） */
const memory = new Map<string, RepoFS>();
const remember = (fs: RepoFS) => {
  const key = `${repoId(fs.repo)}@${fs.sha}`;
  memory.delete(key);
  memory.set(key, fs);
  while (memory.size > 3) memory.delete(memory.keys().next().value!);
  return fs;
};

export interface OpenResult {
  fs: RepoFS;
  /** 页面上的分支没找到、改用默认分支时的说明 */
  note?: string;
}

/** 从页面地址猜要看的版本：/tree/<ref>/…、/blob/<ref>/…、/commit/<sha>。分支名可能带 /，按段数依次尝试 */
export function refCandidates(repo: RepoRef, pageUrl: string): string[] {
  let path = "";
  try {
    path = decodeURIComponent(new URL(pageUrl).pathname);
  } catch {
    return [];
  }
  const parts = path.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() !== repo.owner.toLowerCase() || parts[1]?.toLowerCase() !== repo.name.toLowerCase()) return [];
  const kind = parts[2];
  const rest = parts.slice(3);
  if (!rest.length) return [];
  if (kind === "commit" && /^[0-9a-f]{7,40}$/i.test(rest[0])) return [rest[0]];
  if (!["tree", "blob", "blame", "raw", "commits"].includes(kind)) return [];
  return [1, 2, 3].filter((n) => n <= rest.length).map((n) => rest.slice(0, n).join("/"));
}

async function cacheRemote(id: string, ref: string, known: string | null, fs: RemoteFS): Promise<void> {
  try {
    const key = `${id}@${fs.sha}`;
    await idbPut<SnapshotRecord>("snapshots", { key, tree: fs.files(), truncated: fs.truncated });
    await touch("snapshots", key, fs.files().length * 64);
    if (!known) await idbPut<RefRecord>("refs", { key: `${id}@${ref}`, sha: fs.sha, ts: Date.now() });
    await idbPut<RefRecord>("refs", { key: `${id}#too-big`, sha: "", ts: Date.now() });
  } catch {
    /* 缓存失败不影响这次使用 */
  }
}

async function openRef(repo: RepoRef, ref: string, token: string, signal: AbortSignal, onDownload?: () => void): Promise<RepoFS> {
  const id = repoId(repo);
  // 同一个分支 10 分钟内直接用上次的 commit
  const known = /^[0-9a-f]{40}$/i.test(ref) ? ref.toLowerCase() : null;
  const cachedRef = known ? null : await idbGet<RefRecord>("refs", `${id}@${ref}`).catch(() => undefined);
  const sha = known || (cachedRef && Date.now() - cachedRef.ts < REF_TTL ? cachedRef.sha : null);
  if (sha) {
    const fs = await openSha(repo, sha, token);
    if (fs) return fs;
  }

  onDownload?.();
  // 之前发现这个仓库太大：不再下载 zip，直接用远程模式
  const tooBig = await idbGet<RefRecord>("refs", `${id}#too-big`).catch(() => undefined);
  const zip = tooBig && Date.now() - tooBig.ts < TOO_BIG_TTL ? null : await downloadZip(repo, ref, token, signal);
  if (!zip) {
    const fs = await openRemote(repo, ref, token, signal);
    await cacheRemote(id, ref, known, fs);
    return remember(fs);
  }
  const zipSha = zipComment(zip).toLowerCase();
  const realSha = /^[0-9a-f]{40}$/.test(zipSha) ? zipSha : known || ref;
  const fs = openZip(repo, realSha, zip);
  try {
    await idbPut<SnapshotRecord>("snapshots", { key: `${id}@${realSha}`, zip });
    await touch("snapshots", `${id}@${realSha}`, zip.length);
    if (!known) await idbPut<RefRecord>("refs", { key: `${id}@${ref}`, sha: realSha, ts: Date.now() });
    await evict("snapshots", { maxBytes: CACHE_MAX_BYTES });
  } catch {
    /* 缓存失败不影响这次使用 */
  }
  return remember(fs);
}

/** 按 commit 打开：内存 → IndexedDB；都没有返回 null */
export async function openSha(repo: RepoRef, sha: string, token: string): Promise<RepoFS | null> {
  const key = `${repoId(repo)}@${sha}`;
  const inMem = memory.get(key);
  if (inMem) return remember(inMem);
  const rec = await idbGet<SnapshotRecord>("snapshots", key).catch(() => undefined);
  if (!rec) return null;
  touch("snapshots", key).catch(() => {});
  return remember("zip" in rec ? openZip(repo, sha, rec.zip) : new RemoteFS(repo, sha, rec.tree, token, rec.truncated));
}

/**
 * 打开仓库：pinnedSha 是会话之前用过的 commit（追问时沿用）；否则按页面地址找分支，找不到就用默认分支。
 */
export async function openRepo(
  repo: RepoRef,
  opts: { pageUrl: string; pinnedSha?: string; token: string; signal: AbortSignal; onDownload?: () => void },
): Promise<OpenResult> {
  const { pageUrl, pinnedSha, token, signal, onDownload } = opts;
  if (pinnedSha) {
    const fs = (await openSha(repo, pinnedSha, token)) || (await openRef(repo, pinnedSha, token, signal, onDownload).catch(() => null));
    if (fs) return { fs };
  }
  const candidates = refCandidates(repo, pageUrl);
  for (const ref of candidates) {
    try {
      return { fs: await openRef(repo, ref, token, signal, onDownload) };
    } catch (e) {
      if (!(e instanceof RepoError) || e.code !== "not_found") throw e;
    }
  }
  try {
    const fs = await openRef(repo, "HEAD", token, signal, onDownload);
    return { fs, note: candidates.length ? `页面上的分支（${candidates[0]}）没找到，用的是默认分支。` : undefined };
  } catch (e) {
    if (e instanceof RepoError && e.code === "not_found") {
      throw new RepoError(
        "repo_not_found",
        token ? "找不到这个仓库：可能不存在，或者 GitHub token 没有它的读取权限。" : "下载不到这个仓库的代码：它可能是私有仓库。读私有仓库需要在设置里填 GitHub token。",
      );
    }
    throw e;
  }
}
