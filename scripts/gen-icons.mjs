// 从 @primer/octicons 抽取用到的图标，生成 src/shared/octicons.ts（只打包需要的 SVG path）
import { readFileSync, writeFileSync } from "node:fs";

const NAMES = {
  16: [
    "alert", "archive", "arrow-down", "arrow-left", "check", "check-circle", "chevron-down", "chevron-right", "clock",
    "comment-discussion", "copy", "download", "eye", "eye-closed", "file", "file-directory", "gear", "globe",
    "history", "info", "key", "kebab-horizontal", "link-external", "mark-github", "paper-airplane", "plus",
    "repo", "search", "sparkle-fill", "square-fill", "stop", "sync", "terminal", "tools", "trash", "x", "x-circle",
    "screen-full", "screen-normal", "cpu", "comment", "pencil", "server",
  ],
  24: ["comment-discussion", "history", "key", "sparkle-fill"],
};

const data = JSON.parse(readFileSync(new URL("../node_modules/@primer/octicons/build/data.json", import.meta.url), "utf8"));
const out = {};
for (const [size, names] of Object.entries(NAMES)) {
  for (const name of names) {
    const icon = data[name]?.heights?.[size];
    if (!icon) throw new Error(`octicon not found: ${name} @${size}`);
    out[`${name}${size === "16" ? "" : "-" + size}`] = { w: icon.width, h: Number(size), d: icon.path };
  }
}

const body = Object.entries(out)
  .map(([k, v]) => `  ${JSON.stringify(k)}: { w: ${v.w}, h: ${v.h}, d: ${JSON.stringify(v.d)} },`)
  .join("\n");
writeFileSync(
  new URL("../src/shared/octicons.ts", import.meta.url),
  `// 由 scripts/gen-icons.mjs 生成，不要手改。图标来自 Primer Octicons（MIT）。\n\nexport const OCTICONS = {\n${body}\n} as const;\n\nexport type IconName = keyof typeof OCTICONS;\n`,
);
console.log(`wrote ${Object.keys(out).length} icons`);
