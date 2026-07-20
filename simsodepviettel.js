(async () => {
  const CONFIG = {
    keySearches: ["09*"], // Có thể thêm "03*", "08*", "086*"
    isdnType: 2,
    pageSize: 45,

    minScore: 45,
    maxPagesPerKey: 500,
    maxEmptyPages: 5,

    // Chạy chậm để tránh bị chặn
    delayBetweenRequestsMin: 4500,
    delayBetweenRequestsMax: 9000,

    // Nếu bị 403 / 429 thì nghỉ lâu hơn
    cooldownOnBlockMin: 60000,
    cooldownOnBlockMax: 180000,

    // Nếu muốn lấy cả số có 4 thì đổi thành []
    avoidDigits: [],

    downloadAll: true,
    downloadBeautiful: true,

    // Lưu tiến độ để bị chặn/chạy lại không mất dữ liệu
    storageKeyPrefix: "viettel_sim_scan_cache_v2",

    // true = tiếp tục từ cache cũ nếu có
    resumeFromCache: true,
  };

  if (document.documentElement.dataset.pnreViettel)
    Object.assign(CONFIG, JSON.parse(document.documentElement.dataset.pnreViettel));

  const API_BASE =
    "https://apigami.viettel.vn/mvt-api/myviettel.php/omiSearchSimV2";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async function humanDelay() {
    const ms = randomInt(
      CONFIG.delayBetweenRequestsMin,
      CONFIG.delayBetweenRequestsMax,
    );

    console.log(
      `Nghỉ ${Math.round(ms / 1000)} giây trước request tiếp theo...`,
    );
    await sleep(ms);
  }

  async function cooldown(reason = "Có dấu hiệu bị chặn") {
    const ms = randomInt(CONFIG.cooldownOnBlockMin, CONFIG.cooldownOnBlockMax);

    console.warn(
      `${reason}. Nghỉ ${Math.round(ms / 1000)} giây rồi thử lại...`,
    );
    await sleep(ms);
  }

  function normalizePhone(raw) {
    let s = String(raw ?? "").replace(/\D/g, "");

    if (s.startsWith("84") && s.length === 11) {
      s = "0" + s.slice(2);
    }

    // Viettel trả isdn 9 số, ví dụ 971604184 => 0971604184
    if (s.length === 9 && /^[35789]\d{8}$/.test(s)) {
      s = "0" + s;
    }

    return s;
  }

  function isPhone(phone) {
    return /^0(?:3|5|7|8|9)\d{8}$/.test(phone);
  }

  function hasAvoidDigit(phone) {
    return CONFIG.avoidDigits.some((digit) => phone.includes(digit));
  }

  function isAllowedPhone(phone) {
    return isPhone(phone) && !hasAvoidDigit(phone);
  }

  function extractArrayFromResponse(json) {
    if (Array.isArray(json)) return json;

    const candidates = [
      json?.data,
      json?.data?.data,
      json?.data?.list,
      json?.data?.rows,
      json?.data?.items,
      json?.list,
      json?.rows,
      json?.items,
      json?.result,
      json?.result?.data,
      json?.result?.list,
    ];

    for (const item of candidates) {
      if (Array.isArray(item)) return item;
    }

    const arrays = [];

    function walk(value) {
      if (!value) return;

      if (Array.isArray(value)) {
        arrays.push(value);
        value.forEach(walk);
        return;
      }

      if (typeof value === "object") {
        Object.values(value).forEach(walk);
      }
    }

    walk(json);

    return arrays.sort((a, b) => b.length - a.length)[0] || [];
  }

  function extractItems(json, page, keySearch, totalRecord) {
    const arr = extractArrayFromResponse(json);

    return arr
      .map((row) => {
        const phone = normalizePhone(
          row?.isdn ?? row?.msisdn ?? row?.phone ?? row?.number,
        );

        if (!isPhone(phone)) return null;

        return {
          phone,
          keySearch,
          page,
          total_record: totalRecord,
          pre_price: row?.pre_price ?? row?.prePrice ?? row?.price ?? "",
          pos_price: row?.pos_price ?? row?.posPrice ?? "",
          pledge_time: row?.pledge_time ?? "",
          pledge_amount: row?.pledge_amount ?? "",
          ownerId: row?.ownerId ?? "",
          raw: row,
        };
      })
      .filter(Boolean);
  }

  function getTotalRecord(page) {
    // Viettel thường dùng:
    // page 1 => total_record 1
    // page 2 => total_record 46
    // page 3 => total_record 91
    return (page - 1) * CONFIG.pageSize + 1;
  }

  async function fetchRawPage(keySearch, page, totalRecord) {
    const params = new URLSearchParams({
      isdn_type: String(CONFIG.isdnType),
      page_type: "",
      page: String(page),
      page_size: String(CONFIG.pageSize),
      key_search: keySearch,
      total_record: String(totalRecord),
      captcha: "",
      sid: "",
    });

    const url = `${API_BASE}?${params.toString()}`;

    await humanDelay();

    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: {
        accept: "application/json, text/plain, */*",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });

    if (res.status === 403 || res.status === 429) {
      throw new Error(`BLOCKED_${res.status}`);
    }

    if (!res.ok) {
      throw new Error(`HTTP_${res.status}`);
    }

    return await res.json();
  }

  async function fetchPage(keySearch, page, retry = 3) {
    const totalRecord = getTotalRecord(page);

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        const json = await fetchRawPage(keySearch, page, totalRecord);
        const items = extractItems(json, page, keySearch, totalRecord);

        return {
          keySearch,
          page,
          total_record: totalRecord,
          json,
          items,
        };
      } catch (err) {
        const message = String(err.message || "");

        if (
          message.includes("BLOCKED_403") ||
          message.includes("BLOCKED_429")
        ) {
          await cooldown(
            `[${keySearch}] Page ${page} bị server chặn ${message}`,
          );
          continue;
        }

        console.warn(
          `[${keySearch}] Page ${page}, attempt ${attempt + 1}/${retry + 1} lỗi:`,
          message,
        );

        await sleep(3000 + attempt * 3000);
      }
    }

    return {
      keySearch,
      page,
      total_record: totalRecord,
      json: null,
      items: [],
    };
  }

  function isIncreasing(s) {
    for (let i = 1; i < s.length; i++) {
      if (+s[i] !== +s[i - 1] + 1) return false;
    }

    return true;
  }

  function isDecreasing(s) {
    for (let i = 1; i < s.length; i++) {
      if (+s[i] !== +s[i - 1] - 1) return false;
    }

    return true;
  }

  function getRuns(s) {
    const runs = [];
    let start = 0;

    for (let i = 1; i <= s.length; i++) {
      if (s[i] !== s[start]) {
        const length = i - start;

        if (length >= 2) {
          runs.push({
            digit: s[start],
            length,
            text: s.slice(start, i),
          });
        }

        start = i;
      }
    }

    return runs;
  }

  function getTwoBlockTailTags(s) {
    const tags = [];
    let m;

    m = s.match(/(\d)\1(\d)\2{2}$/);
    if (m && m[1] !== m[2]) tags.push("đuôi AA-BBB");

    m = s.match(/(\d)\1{2}(\d)\2$/);
    if (m && m[1] !== m[2]) tags.push("đuôi AAA-BB");

    m = s.match(/(\d)\1{2}(\d)\2{2}$/);
    if (m && m[1] !== m[2]) tags.push("đuôi AAA-BBB");

    m = s.match(/(\d)\1(\d)\2$/);
    if (m && m[1] !== m[2]) tags.push("đuôi AA-BB");

    m = s.match(/(\d)\1(\d)\2{3}$/);
    if (m && m[1] !== m[2]) tags.push("đuôi AA-BBBB");

    m = s.match(/(\d)\1{3}(\d)\2$/);
    if (m && m[1] !== m[2]) tags.push("đuôi AAAA-BB");

    return tags;
  }

  function scorePhone(phone) {
    const p = normalizePhone(phone);

    const last2 = p.slice(-2);
    const last3 = p.slice(-3);
    const last4 = p.slice(-4);
    const last5 = p.slice(-5);
    const last6 = p.slice(-6);
    const last7 = p.slice(-7);
    const last8 = p.slice(-8);

    let score = 0;
    const tags = [];

    function add(point, tag) {
      score += point;
      tags.push(tag);
    }

    // Sảnh tiến, ưu tiên cao
    if (isIncreasing(last6)) add(180, "sảnh tiến 6 số cuối");
    else if (isIncreasing(last5)) add(150, "sảnh tiến 5 số cuối");
    else if (isIncreasing(last4)) add(115, "sảnh tiến 4 số cuối");
    else if (isIncreasing(last3)) add(65, "sảnh tiến 3 số cuối");

    // Sảnh lùi
    if (isDecreasing(last6)) add(115, "sảnh lùi 6 số cuối");
    else if (isDecreasing(last5)) add(90, "sảnh lùi 5 số cuối");
    else if (isDecreasing(last4)) add(65, "sảnh lùi 4 số cuối");

    // Quý, hoa cuối
    if (/(\d)\1{5}$/.test(p)) add(210, "lục quý cuối");
    else if (/(\d)\1{4}$/.test(p)) add(180, "ngũ quý cuối");
    else if (/(\d)\1{3}$/.test(p)) add(155, "tứ quý cuối");
    else if (/(\d)\1{2}$/.test(p)) add(95, "tam hoa cuối");

    // Quý, hoa trong đuôi
    if (/(\d)\1{4}/.test(last8)) add(120, "ngũ quý trong đuôi");
    else if (/(\d)\1{3}/.test(last8)) add(100, "tứ quý trong đuôi");
    else if (/(\d)\1{2}/.test(last8)) add(70, "tam hoa trong đuôi");

    // AABBB, AAABB, 77666, 22111, 88822
    const blockTags = [
      ...getTwoBlockTailTags(last4),
      ...getTwoBlockTailTags(last5),
      ...getTwoBlockTailTags(last6),
    ];

    [...new Set(blockTags)].forEach((tag) => {
      if (tag === "đuôi AA-BBB") add(145, tag);
      else if (tag === "đuôi AAA-BB") add(145, tag);
      else if (tag === "đuôi AAA-BBB") add(175, tag);
      else if (tag === "đuôi AA-BBBB") add(165, tag);
      else if (tag === "đuôi AAAA-BB") add(165, tag);
      else if (tag === "đuôi AA-BB") add(85, tag);
    });

    // Cụm giống nhau trong 8 số cuối
    const runs = getRuns(last8);
    const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);

    if (maxRun >= 5) add(125, "cụm 5 số giống nhau trong đuôi");
    else if (maxRun === 4) add(105, "cụm 4 số giống nhau trong đuôi");
    else if (maxRun === 3) add(65, "cụm 3 số giống nhau trong đuôi");

    if (
      runs.some((r) => r.length >= 3) &&
      runs.some((r) => r.length >= 2) &&
      runs.length >= 2
    ) {
      add(75, "combo tam hoa + cặp kép");
    }

    // Tam hoa gần cuối
    if (/(\d)\1{2}\d$/.test(last4)) add(55, "tam hoa sát cuối");
    if (/(\d)\1{2}\d{1,2}$/.test(last5) || /(\d)\1{2}\d{1,3}$/.test(last6)) {
      add(40, "tam hoa gần cuối");
    }

    // Gánh
    if (/(\d)(\d)(\d)\3\2\1$/.test(p)) add(120, "gánh 6 số cuối");
    else if (/(\d)(\d)(\d)\2\1$/.test(p)) add(95, "gánh 5 số cuối");
    else if (/(\d)(\d)\2\1$/.test(p)) add(70, "gánh 4 số cuối");

    // Lặp cụm
    if (/(\d{3})\1$/.test(p)) add(120, "lặp bộ 3 cuối");
    else if (/(\d{2})\1\1$/.test(p)) add(105, "3 cặp lặp cuối");
    else if (/(\d{2})\1$/.test(p)) add(80, "lặp cặp cuối");

    if (/(\d{3})\1/.test(last8)) add(85, "lặp bộ 3 trong đuôi");
    else if (/(\d{2})\1/.test(last8)) add(55, "lặp cặp trong đuôi");

    // Cặp kép cuối
    if (/(\d)\1(\d)\2(\d)\3$/.test(p)) add(105, "3 cặp kép cuối");
    else if (/(\d)\1(\d)\2$/.test(p)) add(70, "2 cặp kép cuối");

    if (/(\d)\1/.test(last7)) add(25, "có cặp kép trong đuôi");

    // Cặp đẹp
    if (["68", "86"].includes(last2)) add(60, "lộc phát cuối");
    if (["39", "79"].includes(last2)) add(55, "thần tài cuối");
    if (["38", "78"].includes(last2)) add(45, "ông địa cuối");
    if (["88", "99", "66"].includes(last2)) add(45, "đuôi kép đẹp");

    if (/(68|86)/.test(last8)) add(35, "có lộc phát trong đuôi");
    if (/(39|79)/.test(last8)) add(30, "có thần tài trong đuôi");
    if (/(38|78)/.test(last8)) add(25, "có ông địa trong đuôi");

    // ABAB / ABCABC
    if (/(\d{3})\1$/.test(last6)) add(100, "đuôi ABC-ABC");
    if (/(\d{2})(\d{2})\1$/.test(last6)) add(75, "đuôi AB-CD-AB");
    if (/(\d{2})\1$/.test(last4)) add(70, "đuôi AB-AB");

    // Có cặp đẹp trong đuôi
    const nicePairs = ["66", "88", "99", "55", "22", "33", "77", "11"];
    nicePairs.forEach((pair) => {
      if (last7.includes(pair)) {
        add(20, `có cặp ${pair} trong đuôi`);
      }
    });

    // Dễ nhớ vì ít chữ số
    const uniqueLast6 = new Set(last6).size;
    const uniqueLast7 = new Set(last7).size;
    const uniqueLast8 = new Set(last8).size;

    if (uniqueLast8 <= 3) add(80, "8 số cuối rất dễ nhớ");
    else if (uniqueLast7 <= 3) add(65, "7 số cuối dễ nhớ");
    else if (uniqueLast6 <= 3) add(50, "6 số cuối dễ nhớ");
    else if (uniqueLast6 <= 4) add(25, "6 số cuối tương đối dễ nhớ");

    // Combo kiểu 86 + 555
    if (/(68|86).*(\d)\2{2}/.test(last8) || /(\d)\1{2}.*(68|86)/.test(last8)) {
      add(55, "combo lộc phát + tam hoa");
    }

    if (
      /(11|22|33|55|66|77|88|99).*(\d)\2{2}/.test(last8) ||
      /(\d)\1{2}.*(11|22|33|55|66|77|88|99)/.test(last8)
    ) {
      add(50, "combo cặp đẹp + tam hoa");
    }

    if (/86.*555/.test(last8) || /555.*86/.test(last8)) {
      add(55, "combo 86 và 555");
    }
    if (/68.*888/.test(last8) || /888.*68/.test(last8)) {
      add(55, "combo 68 và 888");
    }
    if (/79.*999/.test(last8) || /999.*79/.test(last8)) {
      add(55, "combo 79 và 999");
    }

    if (["49", "53"].includes(last2)) {
      score -= 45;
      tags.push("đuôi dễ bị kiêng");
    }

    return {
      score,
      reason: tags.join(", ") || "bình thường",
    };
  }

  window.testViettelScore = function (phone) {
    const result = scorePhone(phone);
    console.log(phone, result);
    return result;
  };

  function csvEscape(value) {
    const s = String(value ?? "");
    return `"${s.replaceAll('"', '""')}"`;
  }

  function downloadCSV(filename, rows, columns) {
    const header = columns.join(",");
    const body = rows
      .map((row) => columns.map((col) => csvEscape(row[col])).join(","))
      .join("\n");

    const csv = "\ufeff" + header + "\n" + body;

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();

    a.remove();
    URL.revokeObjectURL(url);
  }

  function getStorageKey(keySearch) {
    return `${CONFIG.storageKeyPrefix}:${keySearch}`;
  }

  function loadProgress(keySearch) {
    if (!CONFIG.resumeFromCache) return null;

    try {
      const raw = localStorage.getItem(getStorageKey(keySearch));
      if (!raw) return null;

      const data = JSON.parse(raw);

      if (!data || !Array.isArray(data.items)) return null;

      console.log(
        `[${keySearch}] Tìm thấy cache: lastPage=${data.lastPage}, items=${data.items.length}`,
      );

      return data;
    } catch {
      return null;
    }
  }

  function saveProgress(keySearch, lastPage, items) {
    try {
      localStorage.setItem(
        getStorageKey(keySearch),
        JSON.stringify({
          keySearch,
          lastPage,
          items,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      console.warn("Không lưu được localStorage, có thể dữ liệu quá lớn.");
    }
  }

  function clearProgress(keySearch) {
    localStorage.removeItem(getStorageKey(keySearch));
  }

  window.clearViettelScanCache = function () {
    CONFIG.keySearches.forEach(clearProgress);
    console.log("Đã xóa cache scan Viettel.");
  };

  async function fetchAllForKey(keySearch) {
    let allItems = [];
    let startPage = 1;
    let emptyStreak = 0;

    const cached = loadProgress(keySearch);

    if (cached) {
      allItems = cached.items || [];
      startPage = Number(cached.lastPage || 0) + 1;
    }

    console.log(`[${keySearch}] Bắt đầu tải từ page ${startPage}...`);

    for (let page = startPage; page <= CONFIG.maxPagesPerKey; page++) {
      console.log(`[${keySearch}] Đang tải page ${page}...`);

      const result = await fetchPage(keySearch, page);
      const items = result.items || [];

      if (items.length === 0) {
        emptyStreak++;

        console.log(
          `[${keySearch}] Page ${page} rỗng. Empty streak: ${emptyStreak}/${CONFIG.maxEmptyPages}`,
        );

        saveProgress(keySearch, page, allItems);

        if (emptyStreak >= CONFIG.maxEmptyPages) {
          console.log(`[${keySearch}] Nhiều page rỗng liên tiếp, dừng.`);
          break;
        }

        continue;
      }

      emptyStreak = 0;
      allItems.push(...items);

      console.log(
        `[${keySearch}] Page ${page} có ${items.length} dòng. Tổng raw hiện tại: ${allItems.length}`,
      );

      saveProgress(keySearch, page, allItems);
    }

    console.log(`[${keySearch}] Tổng dòng raw tải được: ${allItems.length}`);

    return allItems;
  }

  console.log("Test score:");
  console.log("0977766666:", scorePhone("0977766666"));
  console.log("0970022111:", scorePhone("0970022111"));
  console.log("0970088822:", scorePhone("0970088822"));
  console.log("0971234567:", scorePhone("0971234567"));

  console.log("Muốn xóa cache cũ thì chạy: clearViettelScanCache()");

  const rawItems = [];

  for (const keySearch of CONFIG.keySearches) {
    const items = await fetchAllForKey(keySearch);
    rawItems.push(...items);
  }

  const rawMap = new Map();

  for (const item of rawItems) {
    if (!item.phone || !isPhone(item.phone)) continue;

    if (!rawMap.has(item.phone)) {
      rawMap.set(item.phone, item);
    }
  }

  const filteredMap = new Map();

  for (const item of rawMap.values()) {
    if (!isAllowedPhone(item.phone)) continue;

    if (!filteredMap.has(item.phone)) {
      filteredMap.set(item.phone, item);
    }
  }

  const allSims = [...filteredMap.values()]
    .map((item) => {
      const result = scorePhone(item.phone);

      return {
        phone: item.phone,
        score: result.score,
        keySearch: item.keySearch,
        page: item.page,
        total_record: item.total_record,
        pre_price: item.pre_price,
        pos_price: item.pos_price,
        pledge_time: item.pledge_time,
        pledge_amount: item.pledge_amount,
        reason: result.reason,
      };
    })
    .sort((a, b) => b.score - a.score);

  const beautifulSims = allSims
    .filter((item) => item.score >= CONFIG.minScore)
    .sort((a, b) => b.score - a.score);

  window.viettelRawItems = rawItems;
  window.viettelRawUniqueSims = [...rawMap.values()];
  window.viettelAllSims = allSims;
  window.viettelBeautifulSims = beautifulSims;

  console.log(`Raw dòng tải được: ${rawItems.length}`);
  console.log(`Raw sim unique trước khi né số: ${rawMap.size}`);
  console.log(
    `Sim còn lại sau khi né ${CONFIG.avoidDigits.join(",") || "không né"}: ${allSims.length}`,
  );
  console.log(
    `Số đẹp đạt minScore ${CONFIG.minScore}: ${beautifulSims.length}`,
  );

  console.table(beautifulSims.slice(0, 300));

  const time = new Date().toISOString().replaceAll(":", "-").slice(0, 19);

  const keyName = CONFIG.keySearches
    .join("_")
    .replaceAll("*", "x")
    .replaceAll("/", "_");

  const avoidName = CONFIG.avoidDigits.length
    ? `no_${CONFIG.avoidDigits.join("")}`
    : "all_digits";

  if (CONFIG.downloadAll) {
    downloadCSV(
      `viettel_${keyName}_all_sims_${avoidName}_${time}.csv`,
      allSims,
      [
        "phone",
        "score",
        "keySearch",
        "page",
        "total_record",
        "pre_price",
        "pos_price",
        "pledge_time",
        "pledge_amount",
        "reason",
      ],
    );
  }

  if (CONFIG.downloadBeautiful) {
    downloadCSV(
      `viettel_${keyName}_beautiful_sims_${avoidName}_${time}.csv`,
      beautifulSims,
      [
        "phone",
        "score",
        "keySearch",
        "page",
        "total_record",
        "pre_price",
        "pos_price",
        "pledge_time",
        "pledge_amount",
        "reason",
      ],
    );
  }

  try {
    await navigator.clipboard.writeText(
      beautifulSims
        .map((item) => `${item.phone} | ${item.score} điểm | ${item.reason}`)
        .join("\n"),
    );

    console.log("Đã copy danh sách số đẹp vào clipboard.");
  } catch {
    console.log(
      "Không copy clipboard được, xem CSV hoặc window.viettelBeautifulSims.",
    );
  }

  console.log("Hoàn tất.");
})();
