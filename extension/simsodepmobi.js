(async () => {
  const CONFIG = {
    prefixes: ["093", "090", "077", "078", "079", "089", "070"],
    type: "TRA_TRUOC",
    status: "HIEN_THI",

    size: 100,
    minScore: 45,
    concurrency: 5,
    maxPages: 10000,
    delayBetweenBatches: 250,

    avoidDigits: [],

    debugFirstPage: false,
  };

  if (document.documentElement.dataset.pnreMobi)
    Object.assign(CONFIG, JSON.parse(document.documentElement.dataset.pnreMobi));

  const API_URL = "https://khosim.mobifone.vn/api/sim/getPages";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizePhone(raw) {
    let s = String(raw ?? "").replace(/\D/g, "");

    if (s.startsWith("84") && s.length === 11) {
      s = "0" + s.slice(2);
    }

    if (s.length === 9 && /^[35789]\d{8}$/.test(s)) {
      s = "0" + s;
    }

    return s;
  }

  function isPhone(phone) {
    return /^0(?:3|5|7|8|9)\d{8}$/.test(phone);
  }

  function hasAvoidDigit(phone) {
    const p = normalizePhone(phone);
    return CONFIG.avoidDigits.some((digit) => p.includes(digit));
  }

  function matchPrefixes(phone) {
    return CONFIG.prefixes.some((prefix) => phone.startsWith(prefix));
  }

  function extractPhonesFromText(text) {
    const raw = String(text ?? "");
    const regex = /(?:\+?84|0)?(?:3|5|7|8|9)(?:[\s.\-]?\d){8}/g;
    const matches = raw.match(regex) || [];

    return [
      ...new Set(
        matches
          .map(normalizePhone)
          .filter((phone) => isPhone(phone) && matchPrefixes(phone)),
      ),
    ];
  }

  function collectPhonesDeep(value, output = []) {
    if (value === null || value === undefined) return output;

    if (typeof value === "string" || typeof value === "number") {
      output.push(...extractPhonesFromText(value));
      return output;
    }

    if (Array.isArray(value)) {
      for (const item of value) collectPhonesDeep(item, output);
      return output;
    }

    if (typeof value === "object") {
      for (const val of Object.values(value)) collectPhonesDeep(val, output);
    }

    return output;
  }

  function findArraysDeep(value, output = []) {
    if (value === null || value === undefined) return output;

    if (Array.isArray(value)) {
      output.push(value);
      for (const item of value) findArraysDeep(item, output);
      return output;
    }

    if (typeof value === "object") {
      for (const val of Object.values(value)) findArraysDeep(val, output);
    }

    return output;
  }

  function extractPrice(item) {
    if (!item || typeof item !== "object") return "";

    const priceKeys = [
      "feeRegister",
      "fee_register",
      "fee",
      "price",
      "amount",
      "money",
      "gia",
      "priceSim",
      "simPrice",
      "feeRegisterStr",
    ];

    const stack = [item];

    while (stack.length) {
      const cur = stack.pop();

      if (!cur || typeof cur !== "object") continue;

      for (const key of priceKeys) {
        if (cur[key] !== undefined && cur[key] !== null && cur[key] !== "") {
          return cur[key];
        }
      }

      for (const val of Object.values(cur)) {
        if (val && typeof val === "object") stack.push(val);
      }
    }

    return "";
  }

  function extractItems(json, page, prefix) {
    const arrays = findArraysDeep(json);
    let bestItems = [];

    for (const arr of arrays) {
      if (!arr.length) continue;

      const items = [];

      for (const row of arr) {
        const phones = [...new Set(collectPhonesDeep(row))];

        for (const phone of phones) {
          if (!phone.startsWith(prefix)) continue;

          items.push({
            phone,
            price: extractPrice(row),
            page,
            prefix,
            raw: row,
          });
        }
      }

      if (items.length > bestItems.length) {
        bestItems = items;
      }
    }

    if (bestItems.length === 0) {
      const phones = [...new Set(collectPhonesDeep(json))];

      bestItems = phones
        .filter((phone) => phone.startsWith(prefix))
        .map((phone) => ({
          phone,
          price: "",
          page,
          prefix,
          raw: null,
        }));
    }

    const map = new Map();

    for (const item of bestItems) {
      if (!item.phone || !isPhone(item.phone) || !item.phone.startsWith(prefix))
        continue;
      if (!map.has(item.phone)) map.set(item.phone, item);
    }

    return [...map.values()];
  }

  function getTotalPages(json, size) {
    const candidates = [];

    function walk(value, keyName = "") {
      if (value === null || value === undefined) return;

      if (typeof value === "number" || typeof value === "string") {
        const key = keyName.toLowerCase();
        const n = Number(value);

        if (!Number.isFinite(n) || n <= 0) return;

        if (
          key.includes("totalpage") ||
          key.includes("total_page") ||
          key.includes("pagetotal") ||
          key === "pages"
        ) {
          candidates.push({ type: "pages", value: n });
        }

        if (
          key.includes("totalelement") ||
          key.includes("totalrecord") ||
          key.includes("recordstotal") ||
          key === "total"
        ) {
          candidates.push({ type: "records", value: n });
        }

        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) walk(item, keyName);
        return;
      }

      if (typeof value === "object") {
        for (const [key, val] of Object.entries(value)) walk(val, key);
      }
    }

    walk(json);

    const pageCandidate = candidates.find((x) => x.type === "pages");
    if (pageCandidate) return Math.ceil(pageCandidate.value);

    const recordCandidate = candidates.find((x) => x.type === "records");
    if (recordCandidate) return Math.ceil(recordCandidate.value / size);

    return null;
  }

  async function fetchPage(prefix, page, size, retry = 2) {
    const body = {
      type: CONFIG.type,
      msisdnPrefix: prefix,
      msisdn: "",
      status: CONFIG.status,
      page,
      size,
      feeRegisterFrom: null,
      feeRegisterTo: null,
    };

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          mode: "cors",
          credentials: "include",
          cache: "no-store",
          referrer: "https://simso.mobifone.vn/",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const items = extractItems(json, page, prefix);

        return { prefix, page, size, json, items };
      } catch (err) {
        if (attempt === retry) {
          console.warn(`Lỗi prefix ${prefix}, page ${page}:`, err.message);
          return {
            prefix,
            page,
            size,
            json: null,
            items: [],
            error: err.message,
          };
        }

        await sleep(600);
      }
    }
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
        const digit = s[start];
        const length = i - start;

        if (length >= 2) {
          runs.push({
            digit,
            length,
            start,
            end: i - 1,
            text: s.slice(start, i),
          });
        }

        start = i;
      }
    }

    return runs;
  }

  function hasTwoBlockTail(s) {
    const patterns = [];

    // AABBB, ví dụ 77666, 22111, 55666
    let m = s.match(/(\d)\1(\d)\2{2}$/);
    if (m && m[1] !== m[2]) {
      patterns.push("đuôi AA-BBB");
    }

    // AAABBB, ví dụ 888666
    m = s.match(/(\d)\1{2}(\d)\2{2}$/);
    if (m && m[1] !== m[2]) {
      patterns.push("đuôi AAA-BBB");
    }

    // AAABB, ví dụ 88822, 66677
    m = s.match(/(\d)\1{2}(\d)\2$/);
    if (m && m[1] !== m[2]) {
      patterns.push("đuôi AAA-BB");
    }

    // AABB, ví dụ 7788, 2266
    m = s.match(/(\d)\1(\d)\2$/);
    if (m && m[1] !== m[2]) {
      patterns.push("đuôi AA-BB");
    }

    // AABBBB hoặc AAAABB
    m = s.match(/(\d)\1(\d)\2{3}$/);
    if (m && m[1] !== m[2]) {
      patterns.push("đuôi AA-BBBB");
    }

    m = s.match(/(\d)\1{3}(\d)\2$/);
    if (m && m[1] !== m[2]) {
      patterns.push("đuôi AAAA-BB");
    }

    return patterns;
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

    // Quý / hoa cuối
    if (/(\d)\1{5}$/.test(p)) add(180, "lục quý cuối");
    else if (/(\d)\1{4}$/.test(p)) add(140, "ngũ quý cuối");
    else if (/(\d)\1{3}$/.test(p)) add(105, "tứ quý cuối");
    else if (/(\d)\1{2}$/.test(p)) add(80, "tam hoa cuối");

    // Quý / hoa nằm trong 8 số cuối
    if (/(\d)\1{4}/.test(last8)) add(100, "ngũ quý nằm trong đuôi");
    else if (/(\d)\1{3}/.test(last8)) add(80, "tứ quý nằm trong đuôi");
    else if (/(\d)\1{2}/.test(last8)) add(60, "tam hoa nằm trong đuôi");

    // Bắt dạng 77666, 22111, 88822, 66677
    const blockPatterns = [
      ...hasTwoBlockTail(last4),
      ...hasTwoBlockTail(last5),
      ...hasTwoBlockTail(last6),
    ];

    [...new Set(blockPatterns)].forEach((tag) => {
      if (tag === "đuôi AA-BBB") add(105, tag);
      else if (tag === "đuôi AAA-BB") add(105, tag);
      else if (tag === "đuôi AAA-BBB") add(130, tag);
      else if (tag === "đuôi AA-BBBB") add(125, tag);
      else if (tag === "đuôi AAAA-BB") add(125, tag);
      else if (tag === "đuôi AA-BB") add(70, tag);
    });

    // Cụm lặp liên tiếp trong 8 số cuối
    const runs = getRuns(last8);
    const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);

    if (maxRun >= 5) add(100, "cụm 5 số giống nhau trong đuôi");
    else if (maxRun === 4) add(80, "cụm 4 số giống nhau trong đuôi");
    else if (maxRun === 3) add(55, "cụm 3 số giống nhau trong đuôi");

    const hasTriple = runs.some((run) => run.length >= 3);
    const hasPair = runs.some((run) => run.length >= 2);
    const hasTwoRuns = runs.length >= 2;

    if (hasTriple && hasPair && hasTwoRuns) {
      add(60, "combo tam hoa + cặp kép trong đuôi");
    }

    // Tam hoa gần cuối, ví dụ 5551, 55512
    if (/(\d)\1{2}\d$/.test(last4)) add(45, "tam hoa sát cuối");
    if (/(\d)\1{2}\d{1,2}$/.test(last5) || /(\d)\1{2}\d{1,3}$/.test(last6)) {
      add(35, "tam hoa gần cuối");
    }

    // Tiến / lùi
    if (isIncreasing(last6)) add(130, "tiến 6 số cuối");
    else if (isIncreasing(last5)) add(100, "tiến 5 số cuối");
    else if (isIncreasing(last4)) add(75, "tiến 4 số cuối");
    else if (isIncreasing(last3)) add(45, "tiến 3 số cuối");

    if (isDecreasing(last6)) add(90, "lùi 6 số cuối");
    else if (isDecreasing(last5)) add(65, "lùi 5 số cuối");
    else if (isDecreasing(last4)) add(40, "lùi 4 số cuối");

    // Lặp cụm
    if (/(\d{3})\1$/.test(p)) add(105, "lặp bộ 3 cuối");
    else if (/(\d{2})\1\1$/.test(p)) add(95, "3 cặp lặp cuối");
    else if (/(\d{2})\1$/.test(p)) add(70, "lặp cặp cuối");

    if (/(\d{2})\1/.test(last8)) add(45, "lặp cặp trong đuôi");
    if (/(\d{3})\1/.test(last8)) add(70, "lặp bộ 3 trong đuôi");

    // Cặp kép
    if (/(\d)\1(\d)\2(\d)\3$/.test(p)) add(95, "3 cặp kép cuối");
    else if (/(\d)\1(\d)\2$/.test(p)) add(60, "2 cặp kép cuối");

    if (/(\d)\1/.test(last7)) add(20, "có cặp kép trong đuôi");

    // Gánh
    if (/(\d)(\d)(\d)\3\2\1$/.test(p)) add(110, "gánh 6 số cuối");
    else if (/(\d)(\d)(\d)\2\1$/.test(p)) add(85, "gánh 5 số cuối");
    else if (/(\d)(\d)\2\1$/.test(p)) add(65, "gánh 4 số cuối");

    // ABAB / ABCABC / AB-CD-AB
    if (/(\d{3})\1$/.test(last6)) add(90, "đuôi ABC-ABC");
    if (/(\d{2})(\d{2})\1$/.test(last6)) add(65, "đuôi AB-CD-AB");
    if (/(\d{2})\1$/.test(last4)) add(60, "đuôi AB-AB");

    // Cặp số đẹp
    if (["68", "86"].includes(last2)) add(55, "lộc phát cuối");
    if (["39", "79"].includes(last2)) add(50, "thần tài cuối");
    if (["38", "78"].includes(last2)) add(45, "ông địa cuối");
    if (["88", "99", "66"].includes(last2)) add(40, "đuôi kép đẹp");

    if (/(68|86)/.test(last8)) add(30, "có lộc phát trong đuôi");
    if (/(39|79)/.test(last8)) add(28, "có thần tài trong đuôi");
    if (/(38|78)/.test(last8)) add(25, "có ông địa trong đuôi");

    const nicePairs = ["66", "88", "99", "55", "22", "33", "77", "11"];

    nicePairs.forEach((pair) => {
      if (last7.includes(pair)) {
        add(18, `có cặp ${pair} trong đuôi`);
      }
    });

    // Đuôi dễ nhớ
    const uniqueLast6 = new Set(last6).size;
    const uniqueLast7 = new Set(last7).size;
    const uniqueLast8 = new Set(last8).size;

    if (uniqueLast8 <= 3) add(65, "8 số cuối rất dễ nhớ");
    else if (uniqueLast7 <= 3) add(55, "7 số cuối dễ nhớ");
    else if (uniqueLast6 <= 3) add(40, "6 số cuối dễ nhớ");
    else if (uniqueLast6 <= 4) add(20, "6 số cuối tương đối dễ nhớ");

    // Combo đặc biệt
    if (/(68|86).*(\d)\2{2}/.test(last8) || /(\d)\1{2}.*(68|86)/.test(last8)) {
      add(45, "combo lộc phát + tam hoa");
    }

    if (
      /(66|88|99|55|22|77|11).*(\d)\2{2}/.test(last8) ||
      /(\d)\1{2}.*(66|88|99|55|22|77|11)/.test(last8)
    ) {
      add(40, "combo cặp đẹp + tam hoa");
    }

    if (/86.*555/.test(last8) || /555.*86/.test(last8)) {
      add(50, "combo 86 và 555");
    }

    if (/68.*888/.test(last8) || /888.*68/.test(last8)) {
      add(50, "combo 68 và 888");
    }

    if (/79.*999/.test(last8) || /999.*79/.test(last8)) {
      add(50, "combo 79 và 999");
    }

    // Trừ điểm
    if (["49", "53"].includes(last2)) {
      score -= 35;
      tags.push("đuôi dễ bị kiêng");
    }

    return {
      score,
      reason: tags.join(", ") || "bình thường",
    };
  }

  window.testMobiScore = function (phone) {
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
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();

    a.remove();
    URL.revokeObjectURL(url);
  }

  async function fetchPagesInBatches(prefix, pages, size) {
    const all = [];

    for (let i = 0; i < pages.length; i += CONFIG.concurrency) {
      const batch = pages.slice(i, i + CONFIG.concurrency);

      console.log(
        `[${prefix}] Đang tải pages: ${batch[0]} → ${batch[batch.length - 1]}`,
      );

      const results = await Promise.all(
        batch.map((page) => fetchPage(prefix, page, size)),
      );

      for (const result of results) {
        all.push(...result.items);
      }

      await sleep(CONFIG.delayBetweenBatches);
    }

    return all;
  }

  async function fetchAllForPrefix(prefix) {
    let size = CONFIG.size;

    console.log(`Bắt đầu tải đầu số ${prefix}...`);

    let first = await fetchPage(prefix, 1, size);

    if (!first || !first.json) {
      console.warn(`[${prefix}] Không gọi được page 1.`);
      return [];
    }

    if (CONFIG.debugFirstPage) {
      console.log(`[${prefix}] Raw page 1:`, first.json);
      console.log(`[${prefix}] Items page 1:`, first.items.slice(0, 10));
    }

    if (first.items.length === 0 && size !== 20) {
      console.warn(
        `[${prefix}] Page 1 rỗng với size ${size}. Thử lại size 20.`,
      );
      size = 20;
      first = await fetchPage(prefix, 1, size);
    }

    if (!first.items.length) {
      console.warn(`[${prefix}] Không extract được sim.`);
      return [];
    }

    let totalPages = getTotalPages(first.json, size);

    if (!totalPages) {
      totalPages = CONFIG.maxPages;
      console.warn(
        `[${prefix}] Không đọc được totalPages, sẽ dò tới khi rỗng.`,
      );
    }

    totalPages = Math.min(totalPages, CONFIG.maxPages);

    console.log(`[${prefix}] Page 1 có ${first.items.length} sim.`);
    console.log(`[${prefix}] Tổng page dự kiến: ${totalPages}, size: ${size}`);

    let allItems = [...first.items];

    if (totalPages < CONFIG.maxPages) {
      const pages = [];

      for (let p = 2; p <= totalPages; p++) pages.push(p);

      allItems.push(...(await fetchPagesInBatches(prefix, pages, size)));
    } else {
      for (let p = 2; p <= totalPages; p++) {
        const result = await fetchPage(prefix, p, size);

        if (!result.items.length) {
          console.log(`[${prefix}] Page ${p} rỗng, dừng.`);
          break;
        }

        allItems.push(...result.items);
        await sleep(CONFIG.delayBetweenBatches);
      }
    }

    console.log(`[${prefix}] Tải được ${allItems.length} dòng.`);
    return allItems;
  }

  console.log("Test 0938665551:", scorePhone("0938665551"));
  console.log("Test 09000077666 giả lập:", scorePhone("0900077666"));
  console.log("Test 09000022111 giả lập:", scorePhone("0900022111"));
  console.log("Test 09000088822 giả lập:", scorePhone("0900088822"));

  const allItems = [];

  for (const prefix of CONFIG.prefixes) {
    const items = await fetchAllForPrefix(prefix);
    allItems.push(...items);
  }

  const simMap = new Map();

  for (const item of allItems) {
    if (!item.phone || !isPhone(item.phone) || !matchPrefixes(item.phone))
      continue;
    if (!simMap.has(item.phone)) simMap.set(item.phone, item);
  }

  const allSims = [...simMap.values()]
    .filter((item) => {
      if (!item.phone) return false;

      // Loại sim có số 4
      if (hasAvoidDigit(item.phone)) return false;

      return true;
    })
    .map((item) => {
      const result = scorePhone(item.phone);

      return {
        phone: item.phone,
        prefix: item.phone.slice(0, 3),
        score: result.score,
        page: item.page,
        price: item.price,
        reason: result.reason,
      };
    })
    .sort((a, b) => b.score - a.score);

  const beautifulSims = allSims
    .filter((item) => item.score >= CONFIG.minScore)
    .sort((a, b) => b.score - a.score);

  window.mobiAllSims = allSims;
  window.mobiBeautifulSims = beautifulSims;

  console.log(`Tổng sim tải được: ${allSims.length}`);
  console.log(
    `Số đẹp đạt minScore ${CONFIG.minScore}: ${beautifulSims.length}`,
  );

  console.table(beautifulSims.slice(0, 300));

  const time = new Date().toISOString().replaceAll(":", "-").slice(0, 19);

  const prefixName = CONFIG.prefixes.join("_");

  downloadCSV(`mobi_${prefixName}_all_sims_${time}.csv`, allSims, [
    "phone",
    "prefix",
    "score",
    "page",
    "price",
    "reason",
  ]);

  downloadCSV(`mobi_${prefixName}_beautiful_sims_${time}.csv`, beautifulSims, [
    "phone",
    "prefix",
    "score",
    "page",
    "price",
    "reason",
  ]);

  try {
    await navigator.clipboard.writeText(
      beautifulSims
        .map(
          (item) =>
            `${item.phone} | ${item.score} điểm | Trang ${item.page} | ${item.reason}`,
        )
        .join("\n"),
    );

    console.log("Đã copy danh sách số đẹp vào clipboard.");
  } catch {
    console.log(
      "Không copy clipboard được, xem CSV hoặc window.mobiBeautifulSims.",
    );
  }

  console.log("Hoàn tất.");
})();
