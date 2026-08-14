# Bilibili Single Tab

主页标签由浏览器/用户自行管理（**扩展不固定、不关闭**）；视频在**独立的单个标签**（自动 Pin）中打开。B站视频只占一个标签：当前视频。

## 功能

- **主页不托管**：主页标签完全由浏览器/用户管理——扩展不固定、不关闭、不限制主页标签数量
- **视频标签复用**：只有一个视频标签；再点其他视频时，自动导航已有视频标签（不会越开越多）
- **回退即回主页**：关闭视频标签（或点 B站 logo 回主页），主页瞬间可见，状态零丢失
- **自动暂停**：点 logo 返回主页时，视频标签中的播放器自动暂停，不在后台继续出声
- **双槽位（前台+后台）**：视频页右下角有「♪ 后台播放」按钮，把当前视频放进独立的后台标签（后台打开、不聚焦）——前台继续刷视频，后台照常放音乐；回主页时只有前台视频暂停，后台播放不受影响
- **画中画**：视频页右下角「画中画」按钮，视频弹出悬浮小窗（YouTube 同款），可与其他视频/页面同屏观看
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
background.js     # 视频标签复用 + 后台播放槽位（tabs 操作）
content-main.js   # MAIN world：拦截主页站内链接点击与 window.open
content-bridge.js # isolated world：postMessage → chrome.runtime 消息桥
```

## 原理

1. MAIN world 脚本捕获**非视频页**（主页/动态/搜索/分区等）上的**视频类链接**点击（capture 阶段 `preventDefault`），并拦截 `window.open` 站内视频 URL
2. 通过 `window.postMessage` 把目标 URL 交给 isolated world 桥接脚本
3. 桥接脚本转发 `chrome.runtime.sendMessage` 给 background
4. background 在当前窗口查找已有视频标签：有则 `tabs.update` 导航并聚焦，无则新建（Pin）

## 限制

- 中键 / Ctrl+点击仍会新开标签（浏览器原生行为，无法拦截），此时可能出现重复视频标签，属正常浏览器行为
- 复用视频标签会覆盖上一个视频的播放进度
- 从站外（搜索引擎、聊天工具）点 B站视频链接：浏览器默认新开标签，扩展不接管站外点击

## License

MIT
