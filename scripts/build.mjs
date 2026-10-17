// 构建扩展到 dist/：node scripts/build.mjs [--watch]
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const out = root + "dist";
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));

// `import css from "./x.css?inline"`：把 CSS（含 @import）打包、压缩成字符串
const inlineCss = {
  name: "inline-css",
  setup(build) {
    build.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: new URL(args.path.replace(/\?inline$/, ""), "file://" + args.resolveDir + "/").pathname,
      namespace: "inline-css",
    }));
    build.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => {
      const r = await esbuild.build({ entryPoints: [args.path], bundle: true, minify: true, write: false, logLevel: "silent" });
      return { contents: r.outputFiles[0].text, loader: "text", watchFiles: Object.keys(r.metafile?.inputs || {}).concat(args.path) };
    });
  },
};

function copyStatic() {
  mkdirSync(out, { recursive: true });
  cpSync(root + "public", out, { recursive: true });
  const manifest = JSON.parse(readFileSync(root + "src/manifest.json", "utf8"));
  manifest.version = pkg.version;
  writeFileSync(out + "/manifest.json", JSON.stringify(manifest, null, 2));
}

const options = {
  entryPoints: {
    background: root + "src/background/index.ts",
    content: root + "src/content/index.ts",
    options: root + "src/options/index.ts",
    "options-style": root + "src/options/options.css",
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
