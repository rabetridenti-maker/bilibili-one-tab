# Bilibili Single Tab

主页标签**常驻不动**，视频在**独立的单个标签**中打开——B站最多占用两个标签：主页 + 当前视频。

## 功能

- **主页永驻**：主页上点视频 / 番剧 / 直播 / 动态，主页自身永不导航，滚动位置与内容原样保留
- **视频标签复用**：只有一个视频标签；再点其他视频时，自动导航已有视频标签（不会越开越多）
- **回退即回主页**：关闭视频标签（或点 B站 logo 回主页），主页瞬间可见，状态零丢失
- **自动暂停**：点 logo 返回主页时，视频标签中的播放器自动暂停，不在后台继续出声
- **主页单例兜底**：任何方式（含视频标签内手动输入网址）导航到主页时，若已有主页标签则自动关闭多余标签
- **主页自动固定**：主页标签自动 Pin 在标签栏左侧，常驻后台，不易误关
- 外链（跳转淘宝、微博等其他网站）照常新开标签，不受影响
- 支持 `bilibili.com` 全子域名和 `b23.tv` 短链

## 安装（Edge / Chrome）

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 右上角开启 **开发人员模式**
3. 点击 **加载解压缩的扩展**，选择本仓库根目录
4. 刷新 B站页面即可生效

## 文件结构

```
manifest.json     # MV3 声明：background + 双 content script（MAIN / isolated）
background.js     # 视频标签复用 + 主页单例兜底（tabs 操作）
content-main.js   # MAIN world：拦截主页站内链接点击与 window.open
content-bridge.js # isolated world：postMessage → chrome.runtime 消息桥
```

## 原理

1. MAIN world 脚本捕获主页上的站内链接点击（capture 阶段 `preventDefault`），并拦截 `window.open` 站内 URL
2. 通过 `window.postMessage` 把目标 URL 交给 isolated world 桥接脚本
3. 桥接脚本转发 `chrome.runtime.sendMessage` 给 background
4. background 在当前窗口查找已有视频标签：有则 `tabs.update` 导航并聚焦，无则新建
5. 主页单例兜底：`tabs.onUpdated` 检测任何标签导航到主页 URL 且已有主页标签时，关闭多余标签

## 限制

- 中键 / Ctrl+点击仍会新开标签（浏览器原生行为，无法拦截），此时可能出现临时重复标签，主页单例兜底会处理主页重复
- 复用视频标签会覆盖上一个视频的播放进度
- 从站外（搜索引擎、聊天工具）点 B站视频链接：若已有视频标签则复用，否则新建（与主页共用同一套单例逻辑）

## License

MIT
