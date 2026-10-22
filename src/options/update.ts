// 检查新版本：读 dist 分支上的 manifest.json（raw.githubusercontent.com，不占 GitHub API 限额）
const DIST_MANIFEST = "https://raw.githubusercontent.com/RedwindA/repo-qa/dist/manifest.json";

export const REPO_URL = "https://github.com/RedwindA/repo-qa";
export const currentVersion = () => chrome.runtime.getManifest().version;

let pending: Promise<string | null> | null = null;

/** dist 分支上的版本号；取不到返回 null */
export function latestVersion(): Promise<string | null> {
  pending ??= fetch(DIST_MANIFEST, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (typeof j?.version === "string" ? j.version : null))
    .catch(() => null);
  return pending;
}

/** a 是否比 b 新（按 x.y.z 逐段比较） */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}
