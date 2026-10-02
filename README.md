# Bilibili Single Tab

B 站每个常用页面**各占一个标签、互不抢占**：主页、动态、搜索各自常驻，视频永远是**独立的同一个标签**。
从动态点开的视频，点左上角 **bilibili logo** 就回到原来的动态界面（那个动态页一直在，不重新加载）。

## 行为

| 你做什么 | 结果 |
| --- | --- |
| 主页 / 动态 / 搜索 里点视频卡片 | 视频在**唯一的视频标签**里打开（没有就新建，有就复用），来源页原地不动 |
| 视频页点左上角 **bilibili logo** | 切回**来源标签**（从动态点开就回动态、从搜索点开就回搜索、从主页点开就回主页） |
| 视频页点顶栏「动态」/「搜索」/「主页」 | 聚焦那个页面的**专属标签**，没有才新建；视频标签保留在后台 |
| 主页点顶栏「动态」 | 复用已有的动态标签，不会越开越多 |
| 离开视频页 | 视频自动暂停，不会在后台偷偷出声（点 logo 回来源页同样暂停） |
| 点站外链接（淘宝、微博…） | 照常新开标签，扩展不干预 |

**标签上限**：主页 1 + 动态 1 + 搜索 1 + 视频 1 = 最多 4 个（用到才开，没用到不开）。

## 已移除的功能（v2.3）

- ❌ **画中画**：视频页右下角那个「画中画」悬浮按钮——删除，脚本也不再申请画中画
- ❌ **后台播放**：视频页右下角的「♪ 后台播放」按钮与 `#bst-bg` 后台槽位——删除

> B 站播放器**自带**的画中画按钮不受影响（那属于 B 站本身，扩展没碰）。

## 安装（Edge / Chrome）

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 右上角开启 **开发人员模式**
3. 点击 **加载解压缩的扩展**，选择本仓库根目录
   - 已经装过旧版：在扩展卡片上点 **重新加载**，再刷新所有 B 站标签
4. F12 Console 输入 `window.__BST__`，看到 `version: '2.3.0'` 说明注入成功

## 文件结构

```
manifest.json     # MV3 声明：background + 双 content script（MAIN / isolated）
background.js     # 标签调度：视频标签复用、来源标签记忆、主页/动态/搜索各一个
content-main.js   # MAIN world：拦截链接点击 / window.open / SPA 路由 / location 直接跳转
content-bridge.js # isolated world：postMessage → chrome.runtime 消息桥
tools/verify.mjs  # 真机验收脚本（Playwright + 本机 Edge，加载未打包扩展跑 40 条断言）
```

## 原理

1. MAIN world 脚本在 **capture 阶段**拦下站内点击：
   - 目标视频 + 当前不是视频页 → `openVideo`（交给唯一的视频标签）
   - 目标 主页/动态/搜索 + 当前是**别的类型**的页面 → `openPage`（交给那个类型的专属标签）
   - 其它（同类页面之间、分区等其它页、外链）→ 放行浏览器原生导航
2. 还有三条"不吃掉来源页"的兜底通道：`window.open`、`history.pushState/replaceState`、`location.href/assign/replace`
3. 桥接脚本把消息转给 background；background 用 `chrome.storage.session` 记住「视频标签 → 来源标签」，
   service worker 被浏览器回收重启后依然记得；标签关闭时自动清理
4. 视频页点 logo → `goBack`：暂停视频 → 聚焦来源标签（不导航、不重载，滚动位置/动态流原样）

## 自检

```js
window.__BST__                    // { version, injected, url, kindOf, isVideoPage, decide }
window.__BST__.kindOf(location.href)   // 当前页被判成哪一类：video/home/dynamic/search/page/external
window.__BST__.decide('https://t.bilibili.com/')  // 该链接会被怎样处理
```

## 真机验收

```bash
node tools/verify.mjs      # 需要本机 Edge；会打开一个临时窗口跑完整流程，最后打印 PASS/FAIL 汇总
```

## 已知限制

- 中键 / Ctrl+点击 仍会新开标签（浏览器原生行为，无法拦截）
- 复用视频标签会覆盖上一个视频的播放进度（这是"只留一个视频标签"的代价）
- 从站外（搜索引擎、聊天工具）点 B 站视频链接：浏览器默认新开标签，扩展不接管站外点击；
  这种视频标签没有来源，点 logo 会自己回主页
- 「相同类型只留一个」只覆盖 **主页 / 动态 / 搜索**；分区、收藏夹、稍后再看等页面不在此列（怕误判成"我的收藏")

## License

MIT
