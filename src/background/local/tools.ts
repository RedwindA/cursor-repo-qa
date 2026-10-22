// 给 agent 的只读工具：ls / find / grep / read，都作用在内存里的仓库快照上
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import { MAX_FILE_BYTES, RepoError, type FileEntry, type RepoFS } from "./repo";

const MAX_OUTPUT = 40_000;
const MAX_LINE = 400;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], details: {} });

export function normPath(p: string | undefined): string {
  return (p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/^\.$/, "")
    .replace(/\/+$/, "");
}

const under = (path: string, dir: string) => !dir || path === dir || path.startsWith(dir + "/");
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const clip = (line: string) => (line.length > MAX_LINE ? line.slice(0, MAX_LINE) + " …（行太长，已截断）" : line);

/** glob → 正则：支持 **、*、?、{a,b} */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) re += "\\{";
      else {
        re += "(?:" + glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|") + ")";
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "i");
}

/** 不带 / 的模式匹配文件名，带 / 的匹配完整路径 */
function globMatcher(glob: string): (path: string) => boolean {
  const re = globToRegExp(glob);
  return glob.includes("/") ? (p) => re.test(p) : (p) => re.test(p.slice(p.lastIndexOf("/") + 1));
}

function checkDir(fs: RepoFS, dir: string): void {
  if (dir && !fs.files().some((f) => under(f.path, dir))) throw new RepoError("not_found", `路径不存在：${dir}`);
}

// ---------- ls ----------

