//service
import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import axios from "axios";
import { normalize } from "../utils/normalize.js";
import pLimit from "p-limit";

export default class CheckService {
  static async listUrls(consoleId) {
    const result = await CheckRepository.getAllUrl(consoleId);
    return result;
  }

  static async checkAllUrls(urls) {
    const results = [];
    const limit = pLimit(5);
    const fetchWithRetry = async (url, retries = 5) => {
      for (let i = 0; i < retries; i++) {
        try {
          return await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Node.js Scraper)" },
            timeout: 15000,
          });
        } catch (err) {
          if (i === retries - 1) throw err;
          console.warn(`Retry ${i + 1} untuk ${url}...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    const tasks = urls.map(({ id, url_check, sn, msisdn }) =>
      limit(async () => {
        try {
          const response = await fetchWithRetry(url_check);
          const $ = cheerio.load(response.data);

          const parseGB = (str) => {
            if (!str) return 0;
            const match = str.match(/(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          };
          const normalizeText = (txt) =>
            (txt || "")
              .replace(/\u00A0/g, " ") // non-breaking space
              .replace(/\s+/g, " ") // collapse whitespace/newlines
              .trim();

          // regex fleksibel untuk cari tanggal "08 Nov 2025 16:18:59" atau "08 Nov 2025"
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

            // regex fleksibel untuk "08 Nov 2025 16:18:59" atau "08 Nov 2025"
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

          // Format kembali ke string sama seperti fetch
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

          // fallback: kalau tidak ketemu, cari tbody langsung
          if (valueItem.length === 0) {
            valueItem = $("tbody");
          }
          const getValueRow = (rowTitle) => {
            // ambil semua tr di dalam valueItem
            const rows = valueItem.find("tr");
            let foundText = "";

            rows.each((_, el) => {
              const titleTd = $(el).find("td.other-title").text();
              const title = normalizeText(titleTd).toLowerCase();
              if (title.includes(rowTitle.toLowerCase())) {
                // ambil ONLY the first matching row's other-value, normalized
                foundText = normalizeText($(el).find("td.other-value").text());
                return false; // break out of .each
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
          const masaWaktu = getValueRow("Masa Waktu"); // "60 hari" atau ""
          const kuotaNasional = getValueRow("Kuota Nasional");
          const kuotaLokal = getValueRow("Kuota Lokal");
          const lainnya = getValueRow("Lainnya");

          // --- parsing tanggal awal
          const rawMasaTungguPaketText = getValueRow("Masa Tunggu Paket");
          let parsedDate = parseDate(rawMasaTungguPaketText);

          let masaTungguPaket = "";
          let statusPaket = "";

          // cek validitas awal
          if (
            masaWaktu &&
            parsedDate &&
            parsedDate.getFullYear() >= 2000 &&
            parsedDate.getFullYear() <= 2040
          ) {
            // tanggal valid, langsung pakai
            masaTungguPaket = formatDate(parsedDate);
            statusPaket = "Value";
          } else {
            console.warn(
              `⚠️  Tanggal mencurigakan (${rawMasaTungguPaketText}) untuk msisdn=${msisdn}`,
            );

            try {
              // 🔁 retry 1x halaman untuk memastikan
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
                retryParsed.getFullYear() >= 2000 &&
                retryParsed.getFullYear() <= 2040
              ) {
                // berhasil parse tanggal di retry
                masaTungguPaket = formatDate(retryParsed);
                statusPaket = "Value";
                console.info(
                  `✅ Tanggal berhasil diperbaiki untuk msisdn=${msisdn}`,
                );
              } else {
                // gagal valid di retry
                masaTungguPaket = retryText || rawMasaTungguPaketText;
                statusPaket = `Error: tanggal tidak valid (setelah recheck)`;
              }
            } catch (e) {
              masaTungguPaket = rawMasaTungguPaketText;
              statusPaket = "Error: gagal recheck tanggal";
            }
          }

          const kuotaPending = getPendingRow("Kuota");
          const redeemPending = getPendingRow("Dapat di redeem hingga");

          // kuotaValue from pending: ambil first "XX GB" occurrence (jika ada)
          let kuotaValue = 0;
          if (kuotaPending && !kuotaPending.includes("InternetMAX")) {
            const match = kuotaPending.match(/(\d+)\s*GB/i);
            kuotaValue = match ? `${match[1]} GB` : "0";
          }

          const sisa_kuota =
            parseGB(kuotaNasional) + parseGB(kuotaLokal) + parseGB(lainnya);

          const hasInfoItem = $(".info-item").length > 0;
          const bodyText = $("body").text().trim().toLowerCase();
          let errorMessage = null;

          if (!hasInfoItem) {
            if (bodyText === "success" || bodyText === "ok") {
              return {
                id,
                sn,
                msisdn,
                url: url_check,
                statusPaket: "Error: Response success dummy",
                serialNumber: null,
                phoneNumber: null,
                masaTunggu: { tanggal: null, status: null },
                value: {},
                kuota: "0",
              };
            }
          }

          if (hasInfoItem) {
            // Pertimbangkan 'Value' valid bila ada salah satu field yang meaningful:
            const hasMeaningfulValue =
              (masaWaktu && masaWaktu.length > 0) ||
              parseGB(kuotaNasional) > 0 ||
              parseGB(kuotaLokal) > 0 ||
              parseGB(lainnya) > 0 ||
              (rawMasaTungguPaketText &&
                (dateRegex.test(rawMasaTungguPaketText) ||
                  rawMasaTungguPaketText.trim().length > 0));

            // if (!statusPaket.startsWith("Error")) {
            if (hasMeaningfulValue) {
              statusPaket = "Value";
            } else if (
              (kuotaPending && kuotaPending.length > 0) ||
              (redeemPending && redeemPending.length > 0)
            ) {
              statusPaket = "Pending Paket";
            } else {
              // fallback: coba ambil pesan <p> jika ada (halaman error)
              errorMessage = $("p").first().text().trim() || null;
              statusPaket = errorMessage
                ? `Error: ${errorMessage}`
                : "Error: Data tidak ditemukan";
            }
            // }
            // cek masa tunggu kartu: kalau tanggal dan status hilang -> error
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

  static async insertDB(results) {
    console.log("start insert log");

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const BATCH_SIZE = 5;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const safe = (val, fallback = null) => (val === undefined ? fallback : val);

    // helper status update
    const handleStatusUpdate = async (isSuccess, id, sn, msisdn) => {
      const newStatus = isSuccess ? 4 : 2;
      await CheckRepository.updateStatus(id, newStatus);
      if (isSuccess) {
        console.log(
          `✅ MSISDN=${msisdn}, SN=${sn}, ID=${id} berhasil disimpan`,
        );
      } else {
        console.warn(`❌ MSISDN=${msisdn}, SN=${sn}, ID=${id} gagal disimpan`);
      }
    };

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (data) => {
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

          const payload = {
            sn,
            msisdn,
            masa_tunggu_kartu: masaTungguTanggal,
            value_check,
            date_check: new Date(),
            status,
            status_paket: statusPaket,
            kuota,
            check_quota_id,
            date: today,
          };

          try {
            const alreadyInserted = await CheckRepository.isAlreadyInserted(
              payload.check_quota_id,
              payload.date,
            );

            if (!alreadyInserted) {
              // insert baru
              await CheckRepository.insert(payload);
              await handleStatusUpdate(
                true,
                data.id,
                payload.sn,
                payload.msisdn,
              );
            } else {
              // insert ulang (ref++)
              const lastRef = await CheckRepository.getLastRef(
                payload.check_quota_id,
                payload.date,
              );
              payload.ref = lastRef + 1;

              await CheckRepository.insert(payload);
              console.log(
                `🔁 Insert ulang ref=${payload.ref} untuk ID=${data.id}`,
              );
              await handleStatusUpdate(
                true,
                data.id,
                payload.sn,
                payload.msisdn,
              );
            }
          } catch (err) {
            console.error(`Gagal insert SN=${payload.sn}:`, err.message);
            await handleStatusUpdate(
              false,
              data.id,
              payload.sn,
              payload.msisdn,
            );
          }
        }),
      );

      if (i + BATCH_SIZE < results.length) {
        await delay(1000);
      }
    }

    console.log("Insert batch selesai ✅");
  }

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

  static async resetStatusFailedInsert(consoleId) {
    try {
      console.log("Try get All failed Insert...");
      const failedInsert =
        await CheckRepository.getAllStatusFailedInsert(consoleId);
      console.log(`Jumlah gagal insert ditemukan: ${failedInsert.length}`);

      let result = { affectedRows: 0 }; // <-- inisialisasi aman

      if (failedInsert.length > 0) {
        result = await CheckRepository.updateStatusFailedInsert(consoleId);
        console.log(
          `Berhasil reset gagal insert, baris terpengaruh: ${result.affectedRows}`,
        );
      }

      return result;
    } catch (err) {
      console.error("Error saat reset status gagal insert:", err);
      throw err;
    }
  }

  static async resetStatusGst(consoleId) {
    try {
      console.log("Ambil SN dari DB...");
      const allResetGst = await CheckRepository.getAllResetGst(consoleId);

      console.log("Jumlah SN Direset:", allResetGst.length);

      let result = null; // <-- inisialisasi di awal

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
}
