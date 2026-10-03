// Bilibili Single Tab v2.4 - MAIN world content script
//
// 导航模型：
//   主页 / 动态 / 搜索 各自常驻一个标签（同类页面之间导航在原标签内进行）
//   视频 → 全局唯一的视频标签（始终复用）
//   视频页点左上角 logo → 切回来源标签（原页面原样保留，不重新加载）
//   视频页点 主页/动态/搜索 → 聚焦已有的同类标签，没有才新建
//   视频页内点推荐/简介里的别的视频 → 原标签内 SPA 跳转，并给出「返回上个视频」按钮
//
// 已移除（v2.3）：后台播放槽位（#bst-bg）、画中画按钮。

const BST_SOURCE = 'bilibili-single-tab';
const INTERNAL_HOST = /(^|\.)bilibili\.com$/i;
const VIDEO_PATH_RE = /^\/(video|bangumi|live|medialist|list|cheese)\//;
// 各自最多一个标签的页面类型（与 background.js 保持一致）
const UNIQUE_KINDS = ['home', 'dynamic', 'search'];

// 自检标志：F12 Console 输入 window.__BST__ 可确认扩展脚本已注入
window.__BST__ = {
  version: '2.4.0',
  injected: true,
  url: location.href,
  kindOf,
  isVideoPage,
  decide,
  videoStack: readVideoStack,
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
    } else {
      // 视频页内点别的视频（推荐位/简介链接）→ 记下来，之后能一键返回
      maybeRememberVideoJump(url);
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
        // 视频页内换视频：可能不走链接点击（点完再看下一集等），这里补记一次
        maybeRememberVideoJump(target);
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

// ===== 视频页内跳转别的视频 → 「返回上个视频」按钮 =====
// 视频页里点推荐位/简介里的别的视频，是 SPA 原地换（实测 history.pushState，标签 id 不变），
// 浏览器原生 Alt+← 本来就能回去；这里把「回哪去」记在 sessionStorage，并给一个显眼入口。
// 注意：栈是「跳走时」才压入当前视频，所以进站看到的第一个视频要等你跳走一次才进栈。

const STACK_KEY = 'bst-videos';
const STACK_MAX = 30;
// B站各路推荐位会往 URL 上挂一堆跟踪参数，比较"是不是同一个视频"时要忽略掉
const TRACK_KEYS = new Set([
  'spm_id_from', 'vd_source', 'track_id', 'from_source', 'from_spmid', 'from',
  'seid', 'bbid', 'ts', 'unique_k', 'share_source', 'share_medium', 'share_plat',
  'share_tag', 'share_session_id', 'timestamp', 'up_id', 'tab', 'buvid', 'mid',
]);

// 稳定的视频标识：优先 BV/av 号，其它情况用 pathname + 去掉跟踪参数后的 query
function videoKey(url) {
  try {
    const u = new URL(url, location.href);
    const bv = /\/video\/(BV[0-9A-Za-z]+)/.exec(u.pathname);
    if (bv) return 'BV:' + bv[1];
    const av = /\/video\/av(\d+)/i.exec(u.pathname);
    if (av) return 'av:' + av[1];
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACK_KEYS.has(k));
    params.sort();
    const q = params.map(([k, v]) => `${k}=${v}`).join('&');
    return u.pathname.replace(/\/+$/, '') + (q ? '?' + q : '');
  } catch {
    return String(url);
  }
}

function readVideoStack() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]');
    return Array.isArray(s) ? s : [];
  } catch {
    return [];
  }
}

function writeVideoStack(s) {
  try {
    sessionStorage.setItem(STACK_KEY, JSON.stringify(s.slice(-STACK_MAX)));
  } catch {
    /* 隐私模式等场景，忽略 */
  }
}

// 最后一个用户手势时间戳（防止代码主动导航时被误记进「视频历史」）
let lastGesture = 0;
for (const ev of ['mousedown', 'pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, () => (lastGesture = Date.now()), true);
}
const gestureRecent = () => Date.now() - lastGesture < 1500;

// 视频页里要跳向另一个视频时调用（在导航发生前，location 还是旧视频）
// 只在「用户刚点过东西」时记录：代码自己改 URL（换 P、加载、我们的返回按钮）不算
function maybeRememberVideoJump(targetUrl) {
  if (!gestureRecent()) return;
  rememberVideoJump(targetUrl);
}

function rememberVideoJump(targetUrl) {
  if (!isVideoPage()) return;
  const cur = { key: videoKey(location.href), url: location.href, title: document.title, t: Date.now() };
  if (cur.key === videoKey(targetUrl)) return;
  const s = readVideoStack();
  const last = s[s.length - 1];
  if (last && last.key === cur.key) return;
  s.push(cur);
  writeVideoStack(s);
}

// 栈里离当前视频最近的、不是当前视频的那一条 = 「上个视频」
function topOfStack() {
  const cur = videoKey(location.href);
  const s = readVideoStack();
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i].key !== cur) return { entry: s[i], index: i, stack: s };
  }
  return null;
}

let backBtn = null;

