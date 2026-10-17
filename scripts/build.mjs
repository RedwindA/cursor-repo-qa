// 构建扩展到 dist/：node scripts/build.mjs [--watch]
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 用 fileURLToPath / path.join 处理路径，Windows 上才不会出现 /I:/... 这样的路径
const root = fileURLToPath(new URL("..", import.meta.url));
const at = (...p) => join(root, ...p);
const out = at("dist");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));

// `import css from "./x.css?inline"`：把 CSS（含 @import）打包、压缩成字符串
const inlineCss = {
  name: "inline-css",
  setup(build) {
    build.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?inline$/, "")),
      namespace: "inline-css",
    }));
    build.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => {
      const r = await esbuild.build({ entryPoints: [args.path], bundle: true, minify: true, write: false, metafile: true, logLevel: "silent" });
      return { contents: r.outputFiles[0].text, loader: "text", watchFiles: Object.keys(r.metafile.inputs).map((f) => resolve(f)) };
    });
  },
};

function copyStatic() {
  mkdirSync(out, { recursive: true });
  cpSync(at("public"), out, { recursive: true });
  const manifest = JSON.parse(readFileSync(at("src", "manifest.json"), "utf8"));
  manifest.version = pkg.version;
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
}

const options = {
  entryPoints: {
    background: at("src", "background", "index.ts"),
    content: at("src", "content", "index.ts"),
    options: at("src", "options", "index.ts"),
    "options-style": at("src", "options", "options.css"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome116",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "external",
  charset: "utf8",
  logLevel: "info",
  plugins: [inlineCss, { name: "static", setup: (b) => b.onEnd(copyStatic) }],
};

rmSync(out, { recursive: true, force: true });
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
