//service
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
function isValidTextValue(val) {
  if (!val) return false;

  const text = String(val).trim().toLowerCase();

  if (!text) return false;
  if (text === "-" || text === "n/a" || text === "null") return false;

  return true;
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
function validateParsedDate(date, rawText) {
  if (!date || !(date instanceof Date)) return false;
  if (isNaN(date.getTime())) return false;

  // wajib ada tahun 4 digit di text
  if (!/\b\d{4}\b/.test(rawText)) return false;

  const year = date.getFullYear();

  if (year < VALID_YEAR_MIN || year > VALID_YEAR_MAX) {
    return false;
  }

  return true;
}

function extractMasaTungguPaket($) {
  const $container = $(".info-item:has(.title:contains('Value'))").length
    ? $(".info-item:has(.title:contains('Value'))")
    : $("tbody");

  let text = getValueRow($, $container, "Masa Tunggu Paket");

  const parsed = parseDate(text);

  if (validateParsedDate(parsed, text)) {
    return { text, parsed, valid: true };
  }

  // fallback
  const fallbackText = normalizeText(
    $(".other-title:contains('Masa Tunggu Paket')").next(".other-value").text(),
  );

  const fallbackParsed = parseDate(fallbackText);

  if (validateParsedDate(fallbackParsed, fallbackText)) {
    return { text: fallbackText, parsed: fallbackParsed, valid: true };
  }

  return {
    text,
    parsed,
    valid: false,
  };
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

// function getValueRow($container, title) {
//   let foundText = "";
//   $container.find("tr").each((_, el) => {
//     const titleTd = normalizeText(
//       cheerio.load(el)("td.other-title").text(),
//     ).toLowerCase();
//
//     if (titleTd.includes(title.toLowerCase())) {
//       foundText = normalizeText(cheerio.load(el)("td.other-value").text());
//       return false;
//     }
//   });
//   return foundText;
// }
function getValueRow($, $container, title) {
  let foundText = "";

  $container.find("tr").each((_, el) => {
    const $el = $(el);

    const titleTd = normalizeText(
      $el.find("td.other-title").text(),
    ).toLowerCase();

    if (titleTd.includes(title.toLowerCase())) {
      foundText = normalizeText($el.find("td.other-value").text());
      return false; // break
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

  let pending = {
    kuota: "",
    redeem: "",
  };

  if (pendingItem.length > 0) {
    pending.kuota = getValueRow($, pendingItem, "Kuota");

    pending.redeem = cleanBrokenDate(
      getValueRow($, pendingItem, "Dapat di redeem hingga"),
    );
  }

  let valueItem = $(".info-item").filter(
    (_, el) => $(el).find(".title").text().trim() === "Value",
  );

  if (valueItem.length === 0) valueItem = $("tbody");

  // const masaWaktu = getValueRow(valueItem, "Masa Waktu");
  // const kuotaNasional = getValueRow(valueItem, "Kuota Nasional");
  // const kuotaLokal = getValueRow(valueItem, "Kuota Lokal");
  // const lainnya = getValueRow(valueItem, "Lainnya");
  const masaWaktu = getValueRow($, valueItem, "Masa Waktu");
  const kuotaNasional = getValueRow($, valueItem, "Kuota Nasional");
  const kuotaLokal = getValueRow($, valueItem, "Kuota Lokal");
  const lainnya = getValueRow($, valueItem, "Lainnya");

  let masaTungguPaket = "";
  let statusPaket = "";

  const parsedMasaTunggu = extractMasaTungguPaket($);
  if (masaWaktu && parsedMasaTunggu.valid) {
    masaTungguPaket = formatDate(parsedMasaTunggu.parsed);
    statusPaket = "Value";
  }
  const pageError = $("p").first().text().trim() || null;

  return {
    serialNumber,
    phoneNumber,
    masaTunggu,
    masaWaktu,
    kuotaNasional,
    kuotaLokal,
    lainnya,
    masaTungguPaket: parsedMasaTunggu.valid
      ? formatDate(parsedMasaTunggu.parsed)
      : "",
    masaTungguPaketValid: parsedMasaTunggu.valid, // 🔑 PENTING
    statusPaket,
    pending,
    pageError,
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

    const parseGB = (val) => {
      if (!val) return 0;
      const m = String(val).match(/(\d+(\.\d+)?)/);
      return m ? Number(m[1]) : 0;
    };

    return Promise.all(
      urls.map(({ id, url_check, sn, msisdn }) =>
        limit(async () => {
          try {
            const parsed = await parsePage({ url: url_check, rateLimiter });

            // 1. PRIORITAS PALING TINGGI: Validasi Halaman & Data Identitas
            // Kalau ini kena, langsung stop, jangan cek kuota atau pending lagi!
            if (
              !parsed.serialNumber ||
              !parsed.phoneNumber ||
              parsed.pageError
            ) {
              const errorMsg =
                parsed.pageError || "SN and MSISDN Tidak ditemukan";
              return {
                kind: "FAILED",
                id,
                sn,
                msisdn,
                url: url_check,
                serialNumber: parsed.serialNumber ?? null,
                phoneNumber: parsed.phoneNumber ?? null,
                masaTunggu: parsed.masaTunggu,
                statusPaket: `Error: ${errorMsg}`,
                value: { message: errorMsg },
                kuota: "0",
              };
            }

            // 2. HITUNG KUOTA (Hanya dilakukan jika data identitas valid)
            const sisaKuota =
              parseGB(parsed.kuotaNasional) +
              parseGB(parsed.kuotaLokal) +
              parseGB(parsed.lainnya);

            // 3. PRIORITAS KEDUA: PENDING MODE (Tapi harus valid isinya!)
            const kuotaPending = parsed.pending?.kuota;
            let redeemPendingRaw = parsed.pending?.redeem;
            const redeemParsed = parseDate(redeemPendingRaw);

            // Kita hanya masuk "Pending Paket" kalau kuotanya ada DAN tanggalnya masuk akal
            if (
              isValidTextValue(kuotaPending) &&
              validateParsedDate(redeemParsed, redeemPendingRaw)
            ) {
              return {
                kind: "SUCCESS",
                id,
                sn,
                msisdn,
                url: url_check,
                serialNumber: parsed.serialNumber,
                phoneNumber: parsed.phoneNumber,
                masaTunggu: parsed.masaTunggu,
                statusPaket: "Pending Paket",
                value: {
                  kuota_pending: kuotaPending,
                  redeem_pending: formatDate(redeemParsed),
                },
                kuota: "0",
              };
            }
            // 4.a HARD FAIL: Masa Tunggu Paket ADA tapi FORMAT INVALID
            if (
              parsed.masaWaktu &&
              isValidTextValue(parsed.masaWaktu) &&
              parsed.masaTungguPaket &&
              parsed.masaTungguPaketValid === false
            ) {
              return {
                kind: "FAILED",
                id,
                sn,
                msisdn,
                url: url_check,
                serialNumber: parsed.serialNumber,
                phoneNumber: parsed.phoneNumber,
                masaTunggu: parsed.masaTunggu,
                statusPaket: "FAILED: Invalid Masa Tunggu Paket",
                value: {
                  message: "Format Masa Tunggu Paket tidak valid",
                  raw: parsed.masaTungguPaket,
                },
                kuota: "0",
              };
            }

            // 5. PRIORITAS KETIGA: VALUE MODE (PAKET AKTIF)
            const hasMeaningfulValue =
              (parsed.masaWaktu && isValidTextValue(parsed.masaWaktu)) ||
              sisaKuota > 0 ||
              parsed.masaTungguPaketValid === true;

            if (hasMeaningfulValue) {
              return {
                kind: "SUCCESS",
                id,
                sn,
                msisdn,
                url: url_check,
                serialNumber: parsed.serialNumber,
                phoneNumber: parsed.phoneNumber,
                masaTunggu: parsed.masaTunggu,
                statusPaket: "Value",
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

            // 6. FALLBACK TERAKHIR: Kalau semua di atas gagal
            // Berarti halaman kebuka, SN ada, tapi nggak ada paket aktif maupun pending yang valid
            return {
              kind: "FAILED",
              id,
              sn,
              msisdn,
              url: url_check,
              serialNumber: parsed.serialNumber,
              phoneNumber: parsed.phoneNumber,
              masaTunggu: parsed.masaTunggu,
              statusPaket: parsed.statusPaket || "Error: Paket tidak ditemukan",
              value: {
                message: "Data paket tidak lengkap atau kadaluarsa",
              },
              kuota: "0",
            };
          } catch (err) {
            // ❗ ERROR TEKNIS (Network/Code Crash)
            console.log(err);
            return {
              kind: "FAILED",
              id,
              sn,
              msisdn,
              url: url_check,
              statusPaket: `Error`,
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
    const BATCH_SIZE = opts.batchSize ?? 500;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // 1. Normalisasi & Tentukan Nasib (Success/Failed)
    const normalized = results.map((data) => {
      const isErrorKind = data.kind === "FAILED";
      // Logic status_paket (Principal Engineer must be precise!)
      const statusPaket = data.statusPaket || "";
      const isFailed =
        isErrorKind || statusPaket.toLowerCase().startsWith("error");

      return {
        ...data, // simpan data asli buat bantu mapping
        check_quota_id: data.id,
        date: today,
        date_check: new Date(),
        isFailed: isFailed,
        newStatus: isFailed ? 2 : 4,
        payload: {
          sn: normalize(data.serialNumber, data.sn),
          msisdn: normalize(data.phoneNumber, data.msisdn),
          masa_tunggu_kartu: normalize(data.masa_tunggu?.tanggal, null),
          status: normalize(data.masa_tunggu?.status, null),
          status_paket: statusPaket,
          kuota: data.kuota || "0",
          check_quota_id: data.id,
          date: today,
          date_check: new Date(),
          value_check: data.value || { message: "check url", id: data.id },
          ref: 1,
        },
      };
    });

    // 2. Pisahkan Bucket
    const successBuffer = [];
    const errorBuffer = [];
    const statusPairs = [];

    for (const item of normalized) {
      statusPairs.push({ id: item.id, newStatus: item.newStatus });
      if (item.isFailed) {
        errorBuffer.push(item.payload);
      } else {
        successBuffer.push(item.payload);
      }
    }

    // 3. Eksekusi Bulk (Computational Thinking: Efficiency)
    const runBatch = async (data, repoMethod) => {
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const chunk = data.slice(i, i + BATCH_SIZE);
        await repoMethod(chunk);
      }
    };

    try {
      // 1. Insert Success dulu
      if (successBuffer.length > 0) {
        await runBatch(
          successBuffer,
          CheckRepository.insertBulkSuccess.bind(CheckRepository),
        );
      }

      // 2. Insert Error kemudian
      if (errorBuffer.length > 0) {
        await runBatch(
          errorBuffer,
          CheckRepository.insertBulkError.bind(CheckRepository),
        );
      }

      // 3. Update Status Terakhir (Pakai chunking yang baru dibuat)
      if (statusPairs.length > 0) {
        await CheckRepository.bulkUpdateStatuses(statusPairs, BATCH_SIZE);
      }

      console.log("Semua data berhasil dipilah dan disimpan! (/'3')/");
    } catch (err) {
      console.error("Duh, ada yang error pas batch insert:", err.message);
      throw err;
    }
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
      if (result.found) {
        console.log(result.found);
        console.log(
          `Reset abnormal errors -> 0 (found: ${result.found}, updated: ${result.affectedRows})`,
        );
      }

      return result;
    } catch (error) {
      console.error("resetAllErrorToZero ERROR:", error);
      throw error;
    }
  }
}
