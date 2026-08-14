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

// 视频类 URL：视频/番剧/直播/收藏夹/稍后再看等播放内容（b23.tv 短链通常指向视频）
function isVideoUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'b23.tv') return true;
    if (!INTERNAL_HOST.test(u.hostname)) return false;
    return /^\/(video|bangumi|live|medialist|list|cheese)\//.test(u.pathname);
  } catch {
    return false;
  }
}

// 当前页是否为视频播放页
function isVideoPage() {
  return isVideoUrl(location.href);
}

function request(type, url) {
  window.postMessage({ source: BST_SOURCE, type, url }, '*');
}

// 拦截站内链接点击：
// - 任何页面点击"回主页"链接（logo 等）→ focusHome：聚焦已有主页标签，当前标签保留
// - 非视频页（主页/动态/搜索/分区等）点击视频类链接 → openVideo：复用视频标签，当前页保留
// - 其余（视频页内换视频、动态页内切动态、点菜单等）→ 放行默认导航
document.addEventListener(
  'click',
  (e) => {
    // 用 composedPath 查找链接（B站新版组件用 Shadow DOM，target.closest 会失败）
    let a = null;
    if (e.target && e.target.closest) {
      a = e.target.closest('a[href]');
    }
    if (!a) {
      const path = e.composedPath ? e.composedPath() : [];
      for (const el of path) {
        if (el && el.tagName === 'A' && el.getAttribute && el.getAttribute('href')) {
          a = el;
          break;
        }
      }
    }
    if (!a) return;
    const raw = a.getAttribute('href');
    if (!raw || !isInternal(raw)) return;
    const url = new URL(raw, location.href).href;

    // [debug] 临时日志：确认拦截决策
    console.log(
      '[BST] click:',
      url,
      '| home:', isHomeUrl(url),
      '| videoPage:', isVideoPage(),
      '| videoUrl:', isVideoUrl(url)
    );

    if (isHomeUrl(url)) {
      // 目标是主页：聚焦已有主页标签，不导航当前标签
      e.preventDefault();
      e.stopPropagation();
      request('focusHome', url);
      return;
    }
    if (!isVideoPage() && isVideoUrl(url)) {
      // 当前不是视频页 + 目标是视频内容：复用视频标签，当前页（动态/搜索等）保留
      e.preventDefault();
      e.stopPropagation();
      request('openVideo', url);
    }
  },
  true
);

// 拦截 window.open 站内视频 URL：复用视频标签；非视频站内 URL 保持原行为
const origOpen = window.open;
window.open = function (url, name, features) {
  if (typeof url === 'string' && isInternal(url) && isVideoUrl(url)) {
    request('openVideo', new URL(url, location.href).href);
    return null;
  }
  return origOpen.apply(this, arguments);
};

// 拦截 SPA 路由导航（history.pushState / replaceState）：
// B站动态/搜索等页内点视频可能不走链接点击，而是 SPA 路由跳转
// （动态 tab 被导航成视频页 = "被吃掉"）。这里在导航前检查目标 URL，
// 若是视频内容且当前页不是视频页 → 阻止 SPA 导航，转发给视频标签。
function hookHistory(method, orig) {
  history[method] = function (state, title, url) {
    if (typeof url === 'string') {
      const target = new URL(url, location.href).href;
      if (isInternal(target) && isVideoUrl(target) && !isVideoPage()) {
        request('openVideo', target);
        return; // 阻止动态页被导航走
      }
    }
    return orig.apply(this, arguments);
  };
}
hookHistory('pushState', history.pushState);
hookHistory('replaceState', history.replaceState);

// ===== 视频页操作按钮组：右下角「♪ 后台播放」+「画中画」=====
// - 后台播放：把当前视频放进后台槽位（Pin、不聚焦），前台继续刷
// - 画中画：视频弹出悬浮小窗，可与其他视频/页面同屏观看（YouTube 同款）

function makeFloatButton(id, text, bottom) {
  const b = document.createElement('button');
  b.id = id;
  b.textContent = text;
  Object.assign(b.style, {
    position: 'fixed',
    right: '16px',
    bottom: bottom + 'px',
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
  return b;
}

function injectButtons() {
  if (!isVideoPage() || document.getElementById('bst-bgplay-btn')) return;

  const bgBtn = makeFloatButton('bst-bgplay-btn', location.hash === '#bst-bg' ? '♪ 后台播放中' : '♪ 后台播放', 100);
  bgBtn.addEventListener('click', () => {
    request('bgPlay', location.href);
    bgBtn.textContent = '✓ 已加入后台';
    setTimeout(() => {
      bgBtn.textContent = location.hash === '#bst-bg' ? '♪ 后台播放中' : '♪ 后台播放';
    }, 1500);
  });

  const pipBtn = makeFloatButton('bst-pip-btn', '画中画', 150);
  pipBtn.addEventListener('click', async () => {
    const v = document.querySelector('video');
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      /* 播放器未就绪等场景，忽略 */
    }
  });

  (document.body || document.documentElement).append(bgBtn, pipBtn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectButtons, { once: true });
} else {
  injectButtons();
}
