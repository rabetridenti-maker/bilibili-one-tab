// Bilibili Single Tab v2.3 - MAIN world content script
//
// 导航模型：
//   主页 / 动态 / 搜索 各自常驻一个标签（同类页面之间导航在原标签内进行）
//   视频 → 全局唯一的视频标签（始终复用）
//   视频页点左上角 logo → 切回来源标签（原页面原样保留，不重新加载）
//   视频页点 主页/动态/搜索 → 聚焦已有的同类标签，没有才新建
//
// 已移除（v2.3）：后台播放槽位（#bst-bg）、画中画按钮。

const BST_SOURCE = 'bilibili-single-tab';
const INTERNAL_HOST = /(^|\.)bilibili\.com$/i;
const VIDEO_PATH_RE = /^\/(video|bangumi|live|medialist|list|cheese)\//;
// 各自最多一个标签的页面类型（与 background.js 保持一致）
const UNIQUE_KINDS = ['home', 'dynamic', 'search'];

// 自检标志：F12 Console 输入 window.__BST__ 可确认扩展脚本已注入
window.__BST__ = {
  version: '2.3.0',
  injected: true,
  url: location.href,
  kindOf,
  isVideoPage,
  decide,
};

// URL 分类：video / home / dynamic / search / page（其它站内页）/ external
function kindOf(url) {
  let u;
  try {
    u = new URL(url, location.href);
  } catch {
    return 'external';
  }
  const host = u.hostname.toLowerCase();
  if (host === 'b23.tv') return 'video';
  if (!INTERNAL_HOST.test(host)) return 'external';
  if (VIDEO_PATH_RE.test(u.pathname)) return 'video';
  if (host === 't.bilibili.com' || u.pathname.startsWith('/dynamic')) return 'dynamic';
  if (u.pathname.startsWith('/search')) return 'search';
  if ((host === 'bilibili.com' || host === 'www.bilibili.com') && u.pathname === '/') return 'home';
  return 'page';
}

function isVideoUrl(url) {
  return kindOf(url) === 'video';
}

// 当前页是否为视频播放页
function isVideoPage() {
  return isVideoUrl(location.href);
}

// 这次导航要不要接管？返回 'openVideo' / 'openPage' / null（null = 放行默认导航）
//   目标视频 + 当前不是视频页            → 交给唯一的视频标签
//   目标是 主页/动态/搜索 + 与当前页不同类 → 交给那个类型的专属标签
//   其余（同类页面之间、分区等其它站内页、外链）→ 放行
function decide(targetUrl) {
  const kind = kindOf(targetUrl);
  if (kind === 'external') return null;
  const cur = kindOf(location.href);
  if (kind === 'video') return cur === 'video' ? null : 'openVideo';
  if (UNIQUE_KINDS.includes(kind) && kind !== cur) return 'openPage';
  return null;
}

function request(type, url) {
  window.postMessage({ source: BST_SOURCE, type, url }, '*');
}

// 从事件里找出被点击的链接（B站新版组件用 Shadow DOM，target.closest 会失败）
function findAnchor(e) {
  const path = e.composedPath ? e.composedPath() : [];
  if (e.target && e.target.closest) {
    const a = e.target.closest('a[href]');
    if (a) return a;
  }
  for (const el of path) {
    if (el && el.tagName === 'A' && el.getAttribute && el.getAttribute('href')) return el;
  }
  return null;
}

// 是否点的是左上角的 bilibili logo（回"来源页"的意思）
// 实测新版顶栏：<a href="//www.bilibili.com" class="left-entry__item-trigger">
//                 <div class="big-logo has-switch trigger-icon"><svg …/></div></a>
// 真实点击落在 svg 上 → class 在事件路径里；合成点击落在 a 上 → class 在子元素里。两头都认。
function hasLogoClass(el) {
  return !!(el && el.getAttribute && /logo/i.test(el.getAttribute('class') || ''));
}

function isLogoClick(e, a) {
  if (hasLogoClass(a)) return true;
  if (a.querySelector && a.querySelector('[class*="logo" i]')) return true;
  const path = e.composedPath ? e.composedPath() : [];
  return path.some(hasLogoClass);
}

// 拦截站内链接点击
document.addEventListener(
  'click',
  (e) => {
    // 中键 / Ctrl+点击 保持浏览器原生行为（后台新开标签）
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const a = findAnchor(e);
    if (!a) return;
    const raw = a.getAttribute('href');
    if (!raw) return;

    let url;
    try {
      url = new URL(raw, location.href).href;
    } catch {
      return;
    }
    if (!INTERNAL_HOST.test(new URL(url).hostname)) return;

    // 视频页点左上角 logo → 回到来源页（动态/搜索/主页，原样保留）
    if (isVideoPage() && kindOf(url) === 'home' && isLogoClick(e, a)) {
      e.preventDefault();
      e.stopPropagation();
      request('goBack');
      return;
    }

    const action = decide(url);
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      request(action, url);
    }
  },
  true
);

// 拦截 window.open 打开站内视频：交给唯一的视频标签；其它 URL 保持原行为
const origOpen = window.open;
window.open = function (url, name, features) {
  if (typeof url === 'string' && isInternalUrl(url) && isVideoUrl(url) && !isVideoPage()) {
    request('openVideo', new URL(url, location.href).href);
    return null;
  }
  return origOpen.apply(this, arguments);
};
function isInternalUrl(url) {
  try {
    const u = new URL(url, location.href);
    return INTERNAL_HOST.test(u.hostname) || u.hostname === 'b23.tv';
  } catch {
    return false;
  }
}

// 拦截 SPA 路由导航（history.pushState / replaceState）：
// 动态/搜索/主页里的跳转可能不走链接点击，而是 SPA 路由（否则会把来源页吃掉）
function hookHistory(method, orig) {
  history[method] = function (state, title, url) {
    if (typeof url === 'string') {
      let target;
      try {
        target = new URL(url, location.href).href;
      } catch {
        target = null;
      }
      if (target) {
        const action = decide(target);
        if (action) {
          request(action, target);
          return; // 阻止当前页被导航走
        }
      }
    }
    return orig.apply(this, arguments);
  };
}
hookHistory('pushState', history.pushState);
hookHistory('replaceState', history.replaceState);

// 拦截 JS 直接导航：location.href = xxx / location.assign() / location.replace()
// （最后一条导航通道，堵上后来源页不会被视频/其它页面吃掉）
function guardLocationNav(target) {
  if (typeof target !== 'string') return false;
  let url;
  try {
    url = new URL(target, location.href).href;
  } catch {
    return false;
  }
  const action = decide(url);
  if (action) {
    request(action, url);
    return true;
  }
  return false;
}
const origAssign = Location.prototype.assign;
Location.prototype.assign = function (url) {
  if (guardLocationNav(url)) return;
  return origAssign.call(this, url);
};
const origReplace = Location.prototype.replace;
Location.prototype.replace = function (url) {
  if (guardLocationNav(url)) return;
  return origReplace.call(this, url);
};
const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
if (hrefDesc && hrefDesc.set) {
  Object.defineProperty(Location.prototype, 'href', {
    get: hrefDesc.get,
    set(v) {
      if (!guardLocationNav(v)) hrefDesc.set.call(this, v);
    },
    configurable: true,
  });
}
