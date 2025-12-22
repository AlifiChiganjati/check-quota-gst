//service
import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { httpClient } from "../utils/httpClient.js";
import RateLimiter from "../utils/rateLimiter.js";

/* =========================
 * CONSTANTS (NEW)
 * ========================= */
const VALID_YEAR_MIN = 2025;
const VALID_YEAR_MAX = 2040;

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

const cleanHtml = (rawHtml) => {
  if (!rawHtml) return "";
  const parts = rawHtml.split("<!DOCTYPE");
  return "<!DOCTYPE" + parts[parts.length - 1];
};

const normalizeText = (txt) =>
  (txt || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getStrictRowValue = ($, container, targetTitle) => {
  let foundValue = "";
  const target = targetTitle.toLowerCase().trim();

  $(container)
    .find("tr")
    .each((_, el) => {
      const currentTitle = normalizeText(
        $(el).find(".other-title").text(),
      ).toLowerCase();
      if (currentTitle === target) {
        foundValue = normalizeText($(el).find(".other-value").text());
        return false; // Break
      }
    });
  return foundValue;
};

const parseAndValidateDate = (dateStr) => {
  if (!dateStr) return { valid: false, parsed: null };

  // Regex Baru: Nangkep Tanggal DAN Jam (Opsional)
  // ^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?
  const dateRegex =
    /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/;
  const m = dateStr.match(dateRegex);

  if (!m) return { valid: false, parsed: null };

  const [, d, mon, y, time = "00:00:00"] = m; // Fallback ke 00:00:00 kalau jam gak ada
  const month = monthMap[mon];

  if (month === undefined) return { valid: false, parsed: null };

  // Buat objek Date lengkap dengan jamnya
  const [hh, mm, ss] = time.split(":");
  const dateObj = new Date(+y, month, +d, +hh, +mm, +ss);
  const year = dateObj.getFullYear();

  if (
    isNaN(dateObj.getTime()) ||
    year < VALID_YEAR_MIN ||
    year > VALID_YEAR_MAX
  ) {
    return { valid: false, parsed: null };
  }

  // Balikin text lengkap (Tanggal + Jam)
  return {
    valid: true,
    parsed: dateObj,
    text: `${d} ${mon} ${y} ${time}`.trim(),
  };
};
/* =========================
 * REFACTORED PAGE PARSER
 * ========================= */
async function parsePage({ url, rateLimiter }) {
  await rateLimiter.removeToken();
  const res = await httpClient.get(url);
  const $ = cheerio.load(cleanHtml(res.data)); // <-- Sanitasi di sini!
  const rawHtml = res.data;
  const findSection = (title) =>
    $(".info-item").filter((_, el) =>
      new RegExp(`^${title}$`, "i").test($(el).find(".title").text().trim()),
    );

  // Identitas
  const serialNumber =
    findSection("Serial Number").find(".single-value").text().trim() || null;
  const phoneNumber =
    findSection("Number").find(".single-value").text().trim() || null;
  const pageError = $("p").first().text().trim() || null;

  // Value Section
  const valueSection = findSection("Value").length
    ? findSection("Value")
    : $("tbody");
  const masaWaktu = getStrictRowValue($, valueSection, "Masa Waktu");

  // Masa Tunggu Paket (Parsing Strict)
  const rawMasaTunggu = getStrictRowValue($, valueSection, "Masa Tunggu Paket");
  const mtpResult = parseAndValidateDate(rawMasaTunggu);
  const masaTungguSection = findSection("Masa Tunggu Kartu");
  const masaTunggu = {
    tanggal: masaTungguSection.find(".date").text().trim() || null,
    status: masaTungguSection.find(".date-desc").text().trim() || null,
  };
  // Pending Paket
  const pendingSection = findSection("Pending Paket");
  const pending = {
    kuota: getStrictRowValue($, pendingSection, "Kuota"),
    redeem: parseAndValidateDate(
      getStrictRowValue($, pendingSection, "Dapat di redeem hingga"),
    ),
  };

  return {
    rawHtml,
    serialNumber,
    phoneNumber,
    pageError,
    masaTunggu,
    masaWaktu,
    kuotaNasional: getStrictRowValue($, valueSection, "Kuota Nasional"),
    kuotaLokal: getStrictRowValue($, valueSection, "Kuota Lokal"),
    lainnya: getStrictRowValue($, valueSection, "Lainnya"),
    masaTungguPaket: mtpResult.valid ? mtpResult.text : "",
    masaTungguPaketValid: mtpResult.valid,
    pending,
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
    const limit = pLimit(opts.concurrency ?? 10);
    const rateLimiter = opts.rateLimiter || new RateLimiter(opts.rps ?? 30);

    return Promise.all(
      urls.map(({ id, url_check, sn, msisdn }) =>
        limit(async () => {
          try {
            const parsed = await parsePage({ url: url_check, rateLimiter });
            // 1. Guard Clause: Identitas Wajib Ada
            if (
              !parsed.serialNumber ||
              !parsed.phoneNumber ||
              parsed.pageError
            ) {
              return {
                kind: "FAILED",
                id,
                rawHtml: parsed.rawHtml,
                sn,
                msisdn,
                statusPaket: `Error: ${parsed.pageError || "Data Incomplete"}`,
              };
            }

            // 2. Logic: Pending Paket
            if (parsed.pending.kuota && parsed.pending.redeem.valid) {
              return {
                kind: "SUCCESS",
                id,
                rawHtml: parsed.rawHtml,
                phoneNumber: parsed.phoneNumber,
                serialNumber: parsed.serialNumber,
                sn,
                msisdn,
                masaWaktu: parsed.masaTunggu,
                statusPaket: "Pending Paket",
                value: {
                  kuota_pending: parsed.pending.kuota,
                  redeem_pending: parsed.pending.redeem.text,
                },
              };
            }

            // 3. Logic: Active Value (YAGNI: Hanya sukses jika MTP valid)
            if (parsed.masaWaktu && parsed.masaTungguPaketValid) {
              const total = (val) => {
                const m = String(val).match(/(\d+(\.\d+)?)/);
                return m ? Number(m[1]) : 0;
              };
              const sisa =
                total(parsed.kuotaNasional) +
                total(parsed.kuotaLokal) +
                total(parsed.lainnya);

              return {
                kind: "SUCCESS",
                id,
                rawHtml: parsed.rawHtml,
                phoneNumber: parsed.phoneNumber,
                serialNumber: parsed.serialNumber,
                sn,
                msisdn,
                masaTunggu: parsed.masaTunggu,
                statusPaket: "Value",
                kuota: `${sisa}`,
                value: {
                  masa_waktu: parsed.masaWaktu,
                  kuota_nasional: parsed.kuotaNasional,
                  kuota_local: parsed.kuotaLokal,
                  kuota_lainnya: parsed.lainnya,
                  masa_tunggu_paket: parsed.masaTungguPaket,
                },
              };
            }

            // 4. Default Fail
            return {
              kind: "FAILED",
              id,
              rawHtml: parsed.rawHtml,
              sn,
              msisdn,
              statusPaket: "Data Paket Invalid/Incomplete",
            };
          } catch (err) {
            return {
              kind: "FAILED",
              id,
              rawHtml: parsed.rawHtml,
              sn,
              msisdn,
              statusPaket: "Network/System Error",
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

    // 1. Transformasi Data (Computational Thinking: Flattening & Normalization)
    const normalized = results.map((data) => {
      const isErrorKind = data.kind === "FAILED";
      const statusPaket = data.statusPaket || "";
      const isFailed =
        isErrorKind || statusPaket.toLowerCase().startsWith("error");
      // Kita buat object yang FLAT. Tidak ada lagi 'payload: {}' yang bikin bingung!
      return {
        // Data untuk logic Service
        id: data.id,
        isFailed: isFailed,
        newStatus: isFailed ? 2 : 4,
        raw_html: data.rawHtml,
        sn: data.serialNumber || data.sn,
        msisdn:
          data.phoneNumber && data.phoneNumber.length > 5
            ? data.phoneNumber
            : data.msisdn !== data.sn
              ? data.msisdn
              : null,
        masa_tunggu_kartu: data.masaTunggu?.tanggal || null,
        status: data.masaTunggu?.status || null,
        status_paket: statusPaket,
        kuota: data.kuota || "0",
        check_quota_id: data.id,
        date: today,
        date_check: new Date(),
        value_check: data.value || { message: "check url", id: data.id },
        ref: 1,
      };
    });

    // 2. Filter Duplikat (Problem Solver: Data Integrity)
    const uniqueResults = [];
    const seenIds = new Set();

    for (const item of normalized) {
      if (!seenIds.has(item.id)) {
        uniqueResults.push(item);
        seenIds.add(item.id);
      } else {
        console.log(`Baka! ID ${item.id} duplikat, aku buang ya! (>///<)`);
      }
    }

    // 3. Bucket Sorting (Efficiency)
    const successBuffer = [];
    const errorBuffer = [];
    const statusPairs = [];

    for (const item of uniqueResults) {
      statusPairs.push({ id: item.id, newStatus: item.newStatus });

      // Karena object sudah FLAT, kita tinggal pisahkan berdasarkan status
      if (item.isFailed) {
        errorBuffer.push(item);
      } else {
        successBuffer.push(item);
      }
    }

    // 4. Batch Execution (DRY Principle)
    const runBatch = async (data, tableName) => {
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const chunk = data.slice(i, i + BATCH_SIZE);
        await CheckRepository.insertBulkLog(tableName, chunk);
      }
    };

    try {
      // Jalankan semua bulk insert
      if (successBuffer.length > 0) {
        await runBatch(successBuffer, "gst_log_check_quota");
      }

      if (errorBuffer.length > 0) {
        await runBatch(errorBuffer, "gst_log_check_quota_error");
      }

      // Update status master table
      if (statusPairs.length > 0) {
        await CheckRepository.bulkUpdateStatuses(statusPairs, BATCH_SIZE);
      }

      console.log("Berhasil! Ingat, teliti itu gratis, Chigan-san! (/'3')/");
    } catch (err) {
      console.error("Duh, baka! Masih error di insertDB:", err.message);
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
        // console.log(result.found);
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
