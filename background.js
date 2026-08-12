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
        chrome.tabs.create({ url: 'https://www.bilibili.com/', active: true, pinned: true });
      }
    }
  });
});

// 主页标签自动固定（onUpdated 兜底）：主页加载时自动 Pin
// 注意：绝不主动关闭任何标签（曾有过"清理多余主页"逻辑，误关用户标签，已移除）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) return;
  if (classify(tab.url) !== 'home') return;
  if (!tab.pinned) chrome.tabs.update(tabId, { pinned: true });
});

// 启动扫描（service worker 每次唤醒时执行）：
// 覆盖"扩展更新前就已打开的主页标签"——onUpdated 不会对它们触发。
// 只做自动固定，不做任何关闭操作。
chrome.tabs.query({}, (tabs) => {
  tabs.forEach((t) => {
    if (classify(t.url) === 'home' && !t.pinned) chrome.tabs.update(t.id, { pinned: true });
  });
});
