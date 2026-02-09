//service
import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { httpClient } from "../utils/httpClient.js";
import RateLimiter from "../utils/rateLimiter.js";
import { delay } from "../utils/helper.js";

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
  const urlToLowerCase = url.toLowerCase();
  const res = await httpClient.get(urlToLowerCase);
  const $ = cheerio.load(cleanHtml(res.data)); // <-- Sanitasi di sini!
  const rawHtml = res.data;
  const findSection = (title) =>
    $(".info-item").filter((_, el) => {
      const currentTitle = normalizeText($(el).find(".title").text());
      return currentTitle.toLowerCase() === title.toLowerCase();
    });

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
    tanggal: normalizeText(masaTungguSection.find(".date").text()) || null,
    status: normalizeText(masaTungguSection.find(".date-desc").text()) || null,
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
            await delay(Math.random() * 700);
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
                masaTunggu: parsed.masaTunggu,
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
    const BATCH_SIZE = opts.batchSize ?? 100;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const allIds = [...new Set(results.map((r) => r.id))];
    if (allIds.length === 0) return;
    const uniqueInput = [];
    const seenInBatch = new Set();
    for (const r of results) {
      if (!seenInBatch.has(r.id)) {
        uniqueInput.push(r);
        seenInBatch.add(r.id);
      }
    }
    const lastRefsRows = await CheckRepository.getLastRefs(allIds, today);

    const refMap = new Map(
      lastRefsRows.map((r) => [r.check_quota_id, r.lastRef]),
    );
    const existingLogs = await CheckRepository.getExistingLogs(allIds, today);
    const existingSet = new Set(existingLogs.map((r) => r.check_quota_id));

    const normalized = uniqueInput
      .map((data) => {
        const statusPaket = data.statusPaket || "";
        const isFailed = data.kind === "FAILED";

        // 🔒 STOP: FAILED + sudah ada log hari ini → SKIP TOTAL
        if (isFailed && existingSet.has(data.id)) {
          return null;
        }

        const currentLastRef = refMap.get(data.id) || 0;
        const nextRef = isFailed ? currentLastRef : currentLastRef + 1;

        if (!isFailed) {
          refMap.set(data.id, nextRef);
        }

        return {
          id: data.id,
          isFailed,
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
          ref: nextRef,
        };
      })
      .filter(Boolean); // ⬅️ PENTING

    // 5. Bucket Sorting
    const successBuffer = normalized.filter((item) => !item.isFailed);
    const errorBuffer = normalized.filter((item) => item.isFailed);
    const statusPairs = normalized.map((item) => ({
      id: item.id,
      newStatus: item.newStatus,
    }));

    try {
      // Jalankan semua bulk insert
      if (successBuffer.length > 0)
        await this.runBatch(successBuffer, "gst_log_check_quota", BATCH_SIZE);
      if (errorBuffer.length > 0)
        await this.runBatch(
          errorBuffer,
          "gst_log_check_quota_error",
          BATCH_SIZE,
        );
      if (statusPairs.length > 0)
        await CheckRepository.bulkUpdateStatuses(statusPairs, BATCH_SIZE);
      console.log(`Berhasil insert ${normalized.length} data baru! (/'3')/`);
    } catch (err) {
      console.error("Duh, baka! Masih error di insertDB:", err.message);
      throw err;
    }
  }

  static async runBatch(data, tableName, size) {
    for (let i = 0; i < data.length; i += size) {
      await CheckRepository.insertBulkLog(tableName, data.slice(i, i + size));
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
