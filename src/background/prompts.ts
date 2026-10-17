// 发给 agent 的提示词
import type { HistoryItem, Language, RepoRef } from "../shared/types";

function languageInstruction(lang: Language): string {
  if (lang === "en") return "answer in English";
  if (lang === "auto") return "使用与用户提问相同的语言回答";
  return "使用简体中文回答";
}

const repoDir = (repo: RepoRef) => `~/repo-src/${repo.owner}__${repo.name}`;

export function firstPrompt(repo: RepoRef, question: string, pageUrl: string, lang: Language, history: HistoryItem[] | null): string {
  const cloneUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
  const lines = [
    `你是一个只读的代码问答助手。用户正在 GitHub 上浏览仓库 ${repo.owner}/${repo.name}，想了解它的代码。`,
    ``,
    `准备工作：`,
    `- 如果环境里还没有这个仓库，运行：git clone --depth 1 ${cloneUrl} ${repoDir(repo)}`,
    `- 克隆失败（比如仓库是私有的、地址无效）时，直接告诉用户原因，不要编造答案。`,
    `- 用 git -C ${repoDir(repo)} rev-parse HEAD 取得 commit SHA，引用代码时使用。`,
    ``,
    `规则：`,
    `- 只读：不要修改、创建或删除仓库里的文件，不要 commit、push，不要建分支或 PR。`,
    `- 以实际读到的代码为依据回答，不确定就说明不确定。`,
    `- 引用代码位置时给出 GitHub 链接，格式：https://github.com/${repo.owner}/${repo.name}/blob/<commit SHA>/<路径>#L<起始行>-L<结束行>`,
    `- 用 Markdown 回答，${languageInstruction(lang)}。直接给结论，不用复述你执行了哪些命令。`,
    ``,
    `用户当前所在页面：${pageUrl}`,
    `（如果页面指向某个分支、文件或目录，优先结合它回答；如果是非默认分支，可以 git fetch --depth 1 origin <分支> 后再看。）`,
  ];
  if (history?.length) {
    lines.push(``, `之前的对话（供参考，可能已截断）：`);
    for (const h of history) lines.push(`${h.role === "user" ? "用户" : "助手"}：${h.text}`);
  }
  lines.push(``, `用户的问题：`, question);
  return lines.join("\n");
}

export function followUpPrompt(repo: RepoRef, question: string, pageUrl: string, lang: Language): string {
  return [
    `（这是对仓库 ${repo.owner}/${repo.name} 的追问。仓库应已克隆在 ${repoDir(repo)}，如果不存在就按之前的方式重新克隆。规则不变：只读，引用代码给 GitHub 链接，${languageInstruction(lang)}。）`,
    `用户当前所在页面：${pageUrl}`,
    ``,
    `用户的问题：`,
    question,
  ].join("\n");
}
