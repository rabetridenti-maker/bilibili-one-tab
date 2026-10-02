// Bilibili Single Tab v2.3 - isolated world content script (message bridge)
// 接收 MAIN world 的 postMessage，转发给 background service worker。

window.addEventListener('message', (e) => {
  const d = e.data;
  if (
    d &&
    d.source === 'bilibili-single-tab' &&
    ['openVideo', 'goBack', 'openPage'].includes(d.type)
  ) {
    chrome.runtime.sendMessage({ type: d.type, url: d.url });
  }
});

// 收到 background 指令：暂停当前页面的视频（离开视频页时不再后台出声）
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'pauseVideo') {
    document.querySelectorAll('video').forEach((v) => v.pause());
  }
});
