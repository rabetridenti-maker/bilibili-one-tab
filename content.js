// Bilibili Single Tab - 站内链接当前标签页打开
// 在页面世界(MAIN)运行，可拦截 window.open

const INTERNAL_HOST = /(^|\.)bilibili\.com$/i;

function isInternal(url) {
  try {
    const u = new URL(url, location.href);
    return INTERNAL_HOST.test(u.hostname) || u.hostname === 'b23.tv';
  } catch {
    return false;
  }
}

// 移除站内链接的 target="_blank"，改为当前标签页导航
function processLinks() {
  document.querySelectorAll('a[target="_blank"]').forEach((a) => {
    if (a.dataset.singleTabDone === '1') return;
    const href = a.getAttribute('href');
    if (href && isInternal(href)) {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
    a.dataset.singleTabDone = '1';
  });
}

// 拦截 window.open：站内 URL 改为当前标签页导航，站外 URL 放行
const origOpen = window.open;
window.open = function (url, name, features) {
  if (typeof url === 'string' && isInternal(url)) {
    location.href = url;
    return null;
  }
  return origOpen.apply(this, arguments);
};

// B站是SPA，动态加载的链接需要持续监听
function init() {
  if (!document.documentElement) return;
  new MutationObserver(processLinks).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  processLinks();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
