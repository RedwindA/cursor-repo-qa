// 从当前 GitHub 地址识别仓库
import type { RepoRef } from "../shared/types";

export interface CurrentRepo extends RepoRef {
  /** owner/name 小写 */
  key: string;
  isPrivate: boolean;
  /** 仓库内的路径，比如 blob/main/src/x.ts */
  subPath: string;
}

const RESERVED = new Set([
  "about", "account", "apps", "codespaces", "collections", "contact", "copilot", "customer-stories",
  "dashboard", "enterprise", "events", "explore", "features", "github-copilot", "issues", "login",
  "logout", "marketplace", "models", "new", "notifications", "orgs", "organizations", "pricing",
  "pulls", "readme", "resources", "search", "security", "sessions", "settings", "signup", "site",
  "solutions", "sponsors", "stars", "team", "topics", "trending", "users", "watching",
]);

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

export function detectRepo(): CurrentRepo | null {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, rawName] = parts;
  if (RESERVED.has(owner.toLowerCase())) return null;
  const name = rawName.replace(/\.git$/, "");
  if (!NAME_RE.test(owner) || !NAME_RE.test(name)) return null;

  const nwo = document.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-repository_nwo"]')?.content;
  if (nwo && nwo.toLowerCase() !== `${owner}/${name}`.toLowerCase()) return null;
  const pub = document.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-repository_public"]')?.content;
  return {
    owner,
    name,
    key: `${owner}/${name}`.toLowerCase(),
    isPrivate: pub === "false",
    subPath: parts.slice(2).join("/"),
  };
}
