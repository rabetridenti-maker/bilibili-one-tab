// Bilibili Single Tab v2.1.4 - background service worker
// 职责：
// - 前台视频槽位（复用，Pin）
// - 后台播放槽位（#bst-bg 标记，Pin 不聚焦）——刷视频的同时后台放音乐
// - focusHome：聚焦已有主页标签（仅聚焦，不固定、不关闭、不单例）
// 主页标签完全交给用户/浏览器管理，扩展不主动操作主页标签。

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

// 视频页 URL 判断（与 content-main.js 的 isVideoUrl 保持一致）
const VIDEO_RE = /^\/(video|bangumi|live|medialist|list|cheese)\//;
function isVideoUrl2(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'b23.tv') return true;
    if (!/(^|\.)bilibili\.com$/i.test(u.hostname)) return false;
    return VIDEO_RE.test(u.pathname);
  } catch {
    return false;
  }
}

// 视频槽位标签：content 分类、非后台槽位、且当前 URL 就是视频页
// 关键：收藏/动态/搜索等页面虽然也是 content，但绝不是视频槽位，
// 不能被 openVideo 复用（否则点击视频会把这些页面导航成视频 = 页面被吞）
function findVideoTab(tabs) {
  return tabs.find((t) => classify(t.url) === 'content' && !isBgTab(t) && isVideoUrl2(t.url));
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
      // 前台槽位：只复用"当前就是视频页"的标签；没有则新建
      // （收藏/动态/搜索页等 content 页面不会被复用，点击视频不会吃掉它们）
      const contentTab = findVideoTab(tabs);
      if (contentTab) {
        chrome.tabs.update(contentTab.id, { url: msg.url, active: true });
      } else {
        chrome.tabs.create({ url: msg.url, active: true });
      }
    } else if (msg.type === 'bgPlay') {
      // 后台槽位：复用 #bst-bg 且是视频页的标签（不聚焦）；没有则新建（后台打开）
      const bgTab = tabs.find(
        (t) => classify(t.url) === 'content' && isBgTab(t) && isVideoUrl2(t.url)
      );
      if (bgTab) {
        chrome.tabs.update(bgTab.id, { url: withBgHash(msg.url) });
      } else {
        chrome.tabs.create({ url: withBgHash(msg.url), active: false });
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
