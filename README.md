# Bilibili Single Tab

让 B站站内链接都在**当前标签页**打开，像 YouTube 一样只保留一个 B站标签页。

## 功能

- B站站内点击视频 / 番剧 / 直播 / 动态 → 当前标签页直接跳转，不新开标签
- **主页滚动位置记忆**：从主页点进视频，浏览器返回时自动恢复主页的滚动位置
- B站里点击外链（跳转淘宝、微博等其他网站）→ 照常新开标签，不受影响
- 支持 `bilibili.com` 全子域名和 `b23.tv` 短链
- SPA 动态加载的内容也能覆盖（MutationObserver 持续监听）

## 安装（Edge / Chrome）

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 右上角开启 **开发人员模式**
3. 点击 **加载解压缩的扩展**，选择本仓库根目录
4. 刷新 B站页面即可生效

## 文件结构

```
manifest.json   # MV3 扩展声明，content script 以 MAIN world 注入
content.js      # 核心逻辑：改写 target="_blank" + 拦截 window.open
```

## 原理

- content script 以 `world: "MAIN"` 注入页面世界，可拦截 `window.open`
- 移除站内链接的 `target="_blank"` 属性 → 点击即当前页导航
- 拦截 `window.open`：站内 URL 改为 `location.href` 跳转，站外 URL 放行
- `MutationObserver` 监听 DOM 变化，覆盖 B站 SPA 滚动加载的内容

## 限制

- 中键 / Ctrl+点击仍会新开标签（浏览器原生行为，无法拦截）
- 从站外（搜索引擎、聊天工具）点击 B站链接仍会新开标签（扩展只运行在 B站页面内）

## License

MIT
