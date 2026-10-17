# Cursor 仓库问答（Chrome 扩展）

在任意 GitHub 公开仓库页面右下角点开浮窗提问，扩展会调用 Cursor Cloud Agents API 启动一个**无仓库 agent**，由它在云端 `git clone` 当前仓库、阅读代码，再把回答流式显示在浮窗里。

## 安装

1. 解压这个文件夹到一个固定位置（之后不要删除或移动）。
2. Chrome 打开 `chrome://extensions`，打开右上角“开发者模式”。
3. 点“加载已解压的扩展程序”，选择解压出来的文件夹。
4. 安装后会自动打开设置页：粘贴 Cursor User API Key（在 https://cursor.com/dashboard/api 创建），点“保存并测试”。
5. 打开任意 GitHub 仓库页面，右下角会出现圆形按钮。

Edge、Brave 等 Chromium 内核浏览器同样适用（需要 Chrome 116 及以上内核）。

## 使用

- 第一次提问会新建一个云端 agent（启动环境 + 克隆，通常要等几十秒）。
- 同一仓库的追问会复用这个 agent，不用重新克隆，速度更快。
- 提问时会把你当前所在的页面地址一起发给 agent。比如你正在看某个文件，可以直接问“解释一下这个文件”。
- 浮窗里“＋”是开新对话（会归档旧的云端 agent），齿轮是设置，红色方块按钮是停止。
- 对话按仓库保存在本机；刷新页面或切到别的仓库再回来，记录还在，没跑完的回答会自动接着读。
- 左上角可以拖动调整浮窗大小。

## 设置项

- **模型**：留空就用你在 Cursor 里的默认模型。只是读代码回答问题，选便宜的模型更省额度。
- **回答语言**：简体中文 / English / 跟随提问语言。

## 注意

- 只支持公开仓库。agent 是匿名克隆的，私有仓库会失败（浮窗会提示）。
- 每次提问都会运行一个 Cloud Agent，按 Cloud Agent 计费，消耗你的 Cursor 额度。浮窗会显示每次回答用了多少 tokens。
- agent 被要求只读：不修改文件、不提交、不开 PR（创建时也关闭了 `autoCreatePR`）。
- API key 只保存在本机（`chrome.storage.local`，不同步），只在后台脚本里使用，不会注入到 GitHub 页面。User API Key 对账号有管理员级权限，不要把装好 key 的浏览器配置或扩展分享给别人。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 扩展配置（Manifest V3） |
| `background.js` | 调用 Cursor API、读取 SSE 流、断线重连、轮询兜底 |
| `content.js` / `panel.css` | GitHub 页面里的浮窗（Shadow DOM，不影响页面样式） |
| `options.html` / `options.js` | 设置页 |
| `lib/marked.umd.js` | Markdown 解析（marked，MIT） |
| `lib/purify.min.js` | HTML 清洗（DOMPurify，Apache-2.0 / MPL-2.0） |

用到的接口：`POST /v1/agents`（不传 `repos`）、`POST /v1/agents/{id}/runs`、`GET .../runs/{runId}/stream`、`GET .../runs/{runId}`、`POST .../cancel`、`GET /v1/agents/{id}/usage`、`POST /v1/agents/{id}/archive`、`GET /v1/me`、`GET /v1/models`。
