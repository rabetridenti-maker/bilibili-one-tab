// Bilibili Single Tab v2 - background service worker
// 职责：主页标签单例（兜底）+ 视频标签复用（最多两个 B站标签：主页 + 当前视频）

// URL 分类：home（B站主页）/ content（视频、番剧、直播等非主页站内页）/ other
function classify(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === 'bilibili.com' || host === 'www.bilibili.com') {
      return u.pathname === '/' ? 'home' : 'content';
    }
    if (host.endsWith('.bilibili.com') || host === 'b23.tv') return 'content';
  } catch {
    /* ignore */
  }
  return 'other';
}

function findTab(tabs, kind) {
  return tabs.find((t) => classify(t.url) === kind);
}

// 内容页消息：打开/复用视频标签
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || (msg.type !== 'openVideo' && msg.type !== 'focusHome')) return;
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (msg.type === 'openVideo') {
      const contentTab = findTab(tabs, 'content');
      if (contentTab) {
        // 已有视频标签：导航过去并聚焦
        chrome.tabs.update(contentTab.id, { url: msg.url, active: true });
      } else {
        // 没有视频标签：新建
        chrome.tabs.create({ url: msg.url, active: true });
      }
    } else {
      // focusHome：聚焦已有主页标签，没有则新建
      const homeTab = findTab(tabs, 'home');
      if (homeTab) {
        chrome.tabs.update(homeTab.id, { active: true });
      } else {
        chrome.tabs.create({ url: 'https://www.bilibili.com/', active: true });
      }
    }
  });
});

// 主页单例兜底：任何标签导航到主页时，若已有主页标签则关闭新来的那个
// （覆盖"视频标签内手动输入 bilibili.com"等未走消息通道的场景）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;
  if (classify(tab.url) !== 'home') return;
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const other = tabs.find((t) => t.id !== tabId && classify(t.url) === 'home');
    if (other) chrome.tabs.remove(tabId);
  });
});