export function listDir(fs: RepoFS, rawPath?: string): string {
  const dir = normPath(rawPath);
  checkDir(fs, dir);
  const prefix = dir ? dir + "/" : "";
  const dirs = new Map<string, number>();
  const files: FileEntry[] = [];
  for (const f of fs.files()) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) files.push({ path: rest, size: f.size });
    else dirs.set(rest.slice(0, slash), (dirs.get(rest.slice(0, slash)) || 0) + 1);
  }
  if (!dirs.size && !files.length) return `${dir} 是一个文件，不是目录，请用 read 读取。`;
  const lines = [
    ...[...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => `${d}/  （${n} 个文件）`),
    ...files.sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}  ${fmtSize(f.size)}`),
  ];
  const shown = lines.slice(0, 400);
  return `${dir || "（仓库根目录）"}：\n${shown.join("\n")}${lines.length > shown.length ? `\n… 还有 ${lines.length - shown.length} 项未列出` : ""}`;
}

// ---------- find ----------

export function findFiles(fs: RepoFS, pattern: string, rawPath?: string): string {
  const dir = normPath(rawPath);
  checkDir(fs, dir);
  const match = globMatcher(pattern.trim() || "*");
  const hits = fs.files().filter((f) => under(f.path, dir) && match(dir ? f.path.slice(dir.length + 1) : f.path));
  if (!hits.length) return `没有匹配 ${pattern} 的文件。`;
  const shown = hits.slice(0, 200).map((f) => f.path);
  return shown.join("\n") + (hits.length > shown.length ? `\n… 共 ${hits.length} 个，只列出前 ${shown.length} 个，可以缩小范围再找` : "");
}

// ---------- grep ----------

export interface GrepOptions {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  context?: number;
}

export async function grep(fs: RepoFS, opts: GrepOptions, signal?: AbortSignal): Promise<string> {
  if (fs.remote) throw new RepoError("unsupported", "这个仓库太大，没有下载完整代码，grep 不可用。请用 find 按文件名查找，再用 read 读取文件。");
  const dir = normPath(opts.path);
  checkDir(fs, dir);
  let re: RegExp;
  let note = "";
  try {
    re = new RegExp(opts.pattern, opts.ignoreCase ? "i" : "");
  } catch {
    re = new RegExp(opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.ignoreCase ? "i" : "");
    note = "（pattern 不是合法的正则，已按普通文本搜索）\n";
  }
  // 先对整个文件判断一次（加 m，让 ^ $ 按行匹配），命中再逐行找
  const reFile = new RegExp(re.source, re.flags + "m");
  const match = opts.glob ? globMatcher(opts.glob) : () => true;
  const ctx = Math.max(0, Math.min(5, opts.context || 0));
  const out: string[] = [];
  let size = 0;
  let total = 0;
  let filesHit = 0;
  let truncated = false;
  for (const f of fs.files()) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (!under(f.path, dir) || !match(f.path) || f.size > MAX_FILE_BYTES) continue;
    const content = await fs.readText(f.path);
    if (content == null || !reFile.test(content)) continue;
    filesHit++;
    const lines = content.split(/\r?\n/);
    let perFile = 0;
    let lastPrinted = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      total++;
      if (truncated || perFile >= 30) continue;
      perFile++;
      if (ctx && lastPrinted >= 0 && i - ctx > lastPrinted + 1) out.push("--");
      for (let j = Math.max(i - ctx, lastPrinted + 1); j <= Math.min(lines.length - 1, i + ctx); j++) {
        const line = `${f.path}${j === i ? ":" : "-"}${j + 1}${j === i ? ":" : "-"} ${clip(lines[j])}`;
        out.push(line);
        size += line.length + 1;
        lastPrinted = j;
      }
      if (size > MAX_OUTPUT || out.length > 300) truncated = true;
    }
  }
  if (!total) return note + `没有找到匹配 ${opts.pattern} 的内容。`;
  return note + out.join("\n") + (truncated ? `\n… 结果太多已截断（${filesHit} 个文件共 ${total} 处匹配），请缩小 path / glob 或换更具体的 pattern` : "");
}

// ---------- read ----------

export async function readFile(fs: RepoFS, rawPath: string, offset = 1, limit = 300, signal?: AbortSignal): Promise<string> {
  const path = normPath(rawPath);
  const content = await fs.readText(path, signal);
  if (content == null) {
    const size = fs.files().find((f) => f.path === path)?.size;
    return `${path} 是二进制文件或太大${size ? `（${fmtSize(size)}）` : ""}，无法读取。`;
  }
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, Math.floor(offset));
  if (start > lines.length) return `${path} 只有 ${lines.length} 行。`;
  const end = Math.min(lines.length, start + Math.max(1, Math.min(1000, Math.floor(limit))) - 1);
  const width = String(end).length;
  const body: string[] = [];
  let size = 0;
  let last = start - 1;
  for (let i = start; i <= end; i++) {
    const line = `${String(i).padStart(width)}\t${clip(lines[i - 1])}`;
    if (size + line.length > MAX_OUTPUT && i > start) break;
    body.push(line);
    size += line.length + 1;
    last = i;
  }
  const head = `${path}（共 ${lines.length} 行，显示第 ${start}-${last} 行）`;
  const more = last < lines.length ? `\n… 还有 ${lines.length - last} 行，用 offset=${last + 1} 继续读` : "";
  return `${head}\n${body.join("\n")}${more}`;
}

// ---------- 工具定义 ----------

function tool<S extends TSchema>(def: AgentTool<S>): AgentTool<S> {
  return def;
}

export function repoTools(fs: RepoFS): AgentTool<TSchema>[] {
  const lsParams = Type.Object({ path: Type.Optional(Type.String({ description: "目录路径，相对仓库根目录" })) });
  const findParams = Type.Object({
    pattern: Type.String({ description: "glob 模式" }),
    path: Type.Optional(Type.String({ description: "只在这个目录下查找" })),
  });
  const grepParams = Type.Object({
    pattern: Type.String({ description: "正则表达式" }),
    path: Type.Optional(Type.String({ description: "只搜索这个目录或文件" })),
    glob: Type.Optional(Type.String({ description: "文件名 glob 过滤，如 *.ts" })),
    ignore_case: Type.Optional(Type.Boolean({ description: "忽略大小写" })),
    context: Type.Optional(Type.Integer({ description: "每处匹配前后显示的行数（0-5）" })),
  });
  const readParams = Type.Object({
    path: Type.String({ description: "文件路径，相对仓库根目录" }),
    offset: Type.Optional(Type.Integer({ description: "起始行号（从 1 开始）" })),
    limit: Type.Optional(Type.Integer({ description: "最多读多少行（最多 1000）" })),
  });
  return [
    tool({
      name: "ls",
      label: "目录",
      description: "列出仓库里某个目录的直接子项（子目录带文件数，文件带大小）。path 相对仓库根目录，留空表示根目录。",
      parameters: lsParams,
      execute: async (_id, p: Static<typeof lsParams>) => text(listDir(fs, p.path)),
    }),
    tool({
      name: "find",
      label: "查找文件",
      description: "按 glob 查找文件路径，例如 *.ts、src/**/*.test.js、{README,CONTRIBUTING}.md。不含 / 的模式匹配文件名，含 / 的匹配相对 path 的完整路径。",
      parameters: findParams,
      execute: async (_id, p: Static<typeof findParams>) => text(findFiles(fs, p.pattern, p.path)),
    }),
    tool({
      name: "grep",
      label: "搜索",
      description: "在仓库文件内容里按正则（JavaScript 语法）搜索，返回 路径:行号: 内容。可以用 path 限定目录或文件，用 glob 过滤文件名（如 *.py）。",
      parameters: grepParams,
      execute: async (_id, p: Static<typeof grepParams>, signal) =>
        text(await grep(fs, { pattern: p.pattern, path: p.path, glob: p.glob, ignoreCase: p.ignore_case, context: p.context }, signal)),
    }),
    tool({
      name: "read",
      label: "读取",
      description: "读取文件内容，带行号。默认从第 1 行读 300 行，长文件用 offset / limit 分段读。",
      parameters: readParams,
      execute: async (_id, p: Static<typeof readParams>, signal) => text(await readFile(fs, p.path, p.offset, p.limit, signal)),
    }),
  ] as AgentTool<TSchema>[];
}
