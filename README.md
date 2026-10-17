# Cursor 仓库问答（Chrome 扩展）

在任意 GitHub 公开仓库页面右下角点开浮窗提问，扩展会调用 Cursor Cloud Agents API 启动一个**无仓库 agent**，由它在云端 `git clone` 当前仓库、阅读代码，再把回答流式显示在浮窗里。

界面按 GitHub 的 Primer 设计系统实现：浮窗在 GitHub 页面上直接继承 GitHub 自己的主题变量（浅色、深色、高对比度等主题都会跟随），设置页和聊天记录页也是 GitHub Settings 的布局。

## 安装

需要 Node.js 20 及以上。

```bash
npm install
npm run build
```

1. Chrome 打开 `chrome://extensions`，打开右上角“开发者模式”。
2. 点“加载已解压的扩展程序”，选择构建出来的 `dist/` 目录。
3. 安装后会自动打开设置页：粘贴 Cursor User API Key（在 https://cursor.com/dashboard/api 创建），点“保存并测试”。
4. 打开任意 GitHub 仓库页面，右下角会出现圆形按钮。

也可以在 GitHub Actions 的 `build` 任务里直接下载构建好的 `dist/`。Edge、Brave 等 Chromium 内核浏览器同样适用（需要 Chrome 116 及以上内核）。

从 1.0 升级：重新构建后在 `chrome://extensions` 点扩展的“重新加载”，旧的问答记录会自动迁移到聊天记录里。

## 使用

- 第一次提问会新建一个云端 agent（启动环境 + 克隆，通常要等几十秒）；同一段会话里的追问会复用这个 agent。
- 提问时会把你当前所在的页面地址一起发给 agent。比如你正在看某个文件，可以直接问“解释一下这个文件”。
- 浮窗头部按钮：历史会话、新会话、在 Cursor 中打开、放大、设置、关闭。输入框里运行中的按钮可以停止回答。
- 刷新页面或切到别的仓库再回来，记录还在，没跑完的回答会自动接着读。拖动浮窗左上角可以调整大小。

## 聊天记录

- 每段会话都保存在本机（`chrome.storage.local`）。点“新会话”不会删除旧会话，浮窗的历史按钮可以切回去。
- 扩展图标 → “聊天记录”页可以按仓库筛选、全文搜索、查看完整会话、导出 Markdown、删除单段会话。
- “在 GitHub 中继续”会打开对应仓库并在浮窗里接着这段会话提问（云端 agent 已归档时会自动新建，并带上最近的对话）。
- 支持把全部记录导出 / 导入为 JSON。

## 设置项

- **模型**：留空就用你在 Cursor 里的默认模型。只是读代码回答问题，选便宜的模型更省额度。
- **回答语言**：简体中文 / English / 跟随提问语言。

## 注意

- 只支持公开仓库。agent 是匿名克隆的，私有仓库会失败（浮窗会提示）。
- 每次提问都会运行一个 Cloud Agent，按 Cloud Agent 计费，消耗你的 Cursor 额度。浮窗会显示每次回答用了多少 tokens。
- agent 被要求只读：不修改文件、不提交、不开 PR（创建时也关闭了 `autoCreatePR`）。
- API key 只保存在本机（`chrome.storage.local`，不同步），只在后台脚本里调用 API，不会注入到 GitHub 页面。User API Key 对账号有管理员级权限，不要把装好 key 的浏览器配置或扩展分享给别人。

## 开发

```bash
npm run watch      # 监听修改并增量构建到 dist/
npm run typecheck  # TypeScript 类型检查
npm run icons      # 重新生成用到的 Octicons
```

| 路径 | 作用 |
| --- | --- |
| `src/manifest.json` | 扩展配置（Manifest V3，版本号取自 `package.json`） |
| `src/background/` | Service worker：调用 Cursor API、读取 SSE 流、断线重连、轮询兜底 |
| `src/content/` | GitHub 页面里的浮窗（Shadow DOM，不影响页面样式）和会话状态 |
| `src/options/` | 设置页、聊天记录页、使用说明 |
| `src/shared/` | 共用的类型、存储、Markdown 渲染、消息渲染、图标 |
| `src/styles/` | Primer 设计变量、基础组件、GitHub Markdown 样式 |
| `scripts/build.mjs` | esbuild 构建脚本 |

依赖：[marked](https://github.com/markedjs/marked)（MIT）、[DOMPurify](https://github.com/cure53/DOMPurify)（Apache-2.0 / MPL-2.0）、[highlight.js](https://github.com/highlightjs/highlight.js)（BSD-3-Clause）、[Primer Octicons](https://github.com/primer/octicons)（MIT）。

用到的接口：`POST /v1/agents`（不传 `repos`）、`POST /v1/agents/{id}/runs`、`GET .../runs/{runId}/stream`、`GET .../runs/{runId}`、`POST .../cancel`、`GET /v1/agents/{id}/usage`、`POST /v1/agents/{id}/archive`、`GET /v1/me`、`GET /v1/models`。
