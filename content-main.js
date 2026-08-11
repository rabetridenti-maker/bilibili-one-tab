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

// 主页上的站内链接点击：交给 background 复用视频标签（主页自身永不导航）
document.addEventListener(
  'click',
  (e) => {
    if (!isHomePage()) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const raw = a.getAttribute('href');
    if (!raw || !isInternal(raw)) return;
    e.preventDefault();
    e.stopPropagation();
    request('openVideo', new URL(raw, location.href).href);
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
