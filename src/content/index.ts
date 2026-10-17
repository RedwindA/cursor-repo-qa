// Cursor 仓库问答 —— GitHub 页面上的浮窗
import { Panel } from "./panel";
import { detectRepo } from "./repo";
import { Session } from "./session";

declare global {
  interface Window {
    __cursorRepoQA?: boolean;
  }
}

const OPEN_HASH = "#cursor-repo-qa";

if (!window.__cursorRepoQA) {
  window.__cursorRepoQA = true;

  let panel: Panel | null = null;
  const session = new Session({
    onChange: (repoKey, msgIndex) => panel?.onChange(repoKey, msgIndex),
    onRunsChange: () => panel?.refreshFab(),
  });
  panel = new Panel(session);

  // GitHub 是单页应用：地址变化时重新识别仓库
  let lastHref = "";
  const onLocationChange = async () => {
    if (!panel.host.isConnected) document.documentElement.appendChild(panel.host);
    if (location.href === lastHref) return;
    lastHref = location.href;
    const repo = detectRepo();
    await panel.setRepo(repo);
    // 从「聊天记录」页点“在 GitHub 中继续”打开：自动展开浮窗
    if (repo && location.hash === OPEN_HASH) {
      history.replaceState(history.state, "", location.pathname + location.search);
      lastHref = location.href;
      panel.toggle(true);
    }
  };

  document.addEventListener("turbo:load", onLocationChange);
  document.addEventListener("turbo:render", onLocationChange);
  document.addEventListener("pjax:end", onLocationChange);
  window.addEventListener("popstate", onLocationChange);
  setInterval(onLocationChange, 1000);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.apiKey || changes.model)) panel?.onSettingsChanged();
  });

  document.documentElement.appendChild(panel.host);
  onLocationChange();
}
