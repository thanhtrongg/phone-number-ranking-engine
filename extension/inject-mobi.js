(function () {
  if (window.__PNRE_INJECTED__) return;
  window.__PNRE_INJECTED__ = true;

  chrome.storage.local.get('mobiPrefixes', function (data) {
    if (data.mobiPrefixes) {
      var arr = data.mobiPrefixes.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (arr.length) document.documentElement.dataset.pnreMobi = JSON.stringify({ prefixes: arr });
    }

    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('simsodepmobi.js');
    document.documentElement.appendChild(s);
  });
})();
