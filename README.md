# GitHub 仓库问答（Chrome 扩展）

在任意 GitHub 仓库页面右下角点开浮窗提问，由 agent 阅读当前仓库的代码，把回答流式显示在浮窗里。有两种回答方式：

- **本地 agent（默认）**：扩展下载仓库的 zip 包，在浏览器里运行 agent（基于 [pi](https://github.com/earendil-works/pi) 的 `pi-agent-core` / `pi-ai`），调用你自己配置的模型服务（OpenAI 兼容接口或 Anthropic 接口）。不需要服务器，也不需要沙箱：agent 只有 `ls` / `find` / `grep` / `read` 四个只读工具，作用在内存里的代码快照上。
- **Cursor Cloud Agent**：调用 Cursor Cloud Agents API 启动一个**无仓库 agent**，由它在云端 `git clone` 当前仓库、阅读代码后回答。

界面按 GitHub 的 Primer 设计系统实现：浮窗在 GitHub 页面上直接继承 GitHub 自己的主题变量（浅色、深色、高对比度等主题都会跟随），设置页和聊天记录页也是 GitHub Settings 的布局。

## 安装

1. 到 [Releases](https://github.com/RedwindA/cursor-repo-qa/releases/latest) 下载最新的 `cursor-repo-qa-vX.Y.Z.zip` 并解压。
2. Chrome 打开 `chrome://extensions`，打开右上角“开发者模式”。
3. 点“加载已解压的扩展程序”，选择解压出来的文件夹（里面直接有 `manifest.json`）。
4. 安装后会自动打开设置页：
   - 本地 agent：点“添加模型服务”，选一个预设（OpenAI、Anthropic、DeepSeek、OpenRouter、Kimi、智谱、通义千问、硅基流动、Gemini、Ollama）或自定义地址，填 API key，点“保存并测试”。浏览器会询问是否允许扩展访问这个地址，选允许。然后在“模型”里选一个模型。
   - Cursor Cloud Agent：在“回答方式”里切换过去，粘贴 Cursor User API Key（在 https://cursor.com/dashboard/api 创建），点“保存并测试”。
5. 打开任意 GitHub 仓库页面，右下角会出现圆形按钮。

Edge、Brave 等 Chromium 内核浏览器同样适用（需要 Chrome 116 及以上内核）。

升级：下载新版 zip 解压覆盖原来的文件夹，然后在 `chrome://extensions` 点扩展的“重新加载”。从 1.0 升级时，旧的问答记录会自动迁移到聊天记录里。

想自己构建（需要 Node.js 20 及以上）：`npm install && npm run build`，然后加载 `dist/` 目录。

## 使用

- 本地 agent：第一次提问会下载仓库代码（按页面上的分支或 commit，找不到就用默认分支），一般几秒内就开始回答。同一段会话的追问沿用同一个 commit 和完整的对话记录（包括之前读过的代码）。
- Cursor：第一次提问会新建一个云端 agent（启动环境 + 克隆，通常要等几十秒）；同一段会话里的追问会复用这个 agent。
- 提问时会把你当前所在的页面地址一起发给 agent。比如你正在看某个文件，可以直接问“解释一下这个文件”。
- 输入框左下角可以直接切换模型（支持筛选）。本地 agent 换模型后可以接着追问，不会丢上下文（OpenAI 兼容和 Anthropic 的模型之间也可以互换）；Cursor 的云端会话创建后不能换模型，切换后下一个问题会新开云端会话，并带上最近的对话。
- 浮窗头部按钮：历史会话、新会话、在 Cursor 中打开、放大、设置、关闭。输入框里运行中的按钮可以停止回答。
- 刷新页面或切到别的仓库再回来，记录还在，没跑完的回答会自动接着读。拖动浮窗左上角可以调整大小。

## 聊天记录

- 每段会话都保存在本机（`chrome.storage.local`）。点“新会话”不会删除旧会话，浮窗的历史按钮可以切回去。
- 扩展图标 → “聊天记录”页可以按仓库筛选、全文搜索、查看完整会话、导出 Markdown、删除单段会话。
- “在 GitHub 中继续”会打开对应仓库并在浮窗里接着这段会话提问（云端 agent 已归档时会自动新建，并带上最近的对话）。
- 支持把全部记录导出 / 导入为 JSON。

## 设置项

- **回答方式**：本地 agent / Cursor Cloud Agent。两种方式的模型选择分开保存。
- **模型服务**（本地 agent）：可以添加多个，浮窗里在它们的模型之间切换。服务不支持列出模型时，可以手动填写模型 id。上下文长度、价格等信息从 pi 自带的模型目录里按服务地址和模型 id 查找，查到了就会在回答下方显示估算费用。
- **GitHub token**（本地 agent，可选）：读私有仓库时需要，建议用只给相应仓库 Contents 只读权限的 fine-grained token。
- **模型**：本地 agent 必须选一个；Cursor 留空就用你在 Cursor 里的默认模型。只是读代码回答问题，选便宜的模型更省额度。
- **回答语言**：简体中文 / English / 跟随提问语言。

## 本地 agent 的工作方式

- 公开仓库直接从 `codeload.github.com` 下载 zip，不调用 GitHub API，所以没有未登录每小时 60 次的限额。zip 的注释就是 commit SHA，回答里的代码链接都指向这个 commit。填了 GitHub token 时改走 `api.github.com` 的 zipball。
- 下载的 zip 按 commit 缓存在扩展的 IndexedDB 里（最多 512 MB，按最近使用淘汰），10 分钟内同一分支、以及同一会话的追问都不会重复下载。不需要手动清理。
- zip 超过 80 MB 的大仓库退回“远程模式”：目录树用 Git Trees API 获取，文件按需从 `raw.githubusercontent.com` 读取，这时 `grep` 不可用（会占用 GitHub API 限额，建议填 token）。
- 单个文件超过 1 MB 只列出、不读取；一次回答最多 40 次工具调用；上下文太长时会把较早的工具输出替换成占位文字。
- 回答在扩展的后台进程里运行，刷新页面或关掉浮窗都不会中断，回来后接着显示。会话记录（含工具调用）保存在 IndexedDB，最多保留最近 100 段；点“新会话”会删除旧会话的这份记录（浮窗里的聊天记录不受影响）。

## 注意

- 本地 agent 按你自己的模型服务计费，回答下方会显示 tokens 和（能查到价格时的）估算费用。Cursor 方式按 Cloud Agent 计费，消耗你的 Cursor 额度。
- Cursor 方式只支持公开仓库（agent 是匿名克隆的）；本地 agent 填了 GitHub token 就能读私有仓库。
- 两种方式的 agent 都是只读的：本地 agent 只有读文件的工具；Cursor 的 agent 被要求不修改文件、不提交、不开 PR（创建时也关闭了 `autoCreatePR`）。
- API key 和 token 只保存在本机（`chrome.storage.local`，不同步），只在后台脚本里使用，不会注入到 GitHub 页面。Cursor 的 User API Key 对账号有管理员级权限，不要把装好 key 的浏览器配置或扩展分享给别人。

## 开发

```bash
npm run watch      # 监听修改并增量构建到 dist/
npm run typecheck  # TypeScript 类型检查
npm run icons      # 重新生成用到的 Octicons
```

发布新版本：`npm version patch --no-git-tag-version`（或 `minor` / `major`），把改过的 `package.json` 和 `package-lock.json` 合进 `main`。GitHub Actions 发现这个版本还没有 Release，就会自动构建、打 `vX.Y.Z` 标签，并把 zip 发到 Releases。版本号没变的推送只构建，不发布。

| 路径 | 作用 |
| --- | --- |
| `src/manifest.json` | 扩展配置（Manifest V3，版本号取自 `package.json`） |
| `src/background/` | Service worker：调用 Cursor API、读取 SSE 流、断线重连、轮询兜底 |
| `src/background/local/` | 本地 agent：仓库快照（zip 下载、缓存、远程模式）、只读工具、模型服务、pi agent 运行与会话记录 |
| `src/content/` | GitHub 页面里的浮窗（Shadow DOM，不影响页面样式）和会话状态 |
| `src/options/` | 设置页、聊天记录页、使用说明 |
| `src/shared/` | 共用的类型、存储、Markdown 渲染、消息渲染、图标 |
| `src/styles/` | Primer 设计变量、基础组件、GitHub Markdown 样式 |
| `scripts/build.mjs` | esbuild 构建脚本 |

依赖：[pi-agent-core / pi-ai](https://github.com/earendil-works/pi)（MIT，版本固定，升级前先看更新日志）、[fflate](https://github.com/101arrowz/fflate)（MIT）、[marked](https://github.com/markedjs/marked)（MIT）、[DOMPurify](https://github.com/cure53/DOMPurify)（Apache-2.0 / MPL-2.0）、[highlight.js](https://github.com/highlightjs/highlight.js)（BSD-3-Clause）、[Primer Octicons](https://github.com/primer/octicons)（MIT）。

Cursor 方式用到的接口：`POST /v1/agents`（不传 `repos`）、`POST /v1/agents/{id}/runs`、`GET .../runs/{runId}/stream`、`GET .../runs/{runId}`、`POST .../cancel`、`GET /v1/agents/{id}/usage`、`POST /v1/agents/{id}/archive`、`GET /v1/me`、`GET /v1/models`。
