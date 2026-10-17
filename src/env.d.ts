// esbuild 插件：`import css from "./x.css?inline"` 得到打包后的 CSS 文本
declare module "*.css?inline" {
  const css: string;
  export default css;
}
