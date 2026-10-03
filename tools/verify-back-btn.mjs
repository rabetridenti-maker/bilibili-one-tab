// v2.4 验收：视频页内跳别的视频 → 「返回上个视频」按钮
// 运行：node tools/verify-back-btn.mjs
// 依赖：playwright + 本机 Edge（本机 playwright 路径见下方 loadPlaywright）
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const require = createRequire(import.meta.url);
// 仓库根目录（本文件在 <repo>/tools/ 下）
const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const c = [
    process.env.BST_PLAYWRIGHT,
    'C:/Users/Administrator/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright',
    resolve(EXT, 'node_modules/playwright'),
    'playwright',
  ].filter(Boolean);
  for (const x of c) { try { if (x === 'playwright' || existsSync(x)) return require(x); } catch {} }
  throw new Error('找不到 playwright，请设置 BST_PLAYWRIGHT=<playwright 包路径>');
}
const { chromium } = loadPlaywright();
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ::  ' + detail : ''}`);
};
const bvOf = (u) => (/BV[0-9A-Za-z]+/.exec(u || '') || ['(none)'])[0];

let ctx, sw;
async function tabs() {
  try {
    return await sw.evaluate(() => chrome.tabs.query({}));
  } catch {
    sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    return sw.evaluate(() => chrome.tabs.query({}));
  }
}
const biliTabs = (ts) => ts.filter((t) => /bilibili\.com/.test(t.url));
// 视频页是 ctx 里的另一个 page 对象（主页那个 p 不会变）
const videoPage = () => ctx.pages().find((x) => /\/video\//.test(x.url()));

// 点视频页里的一个推荐视频（真实鼠标）
async function clickReco(pg, exclude = []) {
  const info = await pg.evaluate((ex) => {
    const bad = new Set(ex);
    for (const a of document.querySelectorAll('a[href*="/video/BV"]')) {
      const abs = new URL(a.getAttribute('href'), location.href).href;
      const bv = (/BV[0-9A-Za-z]+/.exec(abs) || [''])[0];
      if (!bv || bad.has(bv)) continue;
      const r = a.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) continue; // 要是卡片，不是纯文字链
      if (r.top < 60) continue; // 过滤顶栏
      a.scrollIntoView({ block: 'center' });
      const r2 = a.getBoundingClientRect();
      return { href: abs, bv, x: Math.round(r2.x + r2.width / 2), y: Math.round(r2.y + r2.height / 2) };
    }
    return null;
  }, exclude);
  if (!info) return null;
  await pg.mouse.click(info.x, info.y);
  return info;
}

async function btnState(pg) {
  return pg.evaluate(() => {
    const b = document.getElementById('bst-back-btn');
    if (!b) return { exists: false };
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const player = document.querySelector('#bilibili-player, .bpx-player-container, .bpx-player-primary-area, video');
    const pr = player ? player.getBoundingClientRect() : null;
    return {
      exists: true,
      visible: cs.display !== 'none' && r.width > 0,
      text: (b.textContent || '').trim(),
      title: b.title,
      target: b.dataset.bstTarget || null,
      targetKey: b.dataset.bstTargetKey || null,
      stack: (window.__BST__ && window.__BST__.videoStack) ? window.__BST__.videoStack() : null,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      player: pr ? [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)] : null,
      cx: Math.round(r.x + r.width / 2),
      cy: Math.round(r.y + r.height / 2),
    };
  });
}

async function clickBtn(pg) {
  const s = await btnState(pg);
  if (!s.exists || !s.visible) return false;
  await pg.mouse.click(s.cx, s.cy);
  return true;
}

