// Bilibili Single Tab v2.3 - background service worker
//
// 标签模型（每种页面类型最多一个标签）：
//   主页标签 / 动态标签 / 搜索标签 —— 常驻，不会被别的页面导航走
//   视频标签 —— 全局唯一，始终复用
//   B 站最多 4 个标签：主页 + 动态 + 搜索 + 当前视频（用到的页面各一个，不重复开）
//
// 消息：
//   openVideo(url)  从非视频页点视频 → 复用唯一的视频标签，并记录它的「来源标签」
//   goBack()        视频页点左上角 logo → 切回来源标签（来源页原样保留，不重新加载）
//   openPage(url)   点 主页/动态/搜索 → 聚焦已有的同类标签，没有才新建；当前页保留
//
// 已移除（v2.3）：后台播放槽位（#bst-bg）、画中画按钮 —— 见 content-main.js 头部说明

const VIDEO_RE = /^\/(video|bangumi|live|medialist|list|cheese)\//;
const INTERNAL_RE = /(^|\.)bilibili\.com$/i;
// 每种类型最多一个的页面
const UNIQUE_KINDS = ['home', 'dynamic', 'search'];
const BROWSING_KINDS = ['home', 'dynamic', 'search', 'page'];

// URL 分类：video / home / dynamic / search / page（其它站内页）/ external
function kindOf(url) {
  let u;
  try {
    u = new URL(url || '');
  } catch {
    return 'external';
  }
  const host = u.hostname.toLowerCase();
  if (host === 'b23.tv') return 'video';
  if (!INTERNAL_RE.test(host)) return 'external';
  if (VIDEO_RE.test(u.pathname)) return 'video';
  if (host === 't.bilibili.com' || u.pathname.startsWith('/dynamic')) return 'dynamic';
  if (u.pathname.startsWith('/search')) return 'search';
  if ((host === 'bilibili.com' || host === 'www.bilibili.com') && u.pathname === '/') return 'home';
  return 'page';
}

// 标签当前属于哪类页面（加载中的标签只有 pendingUrl）
const tabKind = (t) => kindOf(t && (t.url || t.pendingUrl));

// ── 「视频标签 → 来源标签」映射 ──
// 存在 storage.session：service worker 被回收重启后仍记得来源（浏览器重启后失效，id 已无意义）
async function getSources() {
  try {
    const got = await chrome.storage.session.get('sources');
    return got.sources || {};
  } catch {
    return {};
  }
}

async function setSource(videoTabId, sourceTabId) {
  try {
    const s = await getSources();
    s[videoTabId] = sourceTabId;
    await chrome.storage.session.set({ sources: s });
  } catch {
    /* ignore */
  }
}

async function forgetTab(tabId) {
  try {
    const s = await getSources();
    let dirty = false;
    if (tabId in s) {
      delete s[tabId];
      dirty = true;
    }
    for (const [k, v] of Object.entries(s)) {
      if (v === tabId) {
        delete s[k];
        dirty = true;
      }
    }
    if (dirty) await chrome.storage.session.set({ sources: s });
  } catch {
    /* ignore */
  }
}

function queryTabs(from) {
  const q =
    from && from.windowId != null ? { windowId: from.windowId } : { lastFocusedWindow: true };
  return chrome.tabs.query(q);
}

// 离开视频页时暂停播放（不再有后台播放/画中画）
function pauseVideo(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'pauseVideo' }).catch(() => {});
}

// 从非视频页点视频：复用唯一的视频标签，并记下来源标签
async function openVideo(url, from) {
  const tabs = await queryTabs(from);
  const reused = tabs.find((t) => tabKind(t) === 'video' && (!from || t.id !== from.id));
  if (reused) {
    await chrome.tabs.update(reused.id, { url, active: true });
    if (from) await setSource(reused.id, from.id);
  } else {
    const created = await chrome.tabs.create({ url, active: true });
    if (from) await setSource(created.id, from.id);
  }
}

// 视频页点左上角 logo：切回来源标签，视频标签留着（暂停）供下次复用
async function goBack(from) {
  if (!from) return;
  const tabs = await queryTabs(from);
  const sources = await getSources();
  const srcId = sources[from.id];

  let target = null;
  if (srcId != null && srcId !== from.id) target = tabs.find((t) => t.id === srcId) || null;
  // 来源标签已被关掉：退而求其次，找任意一个浏览标签
  if (!target) {
    target = tabs.find((t) => t.id !== from.id && BROWSING_KINDS.includes(tabKind(t))) || null;
  }

  pauseVideo(from.id);
  if (target) await chrome.tabs.update(target.id, { active: true });
  // 没有任何浏览标签（例如从站外链接直接打开的视频）→ 视频标签自己回主页
  else await chrome.tabs.update(from.id, { url: 'https://www.bilibili.com/' });
}

// 点 主页/动态/搜索：聚焦已有的同类标签（各类型只保留一个），没有才新建；当前页保留
async function openPage(url, from) {
  const kind = kindOf(url);
  if (!UNIQUE_KINDS.includes(kind)) return;

  const tabs = await queryTabs(from);
  const others = tabs.filter((t) => !from || t.id !== from.id);
  const fromIsVideo = !!from && tabKind(from) === 'video';

  // 已经有同类页面 → 聚焦它（不再新开：动态/搜索/主页各保持只有一个）
  let target = others.find((t) => tabKind(t) === kind) || null;
  if (!target) {
    target = await chrome.tabs.create({ url, active: true });
  } else {
    await chrome.tabs.update(target.id, { active: true });
  }

  if (fromIsVideo) {
    pauseVideo(from.id);
    // 视频是从这个浏览标签"走到"的，之后点 logo 就回到它
    if (target && target.id != null) await setSource(from.id, target.id);
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;
  const from = sender && sender.tab ? sender.tab : null;
  if (msg.type === 'openVideo' && msg.url) openVideo(msg.url, from);
  else if (msg.type === 'goBack') goBack(from);
  else if (msg.type === 'openPage' && msg.url) openPage(msg.url, from);
});

// 标签关闭后清理来源映射，避免 id 复用导致"回到错误的标签"
chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
});
