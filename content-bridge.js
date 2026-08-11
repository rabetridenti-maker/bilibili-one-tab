// Bilibili Single Tab v2 - isolated world content script (message bridge)
// 接收 MAIN world 的 postMessage，转发给 background service worker。

window.addEventListener('message', (e) => {
  const d = e.data;
  if (
    d &&
    d.source === 'bilibili-single-tab' &&
    (d.type === 'openVideo' || d.type === 'focusHome')
  ) {
    chrome.runtime.sendMessage({ type: d.type, url: d.url });
  }
});
