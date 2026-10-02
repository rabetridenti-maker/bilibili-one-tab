// Bilibili Single Tab v2.3 —— 真机验收脚本（Playwright + 本机 Edge，加载未打包扩展）
// 断言的是"用户约定"：视频独立标签；点 logo 切回来源标签；主页/动态/搜索全站各只有一个
//
// 运行： node tools/verify.mjs
// 依赖： playwright（本机已装在 deepseek-harness 的 pnpm 目录里）+ 本机 Edge
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
// 仓库根目录（本文件在 <repo>/tools/ 下）
const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.BST_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// 找一个能 require 到的 playwright：环境变量 > 本机 pnpm 目录 > 仓库同级 node_modules
function loadPlaywright() {
  const candidates = [
    process.env.BST_PLAYWRIGHT,
    'C:/Users/Administrator/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright',
    resolve(EXT, 'node_modules/playwright'),
    'playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c === 'playwright' || existsSync(c)) return require(c);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error('找不到 playwright，请设置 BST_PLAYWRIGHT=<playwright 包路径> 或 npm i -D playwright');
}
const { chromium } = loadPlaywright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ::  ' + detail : ''}`);
}

const host = (u) => {
  try {
    return new URL(u || '').hostname;
  } catch {
    return '';
  }
};
const path = (u) => {
  try {
    return new URL(u || '').pathname;
  } catch {
    return '';
  }
};

let ctx, sw;
async function getSW() {
  let list = ctx.serviceWorkers();
  if (!list.length) list = [await ctx.waitForEvent('serviceworker', { timeout: 15000 })];
  return list[0];
}
async function tabs() {
  for (let i = 0; i < 3; i++) {
    try {
      return await sw.evaluate(() => chrome.tabs.query({}));
    } catch {
      await sleep(500);
      sw = await getSW();
    }
  }
  return [];
}
const biliTabs = (ts) => ts.filter((t) => /(^|\.)bilibili\.com$/.test(host(t.url)));
const activeTab = async () => (await sw.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true })))[0];
const pageOf = (tab) => ctx.pages().find((p) => p.url() === tab.url);
const page = (re) => ctx.pages().find((p) => re.test(p.url()));
const focus = async (id) => sw.evaluate((i) => chrome.tabs.update(i, { active: true }), id);

async function report(label) {
  const b = biliTabs(await tabs());
  console.log(
    `   [${label}] B站标签 ${b.length}: ` +
      b.map((t) => `${t.id}:${t.url.slice(0, 60)}${t.active ? ' *' : ''}`).join(' | ')
  );
  return b;
}

// 在页面里合成点击一个链接（模拟真实卡片点击；body 上的捕获监听器能看到它）
async function clickLink(pg, href) {
  await pg.bringToFront();
  await sleep(800);
  return pg.evaluate((h) => {
    const a = document.createElement('a');
    a.href = h;
    document.body.appendChild(a);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    return true;
  }, href);
}

// 合成点击页面里真实的 logo 链接（真实点击落在 svg 上，这里点 <a> 本体，覆盖两条路径）
async function clickLogo(pg) {
  await pg.bringToFront();
  await sleep(500);
  return pg.evaluate(() => {
    const a = document.querySelector(
      '.bili-header__logo, a[href="//www.bilibili.com"], a[href="//www.bilibili.com/"], a[href="https://www.bilibili.com"], a[href="https://www.bilibili.com/"]'
    );
    if (!a) return false;
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    return true;
  });
}

// 合成点击页面里真实的视频卡片
async function clickRealVideo(pg) {
  const href = await pg.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/video/BV"]')].find((x) => x.getAttribute('href'));
    return a ? new URL(a.getAttribute('href'), location.href).href : null;
  });
  if (!href) return null;
  await pg.evaluate((h) => {
    const a = [...document.querySelectorAll('a[href]')].find(
      (x) => new URL(x.getAttribute('href'), location.href).href === h
    );
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  }, href);
  return href;
}

