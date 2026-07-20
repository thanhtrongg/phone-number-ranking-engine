(function () {
  if (window.__PNRE_INJECTED__) return;
  window.__PNRE_INJECTED__ = true;

  chrome.storage.local.get('viettelKeySearches', function (data) {
    if (data.viettelKeySearches) {
      var arr = data.viettelKeySearches.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (arr.length) document.documentElement.dataset.pnreViettel = JSON.stringify({ keySearches: arr });
    }

    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('simsodepviettel.js');
    document.documentElement.appendChild(s);
  });
})();
