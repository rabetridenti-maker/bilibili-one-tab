// Bilibili Single Tab v2 - MAIN world content script
// 在页面世界运行：拦截主页上的站内链接点击和 window.open，
// 通过 postMessage 通知 isolated world 的桥接脚本，由 background 复用视频标签。

const BST_SOURCE = 'bilibili-single-tab';
const INTERNAL_HOST = /(^|\.)bilibili\.com$/i;

function isInternal(url) {
  try {
    const u = new URL(url, location.href);
    return INTERNAL_HOST.test(u.hostname) || u.hostname === 'b23.tv';
  } catch {
    return false;
  }
}

function isHomeUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'bilibili.com' || u.hostname === 'www.bilibili.com') && u.pathname === '/';
  } catch {
    return false;
  }
}

function isHomePage() {
  return isHomeUrl(location.href);
}

function request(type, url) {
  window.postMessage({ source: BST_SOURCE, type, url }, '*');
}

// 拦截站内链接点击：
// - 任何页面点击"回主页"链接（logo 等）→ focusHome：聚焦已有主页标签，当前标签保留
// - 主页点击其他站内链接 → openVideo：复用视频标签（主页自身永不导航）
// - 视频页点击其他站内链接 → 放行默认导航（在视频标签内切换）
document.addEventListener(
  'click',
  (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const raw = a.getAttribute('href');
    if (!raw || !isInternal(raw)) return;
    const url = new URL(raw, location.href).href;

    if (isHomeUrl(url)) {
      // 目标是主页：聚焦已有主页标签，不导航当前标签
      e.preventDefault();
      e.stopPropagation();
      request('focusHome', url);
      return;
    }
    if (isHomePage()) {
      // 主页上点视频等站内链接：复用视频标签
      e.preventDefault();
      e.stopPropagation();
      request('openVideo', url);
    }
  },
  true
);

// 拦截 window.open 站内 URL（主页和内容页都处理：一律复用视频标签）
const origOpen = window.open;
window.open = function (url, name, features) {
  if (typeof url === 'string' && isInternal(url)) {
    request('openVideo', new URL(url, location.href).href);
    return null;
  }
  return origOpen.apply(this, arguments);
};

// ===== 视频页"后台播放"按钮 =====
// 把当前视频放进后台槽位（Pin、不聚焦），前台继续刷视频/干别的，后台照常放
function injectBgPlayButton() {
  if (isHomePage() || document.getElementById('bst-bgplay-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'bst-bgplay-btn';
  btn.textContent = location.hash === '#bst-bg' ? '♪ 后台播放中' : '♪ 后台播放';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '16px',
    bottom: '100px',
    zIndex: '2147483647',
    background: '#00A1D6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
    fontFamily: 'inherit',
  });
  btn.addEventListener('click', () => {
    request('bgPlay', location.href);
    btn.textContent = '✓ 已加入后台';
    setTimeout(() => {
      btn.textContent = location.hash === '#bst-bg' ? '♪ 后台播放中' : '♪ 后台播放';
    }, 1500);
  });
  (document.body || document.documentElement).appendChild(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectBgPlayButton, { once: true });
} else {
  injectBgPlayButton();
}
