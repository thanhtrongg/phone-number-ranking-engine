const statusEl = document.getElementById('status');
const carrierEl = document.getElementById('carrier');
const mobiInput = document.getElementById('mobiPrefixes');
const viettelInput = document.getElementById('viettelKeySearches');

function loadSettings() {
  chrome.storage.local.get(['mobiPrefixes', 'viettelKeySearches'], function (data) {
    if (data.mobiPrefixes) mobiInput.value = data.mobiPrefixes;
    if (data.viettelKeySearches) viettelInput.value = data.viettelKeySearches;
  });
}

function saveSettings() {
  chrome.storage.local.set({
    mobiPrefixes: mobiInput.value,
    viettelKeySearches: viettelInput.value,
  });
}

mobiInput.addEventListener('change', saveSettings);
viettelInput.addEventListener('change', saveSettings);

function detectCarrier(url) {
  if (/mobifone/i.test(url)) return 'mobi';
  if (/viettel/i.test(url)) return 'viettel';
  return null;
}

async function autoDetect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    carrierEl.textContent = '⚠️ Không xác định được trang';
    carrierEl.className = 'detect-none';
    return null;
  }
  const carrier = detectCarrier(tab.url);
  if (carrier === 'mobi') {
    carrierEl.textContent = '📱 Đã phát hiện: Mobifone';
    carrierEl.className = 'detect-mobi';
    return 'mobi';
  }
  if (carrier === 'viettel') {
    carrierEl.textContent = '📱 Đã phát hiện: Viettel';
    carrierEl.className = 'detect-viettel';
    return 'viettel';
  }
  carrierEl.textContent = '⚠️ Không phải Mobifone hay Viettel';
  carrierEl.className = 'detect-none';
  return null;
}

async function runScript(injectFile) {
  document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  statusEl.textContent = 'Đang chạy...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      statusEl.textContent = 'Lỗi: không tìm thấy tab';
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: [injectFile],
    });

    statusEl.textContent = 'Đã chạy xong!';
    setTimeout(window.close, 1000);
  } catch (err) {
    statusEl.textContent = 'Lỗi: ' + err.message;
    document.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
  }
}

document.getElementById('runMobi').addEventListener('click', function () {
  var prefixes = mobiInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (prefixes.length === 0) {
    statusEl.textContent = 'Lỗi: nhập ít nhất 1 đầu số';
    return;
  }
  runScript('inject-mobi.js');
});

document.getElementById('runViettel').addEventListener('click', function () {
  var keys = viettelInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (keys.length === 0) {
    statusEl.textContent = 'Lỗi: nhập ít nhất 1 đầu số';
    return;
  }
  runScript('inject-viettel.js');
});

loadSettings();
autoDetect();
