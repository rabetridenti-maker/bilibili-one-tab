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

// ===== 主页滚动位置记忆（从视频页返回时恢复）=====
// B站主页 → 视频页是整页导航，返回时主页重新加载会丢失滚动位置。
// 这里在离开主页前记录位置，仅在"前进/后退"导航返回主页时恢复。
const SCROLL_KEY = 'bili-single-tab:home-scroll';

function isHomePage() {
  try {
    const u = new URL(location.href);
    return u.hostname === 'www.bilibili.com' && u.pathname === '/';
  } catch {
    return false;
  }
}

if (isHomePage()) {
  // 离开主页（点视频、整页导航）前保存滚动位置
  window.addEventListener('pagehide', () => {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  });

  // 仅"浏览器返回/前进"导航时恢复；直接点 logo 回主页、刷新都不恢复
  const navType = performance.getEntriesByType('navigation')[0]?.type;
  if (navType === 'back_forward') {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved !== null) {
      sessionStorage.removeItem(SCROLL_KEY);
      const target = Math.max(0, parseInt(saved, 10) || 0);
      let attempts = 0;
      const restore = () => {
        window.scrollTo(0, target);
        // B站首页是懒加载，内容不足时等待加载后重试
        if (document.documentElement.scrollHeight < target + window.innerHeight && attempts < 30) {
          attempts++;
          setTimeout(restore, 400);
        }
      };
      setTimeout(restore, 50);
    }
  }
}
