// service/check.service.js
import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import { normalize } from "../utils/normalize.js";
import pLimit from "p-limit";
import { httpClient } from "../utils/httpClient.js";

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

export default class CheckService {
  static async listUrls(consoleId, limit = 10) {
    return await CheckRepository.getAllUrl(consoleId, limit);
  }

  static async checkAllUrls(urls, opts = {}) {
    const results = [];
    const concurrency = opts.concurrency ?? 50;
    const limit = pLimit(concurrency);
    const rateLimiter = opts.rateLimiter ?? new RateLimiter(opts.rps ?? 30);

    const parseGB = (str) => {
      if (!str) return 0;
      const match = str.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const normalizeText = (txt) =>
      (txt || "")
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

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
    function cleanBrokenDate(text) {
      if (!text) return "";

      // Ambil bagian pertama yang mirip tanggal
      const m = text.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/);
      return m ? m[1] : text.trim();
    }

    const dateRegex =
      /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/;
    function safeParseDate(text) {
      if (!text) return null;
      const match = text.match(dateRegex);
      if (!match) return null;
      const year = parseInt(match[3], 10);
      if (year < 2020 || year > 2050) return null;
      return parseDate(text);
    }

    function parseDate(text) {
      if (!text) return null;
      const match = text.match(dateRegex);
      if (!match) return null;
      const day = parseInt(match[1], 10);
      const monthStr = match[2];
      const year = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 0;
      const minute = match[5] ? parseInt(match[5], 10) : 0;
      const second = match[6] ? parseInt(match[6], 10) : 0;
      const month = monthMap[monthStr];
      if (month === undefined) return null;
      return new Date(year, month, day, hour, minute, second);
    }
    function formatDate(date) {
      if (!date) return "";
      const day = date.getDate().toString().padStart(2, "0");
      const monthStr = Object.keys(monthMap).find(
        (k) => monthMap[k] === date.getMonth(),
      );
      const year = date.getFullYear();
      const hour = date.getHours().toString().padStart(2, "0");
      const minute = date.getMinutes().toString().padStart(2, "0");
      const second = date.getSeconds().toString().padStart(2, "0");
      return `${day} ${monthStr} ${year} ${hour}:${minute}:${second}`;
    }

    const fetchWithRetry = async (url, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          await rateLimiter.removeToken();
          return await httpClient.get(url);
        } catch (err) {
          if (i === retries - 1) throw err;
          console.warn(`Retry ${i + 1} untuk ${url}...`);
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    };

    const tasks = urls.map(({ id, url_check, sn, msisdn }) =>
      limit(async () => {
        try {
          const response = await fetchWithRetry(url_check);
          const $ = cheerio.load(response.data);

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
            (_, el) =>
              $(el).find(".title").text().trim() === "Masa Tunggu Kartu",
          );
          const tanggalMasaTunggu = masaTungguItem.find(".date").text().trim();
          const statusMasaTunggu = masaTungguItem
            .find(".date-desc")
            .text()
            .trim();

          const pendingItem = $(".info-item").filter(
            (_, el) => $(el).find(".title").text().trim() === "Pending Paket",
          );

          let valueItem = $(".info-item").filter(
            (_, el) => $(el).find(".title").text().trim() === "Value",
          );

          if (valueItem.length === 0) {
            valueItem = $("tbody");
          }
          const getValueRow = (rowTitle) => {
            const rows = valueItem.find("tr");
            let foundText = "";

            rows.each((_, el) => {
              const titleTd = $(el).find("td.other-title").text();
              const title = normalizeText(titleTd).toLowerCase();
              if (title.includes(rowTitle.toLowerCase())) {
                foundText = normalizeText($(el).find("td.other-value").text());
                return false;
              }
            });

            return foundText || "";
          };

          const getPendingRow = (rowTitle) => {
            const rows = pendingItem.find("tr");
            let foundText = "";

            rows.each((_, el) => {
              const titleTd = $(el).find("td.other-title").text();
              const title = normalizeText(titleTd).toLowerCase();
              if (title.includes(rowTitle.toLowerCase())) {
                foundText = normalizeText($(el).find("td.other-value").text());
                return false;
              }
            });

            return foundText || "";
          };
          const masaWaktu = getValueRow("Masa Waktu");
          const kuotaNasional = getValueRow("Kuota Nasional");
          const kuotaLokal = getValueRow("Kuota Lokal");
          const lainnya = getValueRow("Lainnya");

          const rawMasaTungguPaketText = getValueRow("Masa Tunggu Paket");
          let parsedDate = parseDate(rawMasaTungguPaketText);

          let masaTungguPaket = "";
          let statusPaket = "";

          if (
            masaWaktu &&
            parsedDate &&
            parsedDate.getFullYear() >= 2025 &&
            parsedDate.getFullYear() <= 2040
          ) {
            masaTungguPaket = formatDate(parsedDate);
            statusPaket = "Value";
          } else {
            console.warn(
              `⚠️  Tanggal mencurigakan (${rawMasaTungguPaketText}) untuk msisdn=${msisdn}`,
            );

            try {
              const retryResponse = await fetchWithRetry(url_check);
              const $$ = cheerio.load(retryResponse.data);

              const retryText = normalizeText(
                $$(".other-title:contains('Masa Tunggu Paket')")
                  .next(".other-value")
                  .text(),
              );

              const retryParsed = parseDate(retryText);

              if (
                retryParsed &&
                retryParsed.getFullYear() >= 2025 &&
                retryParsed.getFullYear() <= 2040
              ) {
                masaTungguPaket = formatDate(retryParsed);
                statusPaket = "Value";
                console.info(
                  `✅ Tanggal berhasil diperbaiki untuk msisdn=${msisdn}`,
                );
              } else {
                masaTungguPaket = retryText || rawMasaTungguPaketText;
                statusPaket = `Error: tanggal tidak valid (setelah recheck)`;
              }
            } catch (e) {
              masaTungguPaket = rawMasaTungguPaketText;
              statusPaket = "Error: gagal recheck tanggal";
            }
          }

          const kuotaPending = getPendingRow("Kuota");
          let redeemPendingRaw = getPendingRow("Dapat di redeem hingga");

          redeemPendingRaw = cleanBrokenDate(redeemPendingRaw);

          let parsedRedeem = safeParseDate(redeemPendingRaw);
          let redeemPending = parsedRedeem
            ? formatDate(parsedRedeem)
            : redeemPendingRaw;
          // DETEKSI MODE VALUE (paket aktif)
          const isValueMode = masaWaktu && masaWaktu.trim().length > 0;

          // PROSES PENDING HANYA JK TIDAK VALUE
          if (!isValueMode && !parsedRedeem) {
            console.warn(
              `Tanggal pending aneh (${redeemPendingRaw}) untuk msisdn=${msisdn}`,
            );

            try {
              const retryResponse = await fetchWithRetry(url_check);
              const $$ = cheerio.load(retryResponse.data);
              const retryText = normalizeText(
                $$(".other-title:contains('Dapat di redeem hingga')")
                  .next(".other-value")
                  .text(),
              );
              const retryParsed = safeParseDate(retryText);

              redeemPending = retryParsed ? formatDate(retryParsed) : retryText;
            } catch (e) {
              redeemPending = redeemPendingRaw;
              if (!isValueMode) {
                statusPaket = "Error: gagal recheck tanggal";
              }
            }
          }

          let kuotaValue = 0;
          if (kuotaPending && !kuotaPending.includes("InternetMAX")) {
            const match = kuotaPending.match(/(\d+)\s*GB/i);
            kuotaValue = match ? `${match[1]} GB` : "0";
          }

          const sisa_kuota =
            parseGB(kuotaNasional) + parseGB(kuotaLokal) + parseGB(lainnya);

          const hasInfoItem = $(".info-item").length > 0;
          let errorMessage = null;
          if (hasInfoItem) {
            const hasMeaningfulValue =
              (masaWaktu && masaWaktu.length > 0) ||
              parseGB(kuotaNasional) > 0 ||
              parseGB(kuotaLokal) > 0 ||
              parseGB(lainnya) > 0 ||
              (rawMasaTungguPaketText &&
                (dateRegex.test(rawMasaTungguPaketText) ||
                  rawMasaTungguPaketText.trim().length > 0));

            if (hasMeaningfulValue) {
              statusPaket = "Value";
            } else if (
              (kuotaPending && kuotaPending.length > 0) ||
              (redeemPending && redeemPending.length > 0)
            ) {
              statusPaket = "Pending Paket";
            } else {
              errorMessage = $("p").first().text().trim() || null;
              statusPaket = errorMessage
                ? `Error: ${errorMessage}`
                : "Error: Data tidak ditemukan";
            }

            if (hasInfoItem && hasMeaningfulValue) {
              errorMessage = null;
            }

            const tanggalMasaTungguTrim = tanggalMasaTunggu?.trim() || null;
            const statusMasaTungguTrim = statusMasaTunggu?.trim() || null;
            if (
              !tanggalMasaTungguTrim &&
              !statusMasaTungguTrim &&
              !hasMeaningfulValue
            ) {
              errorMessage = $("p").first().text().trim() || null;
              statusPaket = errorMessage
                ? `Error: ${errorMessage}`
                : "Error: Data tidak ditemukan";
            }
          } else {
            errorMessage = $("p").first().text().trim() || null;
            statusPaket = errorMessage
              ? `Error: ${errorMessage}`
              : "Error: Data tidak ditemukan";
          }

          if (masaWaktu) {
            return {
              id,
              sn,
              msisdn,
              url: url_check,
              serialNumber,
              phoneNumber,
              masaTunggu: {
                tanggal: tanggalMasaTunggu,
                status: statusMasaTunggu,
              },
              statusPaket,
              value: {
                masa_waktu: masaWaktu,
                kuota_nasional: kuotaNasional,
                kuota_local: kuotaLokal,
                kuota_lainnya: lainnya,
                masa_tunggu_paket: masaTungguPaket,
                // msisdn: phoneNumber ? phoneNumber : msisdn,
              },
              kuota: `${sisa_kuota}`,
            };
          } else {
            return {
              id,
              sn,
              msisdn,
              url: url_check,
              serialNumber,
              phoneNumber,
              masaTunggu: {
                tanggal: tanggalMasaTunggu,
                status: statusMasaTunggu,
              },
              statusPaket,
              value: {
                kuota_pending: kuotaPending,
                redeem_pending: redeemPending,
                // msisdn: phoneNumber ? phoneNumber : msisdn,
              },
              kuota: kuotaValue,
            };
          }
        } catch (err) {
          return {
            id,
            sn,
            msisdn,
            url: url_check,
            serialNumber: null,
            phoneNumber: null,
            masaTunggu: {
              tanggal: null,
              status: "Gagal akses URL",
            },
            statusPaket: "Error",
            value: {
              message: err.message || "Gagal ambil data",
              statusCode: err.response?.status || null,
            },
            kuota: "0",
          };
        }
      }),
    );