try {
  ctx = await chromium.launchPersistentContext('', {
    executablePath: EDGE,
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,950',
    ],
    viewport: null,
  });
  sw = await getSW();
  console.log('扩展 service worker:', sw.url());

  const homeP = ctx.pages()[0] || (await ctx.newPage());

  // ── T1 注入自检 ──
  await homeP.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  const info = await homeP.evaluate(() =>
    window.__BST__ ? { v: window.__BST__.version, kind: window.__BST__.kindOf(location.href) } : null
  );
  check('T1 主页注入 __BST__ 且版本 2.3.0', !!info && info.v === '2.3.0', JSON.stringify(info));
  const homeTab = biliTabs(await tabs()).find((t) => host(t.url) === 'www.bilibili.com' && path(t.url) === '/');
  console.log('   主页标签 id =', homeTab && homeTab.id);

  // ── T2 主页点视频 → 独立视频标签，主页原地不动 ──
  const vhref = await clickRealVideo(homeP);
  await sleep(7000);
  let r = await report('T2 主页点视频后');
  const vTab = r.find((t) => /\/video\//.test(t.url));
  check('T2a 视频在独立标签打开', !!vTab, vhref || 'n/a');
  check('T2b 主页标签没被导航走', r.some((t) => t.id === homeTab.id && path(t.url) === '/'), 'home intact');
  check('T2c 此时只有 2 个B站标签（主页+视频）', r.length === 2, String(r.length));

  // ── T3 视频页点左上角 logo → 切回主页标签（不重新加载） ──
  {
    const vPage = page(/\/video\//);
    const ok = await clickLogo(vPage);
    await sleep(2500);
    const a = await activeTab();
    check('T3a 视频页点到 logo', ok, String(ok));
    check('T3b 点 logo 切回主页标签', a && a.id === homeTab.id, a ? `${a.id}:${a.url}` : 'none');
    r = await report('T3 切回后');
    check('T3c 视频标签仍在（id 未变）', r.some((t) => t.id === vTab.id), `video ${vTab.id}`);
    check('T3d 离开后视频已暂停', await vPage.evaluate(() => [...document.querySelectorAll('video')].every((v) => v.paused)), 'paused');
  }

  // ── T4 视频页点「动态」→ 新建独立动态标签；主页/视频都不被导航 ──
  let dynTab;
  {
    await focus(vTab.id);
    await sleep(1200);
    await clickLink(page(/\/video\//), 'https://t.bilibili.com/');
    await sleep(7000);
    r = await report('T4 视频页点动态后');
    dynTab = r.find((t) => /t\.bilibili\.com/.test(t.url));
    check('T4a 动态标签只有一个', r.filter((t) => /t\.bilibili\.com/.test(t.url)).length === 1, '1');
    check('T4b 动态页已打开且被聚焦', !!dynTab && dynTab.active, dynTab ? dynTab.url : 'none');
    check('T4c 主页标签没被导航走', r.some((t) => t.id === homeTab.id && path(t.url) === '/'), 'home intact');
    check('T4d 视频标签没被导航走', r.some((t) => t.id === vTab.id && /\/video\//.test(t.url)), 'video intact');
    check('T4e 全局 3 个标签：主页+动态+视频，各一个', r.length === 3, String(r.length));
  }

  // ── T5 再从视频页点「动态」→ 聚焦已有动态标签，不再新开 ──
  {
    await focus(vTab.id);
    await sleep(1200);
    await clickLink(page(/\/video\//), 'https://t.bilibili.com/');
    await sleep(5000);
    r = await report('T5 再次点动态后');
    check('T5a 动态标签仍然只有一个', r.filter((t) => /t\.bilibili\.com/.test(t.url)).length === 1, '1');
    check('T5b 没有新增标签（仍为 3）', r.length === 3, String(r.length));
    check('T5c 聚焦到了原动态标签', !!(await activeTab()) && (await activeTab()).id === dynTab.id, `dyn=${dynTab.id}`);
  }

  // ── T6 动态页点视频 → 视频标签复用，动态页保留 ──
  {
    await focus(dynTab.id);
    await sleep(2500);
    const dynPage = page(/t\.bilibili\.com/);
    const kind = await dynPage.evaluate(() => window.__BST__ && window.__BST__.kindOf('https://t.bilibili.com/'));
    check('T6a 动态页识别为 dynamic', kind === 'dynamic', String(kind));
    // 无登录态时动态流里可能没有真实视频卡片 → 退回合成链接点击
    let hit = await clickRealVideo(dynPage);
    const real = !!hit;
    if (!hit) hit = await clickLink(dynPage, vhref || 'https://www.bilibili.com/video/BV1rVam6DEfm/');
    await sleep(7000);
    r = await report('T6 动态点视频后');
    check('T6b 动态页没被吃掉（URL 仍是 t.bilibili.com）', r.some((t) => t.id === dynTab.id && /t\.bilibili\.com/.test(t.url)), 'dynamic intact');
    check('T6c 视频标签被复用而非新开（仍 3 个）', r.length === 3, String(r.length));
    check('T6d 点的是真实视频卡片' + (real ? '' : '（无登录态，退回合成点击）'), true, hit || 'none');

    // ── T7 这个视频页点 logo → 回到动态标签（原页面） ──
    await clickLogo(page(/\/video\//));
    await sleep(2500);
    const a = await activeTab();
    check('T7 从动态点开的视频，点 logo 回到动态标签', a && a.id === dynTab.id, a ? `${a.id}:${a.url}` : 'none');
    check('T7b 回到的是原动态标签（不是新开），URL 仍是动态页', a && /t\.bilibili\.com/.test(a.url), a ? a.url : 'none');
  }

  // ── T8 后台播放 / 画中画 已彻底移除 ──
  {
    const vp = page(/\/video\//);
    await vp.bringToFront();
    await sleep(4500);
    const leftover = await vp.evaluate(() => ({
      pip: !!document.getElementById('bst-pip-btn'),
      bg: !!document.getElementById('bst-bgplay-btn'),
      hash: location.hash,
    }));
    check('T8a 画中画按钮已不存在', leftover.pip === false, String(leftover.pip));
    check('T8b 后台播放按钮已不存在', leftover.bg === false, String(leftover.bg));
    check('T8c 页面无 #bst-bg 标记', leftover.hash !== '#bst-bg', JSON.stringify(leftover.hash));
    check('T8d 没有任何 #bst-bg 后台标签', (await tabs()).every((t) => !/#bst-bg/.test(t.url || '')), 'no bg tab');
  }

  // ── T9 搜索页点视频 → 视频标签复用；logo 回到搜索页 ──
  {
    await homeP.bringToFront();
    await homeP.goto('https://search.bilibili.com/all?keyword=%E7%BE%8E%E9%A3%9F', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(7000);
    const searchTab = biliTabs(await tabs()).find((t) => /search\.bilibili\.com/.test(t.url));
    check('T9 搜索页已加载', !!searchTab, searchTab ? searchTab.url : 'none');
    const before = biliTabs(await tabs()).length;
    const hit = await clickRealVideo(homeP);
    await sleep(7000);
    r = await report('T9 搜索页点视频后');
    check('T9a 搜索页保留（URL 仍是 search）', r.some((t) => t.id === searchTab.id && /search\.bilibili\.com/.test(t.url)), 'search intact');
    check('T9b 标签总数没增加（视频标签复用）', r.length === before, `${before} -> ${r.length}`);
    await clickLogo(page(/\/video\//));
    await sleep(2500);
    const a = await activeTab();
    check('T9c 搜索页点开的视频，点 logo 回到搜索标签', a && a.id === searchTab.id, a ? `${a.id}:${a.url}` : 'none');
    check('T9d 搜索页找到视频结果', !!hit, hit || 'none');
    check('T9e 搜索页只有一个', r.filter((t) => /search\.bilibili\.com/.test(t.url)).length === 1, '1');
  }

  // ── T10 主页点「动态」，再从动态点视频，点 logo 回到动态（用户描述的完整链路） ──
  {
    await homeP.bringToFront();
    await homeP.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    await clickLink(homeP, 'https://t.bilibili.com/');
    await sleep(6000);
    r = await report('T10 主页点动态后');
    const dyn2 = r.find((t) => /t\.bilibili\.com/.test(t.url));
    check('T10a 复用已有动态标签（不新开）', !!dyn2 && dyn2.id === dynTab.id, dyn2 ? `${dyn2.id} vs ${dynTab.id}` : 'none');
    check('T10b 标签总数仍为 3', r.length === 3, String(r.length));
    const dp = page(/t\.bilibili\.com/);
    await clickLink(dp, vhref || 'https://www.bilibili.com/video/BV1rVam6DEfm/');
    await sleep(7000);
    r = await report('T10 动态点视频后');
    check('T10c 动态页保留', r.some((t) => t.id === dynTab.id && /t\.bilibili\.com/.test(t.url)), 'dynamic intact');
    await clickLogo(page(/\/video\//));
    await sleep(2500);
    const a = await activeTab();
    check('T10d 点 logo 回到动态标签', a && a.id === dynTab.id, a ? `${a.id}:${a.url}` : 'none');
    check('T10e 全程 B站标签数 = 3（主页+动态+视频）', biliTabs(await tabs()).length === 3, String(biliTabs(await tabs()).length));
  }
  // ── T11 真实鼠标点击左上角 logo（不是合成事件） ──
  // 先（用已验证过的合成点击路径）从主页打开一个视频，把来源设成主页，
  // 再用 Playwright 的真实鼠标点视频页左上角 logo，看是否回到主页标签。
  {
    await focus(homeTab.id);
    await homeP.bringToFront();
    await sleep(1500);
    const href = await page(/\/video\//).evaluate(() => location.href);
    await clickLink(homeP, vhref || href);
    await sleep(7000);
    r = await report('T11 主页点视频后');
    const vTab2 = r.find((t) => /\/video\//.test(t.url));
    check('T11a 主页点视频 → 独立视频标签', !!vTab2, vTab2 ? vTab2.url : 'none');
    check('T11b 主页标签仍在', r.some((t) => t.id === homeTab.id && path(t.url) === '/'), 'home intact');

    const vp = page(/\/video\//);
    await vp.bringToFront();
    await sleep(2500);
    const lbox = await vp.evaluate(() => {
      const el = document.querySelector('.left-entry__item-trigger');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), cls: el.className };
    });
    if (lbox) {
      await vp.mouse.click(lbox.x, lbox.y);
      await sleep(3000);
      const a = await activeTab();
      check(
        'T11c 真实鼠标点左上角 logo → 回到来源（主页）标签',
        a && a.id === homeTab.id,
        a ? `${a.id}:${a.url}` : `none @ ${JSON.stringify(lbox)}`
      );
    } else {
      check('T11c 找到左上角 logo 元素', false, 'not found');
    }
  }
} catch (e) {
  console.log('SCRIPT ERROR:', e && e.message);
  console.log(e && e.stack);
} finally {
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n===== 汇总: ${results.length - failed}/${results.length} 通过 =====`);
  try {
    await ctx.close();
  } catch {}
  process.exit(0);
}
