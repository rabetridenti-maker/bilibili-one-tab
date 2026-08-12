// Bilibili Single Tab v2.1 - background service worker
// 职责：
// - 主页标签单例（兜底）+ 自动固定
// - 前台视频槽位（复用，Pin）
// - 后台播放槽位（#bst-bg 标记，Pin 不聚焦）——刷视频的同时后台放音乐

const BG_HASH = '#bst-bg';

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

// 后台播放标签：content 且 URL 带 #bst-bg 标记
function isBgTab(tab) {
  try {
    return new URL(tab.url).hash === BG_HASH;
  } catch {
    return false;
  }
}

function findTab(tabs, kind, excludeBg = false) {
  return tabs.find((t) => classify(t.url) === kind && (!excludeBg || !isBgTab(t)));
}

function withBgHash(url) {
  try {
    const u = new URL(url);
    u.hash = BG_HASH.slice(1);
    return u.href;
  } catch {
    return url + BG_HASH;
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !['openVideo', 'bgPlay', 'focusHome'].includes(msg.type)) return;
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (msg.type === 'openVideo') {
      // 前台槽位：复用"非后台"的视频标签；没有则新建（Pin）
      const contentTab = findTab(tabs, 'content', true);
      if (contentTab) {
        chrome.tabs.update(contentTab.id, { url: msg.url, active: true });
      } else {
        chrome.tabs.create({ url: msg.url, active: true, pinned: true });
      }
    } else if (msg.type === 'bgPlay') {
      // 后台槽位：复用 #bst-bg 标签（不聚焦）；没有则新建（Pin、后台打开）
      const bgTab = tabs.find((t) => classify(t.url) === 'content' && isBgTab(t));
      if (bgTab) {
        chrome.tabs.update(bgTab.id, { url: withBgHash(msg.url) });
      } else {
        chrome.tabs.create({ url: withBgHash(msg.url), pinned: true, active: false });
      }
    } else {
      // focusHome：让来源标签暂停视频，然后聚焦已有主页标签；没有主页标签则新建
      if (sender.tab) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'pauseVideo' }).catch(() => {});
      }
      const homeTab = findTab(tabs, 'home');
      if (homeTab) {
        chrome.tabs.update(homeTab.id, { active: true });
      } else {
        chrome.tabs.create({ url: 'https://www.bilibili.com/', active: true });
      }
    }
  });
});

// 主页单例兜底 + 自动固定：
// - 任何标签导航到主页时，若已有主页标签则关闭新来的那个
//   （覆盖"视频标签内手动输入 bilibili.com"等未走消息通道的场景）
// - 唯一的主页标签自动固定（pin）在标签栏左侧，常驻后台
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;
  if (classify(tab.url) !== 'home') return;
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const other = tabs.find((t) => t.id !== tabId && classify(t.url) === 'home');
    if (other) {
      chrome.tabs.remove(tabId);
    } else if (!tab.pinned) {
      chrome.tabs.update(tabId, { pinned: true });
    }
  });
});