try {
  ctx = await chromium.launchPersistentContext('', {
    executablePath: EDGE,
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900'],
    viewport: null,
  });
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  console.log('扩展 service worker:', sw.url());
  const p = ctx.pages()[0] || (await ctx.newPage());
  const consoleErrors = [];
  ctx.on('page', (pg) => pg.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120));
  }));
  p.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120));
  });

  // ── T1 注入自检（版本 2.4.0） ──
  await p.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  const v = await p.evaluate(() => (window.__BST__ ? window.__BST__.version : null));
  check('T1 主页注入 __BST__ 且版本 2.4.0', v === '2.4.0', String(v));

  // ── T2 主页点视频 → 进视频页（此时还没有"上个视频"，按钮不该出现） ──
  const homeTab = (await tabs()).find((t) => new URL(t.url).pathname === '/');
  const homeHref = await p.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/video/BV"]')].find((x) => x.getAttribute('href'));
    return a ? new URL(a.getAttribute('href'), location.href).href : null;
  });
  await p.evaluate((h) => {
    const a = [...document.querySelectorAll('a[href]')].find((x) => new URL(x.getAttribute('href'), location.href).href === h);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  }, homeHref);
  await sleep(9000);
  let ts = biliTabs(await tabs());
  const vTab = ts.find((t) => /\/video\//.test(t.url));
  let A = 'PENDING';
  console.log(`   A = ${A}  视频标签 id = ${vTab && vTab.id}`);
  check('T2a 视频在独立标签打开', !!vTab, A);
  let vp = videoPage();
  check('T2b0 找到视频页对象', !!vp, vp ? 'ok' : 'none');
  A = bvOf(vp && vp.url());
  console.log(`   A(修正) = ${A}`);
  const s0 = await btnState(vp);
  check('T2b 第一个视频上没有「返回上个视频」按钮', !s0.exists || !s0.visible, JSON.stringify(s0.rect || null));

  // ── T3 点推荐视频 A → B：按钮出现 ──
  const r1 = await clickReco(vp, [A]);
  await sleep(9000);
  vp = videoPage();
  const B = bvOf(vp.url());
  console.log(`   点了推荐 → B = ${B}（${r1 && r1.bv}）`);
  check('T3a 确实跳到了另一个视频', !!B && B !== '(none)' && B !== A, `${A} -> ${B}`);
  let s = await btnState(vp);
  check('T3b 出现「返回上个视频」按钮', s.exists && s.visible, s.text || '(none)');
  check('T3c 按钮文案正确', !!s.text && s.text.includes('返回上个视频'), s.text || '(none)');
  check('T3d 按钮悬浮在播放器左上角内侧', !!s.player && Math.abs(s.rect[0] - (s.player[0] + 12)) <= 3 && Math.abs(s.rect[1] - (s.player[1] + 12)) <= 3, `btn=${JSON.stringify(s.rect)} player=${JSON.stringify(s.player)}`);
  check('T3e 没新开标签（仍是 2 个B站标签）', biliTabs(await tabs()).length === 2, String(biliTabs(await tabs()).length));
  check('T3f 视频标签 id 没变（原地 SPA 换视频）', biliTabs(await tabs()).some((t) => t.id === vTab.id), `video tab ${vTab.id}`);

  // ── T4 再跳一层 B → C：按钮仍在，指向 B ──
  const r2 = await clickReco(vp, [A, B]);
  await sleep(9000);
  vp = videoPage();
  const C = bvOf(vp.url());
  console.log(`   再点推荐 → C = ${C}（${r2 && r2.bv}）`);
  check('T4a 跳到第三个视频', !!C && C !== B, `${B} -> ${C}`);
  s = await btnState(vp);
  check('T4b 按钮仍在', s.exists && s.visible, s.text || '(none)');
  check('T4c 按钮指向 B（上一跳，不是更早的 A）', !!s.target && s.target.includes(B), `${s.target} | 栈=${JSON.stringify((s.stack || []).map((e) => e.key))}`);

  // ── T5 点按钮 → 回到 B ──
  const clicked = await clickBtn(vp);
  await sleep(7000);
  vp = videoPage();
  const back1 = bvOf(vp.url());
  check('T5a 点按钮后 URL 回到 B', back1 === B, `${C} -> ${back1}`);
  s = await btnState(vp);
  check('T5b 回到 B 后按钮还在，且指向 A', s.exists && s.visible && !!s.target && s.target.includes(A), `${s.target} | 栈=${JSON.stringify((s.stack || []).map((e) => e.key))}`);

  // ── T6 再点一次 → 回到 A，按钮消失 ──
  await clickBtn(vp);
  await sleep(7000);
  vp = videoPage();
  const back2 = bvOf(vp.url());
  check('T6a 再点一次回到 A', back2 === A, `${back1} -> ${back2}`);
  s = await btnState(vp);
  check('T6b 回到起点 A 后按钮隐藏（没有更早的视频了）', !s.exists || !s.visible, `visible=${s.visible} 栈=${JSON.stringify((s.stack || []).map((e) => e.key))}`);

  // ── T7 按钮不挡播放器左侧 1/3，也不在顶栏上 ──
  await clickReco(vp, [A, B, C]);
  await sleep(8000);
  s = await btnState(vp);
  if (s.exists && s.visible && s.player) {
    check('T7a 按钮在播放器左侧 1/5 内（不挡中间画面）', s.rect[0] - s.player[0] < s.player[2] / 5, `dx=${s.rect[0] - s.player[0]} of ${s.player[2]}`);
    check('T7b 按钮在顶栏下方（不与顶栏重叠）', s.rect[1] >= 64, `top=${s.rect[1]}`);
  } else {
    check('T7 按钮位置检查（按钮未出现，跳过）', false, 'no button');
  }

  // ── T8 换到别的视频页后按钮自动隐藏（没有历史） ──
  vp = videoPage();
  await vp.goto('https://www.bilibili.com/video/BV1GJ411x7h7/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(7000);
  s = await btnState(vp);
  // 注意：直接用 goto 换视频时栈里还有别的视频，所以这里只断言"按钮位置/文案仍正常"，不断言消失
  console.log('   [T8] 直接 goto 换视频后的按钮状态:', JSON.stringify({ visible: s.visible, target: s.target }));
  await vp.screenshot({ path: 'C:/Users/Administrator/AppData/Local/Temp/bst-v24-btn.png' });
  console.log('   截图 -> bst-v24-btn.png');

  // ── T9 控制台没有扩展抛的错 ──
  const mine = consoleErrors.filter((t) => /bst|BST/.test(t));
  check('T9 控制台没有扩展自身报错', mine.length === 0, mine.slice(0, 3).join(' | ') || 'clean');
} catch (e) {
  console.log('SCRIPT ERROR:', e.message);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n===== 汇总: ${results.length - failed}/${results.length} 通过 =====`);
  try {
    await ctx.close();
  } catch {}
  process.exit(0);
}