    const settled = await Promise.all(tasks);
    results.push(...settled);

    return results;
  }

  // ----------------------------
  // insertDB: optimized batch path
  // ----------------------------
  static async insertDB(results, opts = {}) {
    console.log("start insert log (append-only, per-run guarded)");

    const BATCH_SIZE = opts.batchSize ?? 1000;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const safe = (v, f = null) => (v === undefined || v === "" ? f : v);

    // ----------------------------
    // 1️⃣ NORMALIZE DATA
    // ----------------------------
    const normalized = results.map((data) => ({
      sn: safe(normalize(data.serialNumber, data.sn)),
      msisdn: safe(normalize(data.phoneNumber, data.msisdn)),
      masa_tunggu_kartu: safe(normalize(data.masaTunggu?.tanggal)),
      status: safe(normalize(data.masaTunggu?.status)),
      status_paket: safe(normalize(data.statusPaket)),
      kuota: safe(normalize(data.kuota), "0"),
      check_quota_id: data.id,
      value_check:
        data.value && Object.keys(data.value).length > 0
          ? data.value
          : { message: "coba periksa url" },
      date: today,
      date_check: new Date(),
    }));

    // ----------------------------
    // 2️⃣ PREFETCH LAST REF HARI INI
    // ----------------------------
    const ids = [...new Set(normalized.map((r) => r.check_quota_id))];

    /*
    todayMeta:
    { check_quota_id, lastRef }
  */
    const todayMeta = await CheckRepository.getTodayMeta(ids, today);

    const metaMap = {};
    for (const r of todayMeta) {
      metaMap[String(r.check_quota_id)] = {
        lastRef: r.lastRef || 0,
      };
    }

    // ----------------------------
    // 3️⃣ DECISION ENGINE (SANGAT SIMPLE)
    // ----------------------------
    const buffer = [];
    const insertedThisRun = new Set(); // ⛔ GUARD SATU-SATUNYA

    for (const item of normalized) {
      const id = String(item.check_quota_id);

      // ⛔ 1 ID hanya boleh insert 1x per run
      if (insertedThisRun.has(id)) continue;

      const meta = metaMap[id];

      const ref = meta ? meta.lastRef + 1 : 1;

      buffer.push({
        ...item,
        ref,
      });

      insertedThisRun.add(id);
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
