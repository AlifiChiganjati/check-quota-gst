import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import { normalize } from "../utils/normalize.js";
import pLimit from "p-limit";
import { httpClient } from "../utils/httpClient.js";

/* =========================
 * CONSTANTS (NEW)
 * ========================= */
const VALID_YEAR_MIN = 2025;
const VALID_YEAR_MAX = 2040;

/* =========================
 * RATE LIMITER (UNCHANGED)
 * ========================= */
class RateLimiter {
  constructor(permitsPerSecond = 30) {
    this.permitsPerSecond = permitsPerSecond;
    this.tokens = permitsPerSecond;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      const add = (elapsed / 1000) * this.permitsPerSecond;
      this.tokens = Math.min(this.permitsPerSecond, this.tokens + add);
      this.lastRefill = now;
    }
  }

  async removeToken() {
    while (true) {
      this._refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/* =========================
 * DATE HELPERS (FIXED)
 * ========================= */
const monthMap = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const dateRegex =
  /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/;

function parseDate(text) {
  if (!text) return null;
  const m = text.match(dateRegex);
  if (!m) return null;

  const [, d, mon, y, h = 0, mi = 0, s = 0] = m;
  const month = monthMap[mon];
  if (month === undefined) return null;

  return new Date(+y, month, +d, +h, +mi, +s);
}

function isValidYear(date) {
  if (!date) return false;
  const y = date.getFullYear();
  return y >= VALID_YEAR_MIN && y <= VALID_YEAR_MAX;
}

function formatDate(date) {
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const mon = Object.keys(monthMap).find(
    (k) => monthMap[k] === date.getMonth(),
  );
  return `${day} ${mon} ${date.getFullYear()} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0",
  )}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function cleanBrokenDate(text) {
  if (!text) return "";
  const m = text.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/);
  return m ? m[1] : text.trim();
}
function extractMasaTungguPaket($) {
  // 1️⃣ primary path
  let text = getValueRow(
    $(".info-item:has(.title:contains('Value'))").length
      ? $(".info-item:has(.title:contains('Value'))")
      : $("tbody"),
    "Masa Tunggu Paket",
  );

  let parsed = parseDate(text);
  if (parsed && isValidYear(parsed)) {
    return { text, parsed };
  }

  // 2️⃣ fallback selector (same DOM)
  const fallbackText = normalizeText(
    $(".other-title:contains('Masa Tunggu Paket')").next(".other-value").text(),
  );

  const fallbackParsed = parseDate(fallbackText);
  if (fallbackParsed && isValidYear(fallbackParsed)) {
    return { text: fallbackText, parsed: fallbackParsed };
  }

  // 3️⃣ still invalid
  return { text: fallbackText || text, parsed: null };
}

/* =========================
 * DOM HELPERS
 * ========================= */
function normalizeText(txt) {
  return (txt || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getValueRow($container, title) {
  let foundText = "";
  $container.find("tr").each((_, el) => {
    const titleTd = normalizeText(
      cheerio.load(el)("td.other-title").text(),
    ).toLowerCase();

    if (titleTd.includes(title.toLowerCase())) {
      foundText = normalizeText(cheerio.load(el)("td.other-value").text());
      return false;
    }
  });
  return foundText;
}

/* =========================
 * FETCH (SINGLE SOURCE)
 * ========================= */
async function fetchHtml(url, rateLimiter) {
  await rateLimiter.removeToken();
  const res = await httpClient.get(url);
  return res.data;
}

/* =========================
 * PAGE PARSER (FIXED)
 * ========================= */
async function parsePage({ url, rateLimiter }) {
  const html = await fetchHtml(url, rateLimiter);
  const $ = cheerio.load(html);

  const getExactValueByTitle = (title) => {
    const item = $(".info-item").filter(
      (_, el) =>
        $(el).find(".title").text().trim().toLowerCase() ===
        title.toLowerCase(),
    );
    return item.find(".single-value").text().trim() || null;
  };

  const serialNumber = getExactValueByTitle("Serial Number");
  const phoneNumber = getExactValueByTitle("Number");

  const masaTungguItem = $(".info-item").filter(
    (_, el) => $(el).find(".title").text().trim() === "Masa Tunggu Kartu",
  );

  const masaTunggu = {
    tanggal: masaTungguItem.find(".date").text().trim(),
    status: masaTungguItem.find(".date-desc").text().trim(),
  };

  const pendingItem = $(".info-item").filter(
    (_, el) => $(el).find(".title").text().trim() === "Pending Paket",
  );

  let valueItem = $(".info-item").filter(
    (_, el) => $(el).find(".title").text().trim() === "Value",
  );

  if (valueItem.length === 0) valueItem = $("tbody");

  const masaWaktu = getValueRow(valueItem, "Masa Waktu");
  const kuotaNasional = getValueRow(valueItem, "Kuota Nasional");
  const kuotaLokal = getValueRow(valueItem, "Kuota Lokal");
  const lainnya = getValueRow(valueItem, "Lainnya");

  let masaTungguPaket = "";
  let statusPaket = "";

  const { text, parsed } = extractMasaTungguPaket($);

  if (masaWaktu && parsed) {
    masaTungguPaket = formatDate(parsed);
    statusPaket = "Value";
  } else {
    masaTungguPaket = text;
    statusPaket = "Error";
  }

  return {
    serialNumber,
    phoneNumber,
    masaTunggu,
    masaWaktu,
    kuotaNasional,
    kuotaLokal,
    lainnya,
    masaTungguPaket,
    statusPaket,
    pendingItem,
  };
}

/* =========================
 * SERVICE
 * ========================= */
export default class CheckService {
  static async listUrls(consoleId, limit = 10) {
    return await CheckRepository.getAllUrl(consoleId, limit);
  }
  static async checkAllUrls(urls, opts = {}) {
    const concurrency = opts.concurrency ?? 50;
    const rateLimiter = opts.rateLimiter ?? new RateLimiter(opts.rps ?? 30);
    const limit = pLimit(concurrency);

    return Promise.all(
      urls.map(({ id, url_check, sn, msisdn }) =>
        limit(async () => {
          try {
            const parsed = await parsePage({
              url: url_check,
              rateLimiter,
            });

            const sisaKuota =
              (parseInt(parsed.kuotaNasional) || 0) +
              (parseInt(parsed.kuotaLokal) || 0) +
              (parseInt(parsed.lainnya) || 0);

            if (parsed.masaWaktu) {
              return {
                id,
                sn,
                msisdn,
                url: url_check,
                serialNumber: parsed.serialNumber,
                phoneNumber: parsed.phoneNumber,
                masaTunggu: parsed.masaTunggu,
                statusPaket: parsed.statusPaket,
                value: {
                  masa_waktu: parsed.masaWaktu,
                  kuota_nasional: parsed.kuotaNasional,
                  kuota_local: parsed.kuotaLokal,
                  kuota_lainnya: parsed.lainnya,
                  masa_tunggu_paket: parsed.masaTungguPaket,
                },
                kuota: `${sisaKuota}`,
              };
            }

            const kuotaPending = getValueRow(parsed.pendingItem, "Kuota");
            let redeemPending = cleanBrokenDate(
              getValueRow(parsed.pendingItem, "Dapat di redeem hingga"),
            );

            const redeemParsed = parseDate(redeemPending);
            if (isValidYear(redeemParsed)) {
              redeemPending = formatDate(redeemParsed);
            }

            return {
              id,
              sn,
              msisdn,
              url: url_check,
              serialNumber: parsed.serialNumber,
              phoneNumber: parsed.phoneNumber,
              masaTunggu: parsed.masaTunggu,
              statusPaket: parsed.statusPaket,
              value: {
                kuota_pending: kuotaPending,
                redeem_pending: redeemPending,
              },
              kuota: "0",
            };
          } catch (err) {
            return {
              id,
              sn,
              msisdn,
              url: url_check,
              statusPaket: "Error",
              value: { message: err.message },
              kuota: "0",
            };
          }
        }),
      ),
    );
  }

  // ----------------------------
  // insertDB: optimized batch path
  // ----------------------------
  static async insertDB(results, opts = {}) {
    console.log("start insert log (batch-optimized)");

    const BATCH_SIZE = opts.batchSize ?? 1000;
    const parallelProcess = opts.parallelProcess ?? 50;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const safe = (val, fallback = null) => (val === undefined ? fallback : val);

    function shouldFail(data) {
      const statusPaket = (data.statusPaket || "").toLowerCase();

      if (statusPaket.startsWith("error")) {
        return true;
      }
      if (statusPaket.includes("pending paket")) {
        return false;
      }
      if (statusPaket === "value") {
        return false;
      }
      return false;
    }

    // prepare normalized minimal payloads (lightweight)
    const normalized = results.map((data) => {
      const sn = safe(normalize(data.serialNumber, data.sn), null);
      const msisdn = safe(normalize(data.phoneNumber, data.msisdn), null);
      const masaTungguTanggal = safe(
        normalize(data.masaTunggu?.tanggal, null),
        null,
      );
      const status = safe(normalize(data.masaTunggu?.status, null), null);
      const statusPaket = safe(normalize(data.statusPaket, null), null);
      const kuota = safe(normalize(data.kuota, "0"), "0");
      const check_quota_id = safe(data.id, null);

      const value_check =
        data.value && Object.keys(data.value).length > 0
          ? data.value
          : { message: "coba periksa url", sn, msisdn };

      return {
        id: data.id,
        sn,
        msisdn,
        masa_tunggu_kartu: masaTungguTanggal,
        status,
        status_paket: statusPaket,
        kuota,
        check_quota_id,
        value_check,
        date: today,
        date_check: new Date(),
        // will fill ref later
        ref: 1,
        isFailed: shouldFail(data),
      };
    });

    // 1) batch prefetch: find which (check_quota_id, date) already exist
    const checkQuotaIds = [
      ...new Set(
        normalized.map((r) => r.check_quota_id).filter((x) => x != null),
      ),
    ];

    // ----------------------------
    const todayMeta = await CheckRepository.getTodayMeta(checkQuotaIds, today);

    /*
    todayMeta = [
      { check_quota_id, lastRef, gst_status }
    ]
  */

    const metaMap = {};
    for (const r of todayMeta) {
      metaMap[String(r.check_quota_id)] = {
        exists: true,
        lastRef: r.lastRef || 0,
        lastStatusPaket: (r.lastStatusPaket || "").toLowerCase(),
      };
    }

    // ----------------------------
    // 3️⃣ DECISION ENGINE
    // ----------------------------
    const buffer = [];

    for (const item of normalized) {
      const id = String(item.check_quota_id);
      const meta = metaMap[id];

      // 1️⃣ BELUM ADA LOG HARI INI
      if (!meta) {
        buffer.push({
          ...item,
          ref: 1,
        });

        metaMap[id] = {
          exists: true,
          lastRef: 1,
          lastStatusPaket: item.status_paket.toLowerCase(),
        };
        continue;
      }

      // 2️⃣ ADA LOG & TERAKHIR ERROR → BOLEH RETRY
      if (meta.lastStatusPaket.startsWith("error")) {
        buffer.push({
          ...item,
          ref: meta.lastRef + 1,
        });

        meta.lastRef += 1;
        meta.lastStatusPaket = item.status_paket.toLowerCase();
        continue;
      }

      // 3️⃣ SUDAH VALUE / PENDING → SKIP
      continue;
    }

    if (buffer.length === 0) {
      console.log("Tidak ada data yang perlu diinsert");
      return;
    }

    // ----------------------------
    // 4️⃣ BULK INSERT
    // ----------------------------
    for (let i = 0; i < buffer.length; i += BATCH_SIZE) {
      const chunk = buffer.slice(i, i + BATCH_SIZE);

      try {
        await CheckRepository.insertBulk(
          chunk.map((r) => ({
            sn: r.sn,
            msisdn: r.msisdn,
            masa_tunggu_kartu: r.masa_tunggu_kartu,
            value_check: r.value_check,
            date_check: r.date_check,
            status: r.status,
            status_paket: r.status_paket,
            kuota: r.kuota,
            check_quota_id: r.check_quota_id,
            date: r.date,
            ref: r.ref,
          })),
        );
      } catch (err) {
        console.error("Bulk insert gagal:", err.message);
        throw err;
      }
    }

    console.log(`Insert selesai ✅ (${buffer.length} row)`);
  }
  // keep other methods as-is (updateStatus, resetStatusGst, listResetGst, resetStatusGstStuck)
  static async updateStatus() {
    try {
      const result = await CheckRepository.updateGst();
      console.log(
        `Update status berhasil, baris terpengaruh: ${result.affectedRows}`,
      );
      return result;
    } catch (err) {
      console.error("Error saat update status:", err);
      throw err;
    }
  }

  static async resetStatusGst(consoleId) {
    try {
      console.log("Ambil SN dari DB...");
      const allResetGst = await CheckRepository.getAllResetGst(consoleId);

      console.log("Jumlah SN Direset:", allResetGst.length);

      let result = null;

      if (allResetGst.length > 0) {
        console.log(`Ada data yg di reset ${allResetGst.length}`);
        result = CheckRepository.updateAllResetGst(consoleId);
      }

      return result;
    } catch (err) {
      console.error("Error saat update status:", err);
      throw err;
    }
  }

  static async listResetGst(consoleId) {
    const result = await CheckRepository.getAllResetGst(consoleId);
    return result;
  }

  static async resetStatusGstStuck(consoleId) {
    try {
      const result = await CheckRepository.resetStuck(consoleId);
      console.log("Semua data hari ini sudah di-log, proses selesai");
      return result;
    } catch (error) {
      console.log("Error: ", error);
    }
  }

  static async resetAllErrorToZero(consoleId) {
    try {
      const result = await CheckRepository.resetAllGstErrorToZero(consoleId);
      if (result.affectedRows === 0) {
        console.log(result);
      }

      console.log(
        `Reset abnormal errors -> 0 (found: ${result.found}, updated: ${result.affectedRows})`,
      );
      return result;
    } catch (error) {
      console.error("resetAllErrorToZero ERROR:", error);
      throw error;
    }
  }
}