const BACK_CSS = `
#bst-back-btn {
  position: fixed;
  z-index: 2147483000;
  display: none;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  color: #18191c;
  font-size: 13px;
  line-height: 1.2;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
  transition: background 0.15s, transform 0.15s;
  max-width: 260px;
}
#bst-back-btn:hover { background: #fff; transform: translateY(-1px); }
#bst-back-btn .bst-arrow { color: #00a1d6; font-size: 15px; line-height: 1; }
#bst-back-btn .bst-label { font-weight: 600; color: #00a1d6; white-space: nowrap; }
#bst-back-btn .bst-sub {
  color: #61666d; font-size: 12px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; max-width: 150px;
}
@media (prefers-color-scheme: dark) {
  #bst-back-btn { background: rgba(34, 36, 40, 0.94); border-color: rgba(255,255,255,0.1); color: #e3e5e7; }
  #bst-back-btn:hover { background: #2b2d31; }
  #bst-back-btn .bst-sub { color: #a6a9ae; }
}
`;

function ensureStyle() {
  if (document.getElementById('bst-back-style')) return;
  const st = document.createElement('style');
  st.id = 'bst-back-style';
  st.textContent = BACK_CSS;
  (document.head || document.documentElement).appendChild(st);
}

function makeBackButton() {
  ensureStyle();
  const b = document.createElement('button');
  b.id = 'bst-back-btn';
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    goBackToPrevVideo();
  });
  // 别让它的点击被站内脚本当成普通点击处理
  b.addEventListener('mousedown', (e) => e.stopPropagation());
  b.addEventListener('mouseup', (e) => e.stopPropagation());
  return b;
}

function mountBackButton() {
  if (!document.body) return;
  if (!backBtn || !backBtn.isConnected) {
    backBtn = makeBackButton();
    document.body.appendChild(backBtn);
  }
}

function unmountBackButton() {
  if (backBtn && backBtn.isConnected) backBtn.remove();
}

// 位置：贴在播放器左上角内侧（标题那一行塞不下按钮，只能做浮层）
function placeBackButton() {
  if (!backBtn || !backBtn.isConnected) return;
  const player =
    document.querySelector('#bilibili-player') ||
    document.querySelector('.bpx-player-container') ||
    document.querySelector('.bpx-player-primary-area') ||
    document.querySelector('video');
  const r = player && player.getBoundingClientRect();
  const inset = 12;
  if (r && r.width > 320 && r.height > 200) {
    backBtn.style.left = Math.round(r.left + inset) + 'px';
    backBtn.style.top = Math.round(r.top + inset) + 'px';
  } else {
    // 播放器等不到（比如番剧页结构不同）→ 退到左列顶部
    backBtn.style.left = '24px';
    backBtn.style.top = '80px';
  }
}

function refreshBackButton() {
  if (!isVideoPage()) {
    unmountBackButton();
    return;
  }
  const hit = topOfStack();
  if (!hit) {
    if (backBtn && backBtn.isConnected) backBtn.style.display = 'none';
    return;
  }
  mountBackButton();
  if (!backBtn) return;
  const { entry } = hit;
  backBtn.innerHTML = '';
  const arrow = document.createElement('span');
  arrow.className = 'bst-arrow';
  arrow.textContent = '←';
  const label = document.createElement('span');
  label.className = 'bst-label';
  label.textContent = '返回上个视频';
  backBtn.appendChild(arrow);
  backBtn.appendChild(label);
  const raw = entry.title || '';
  const sub = raw.replace(/\s*[_\-|]\s*(哔哩哔哩|bilibili).*$/i, '').replace(/\s*_\s*哔哩哔哩.*$/, '').trim();
  if (sub && sub.length > 2 && sub !== '哔哩哔哩') {
    const s = document.createElement('span');
    s.className = 'bst-sub';
    s.textContent = sub.slice(0, 40);
    backBtn.appendChild(s);
  }
  backBtn.title = '回到：' + (sub || entry.url) + '\n' + entry.url;
  backBtn.dataset.bstTarget = entry.url;
  backBtn.dataset.bstTargetKey = entry.key;
  backBtn.style.display = 'inline-flex';
  placeBackButton();
}

function goBackToPrevVideo() {
  const before = location.href;
  const hit = topOfStack();
  if (!hit) return;
  const { index, stack } = hit;
  const target = stack[index];
  const next = stack.slice();
  next.splice(index, 1);
  writeVideoStack(next);

  history.back();
  setTimeout(() => {
    if (location.href !== before) {
      refreshBackButton();
      return;
    }
    // B站自己的路由把后退吞了（原地重渲染）→ 直接导航到那一条
    if (target && target.url) {
      window.location.assign(target.url);
      setTimeout(refreshBackButton, 1200);
    }
  }, 700);
}

// 视频页里 URL 变了就刷新按钮（SPA 换视频不会重新注入脚本）
let lastVideoKey = null;
function tick() {
  if (!isVideoPage()) {
    lastVideoKey = null;
    unmountBackButton();
    return;
  }
  const k = videoKey(location.href);
  if (k !== lastVideoKey) {
    lastVideoKey = k;
    refreshBackButton();
  }
}
setInterval(tick, 1000);
window.addEventListener('popstate', () => setTimeout(refreshBackButton, 350));
window.addEventListener('resize', placeBackButton);
window.addEventListener('scroll', placeBackButton, { passive: true });
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tick, { once: true });
} else {
  tick();
}

