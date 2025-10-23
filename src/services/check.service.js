//service
import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import axios from "axios";
import db from "../config/db.js";
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
    const fetchWithRetry = async (url, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          return await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Node.js Scraper)" },
            timeout: 10000,
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

          const getExactValueByTitle = (title) => {
            const item = $(".info-item").filter((_, el) =>
              $(el)
                .find(".title")
                .text()
                .trim()
                .toLowerCase()
                .includes(title.toLowerCase()),
            );
            return item.find(".single-value").text().trim();
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

          const valueItem = $(".info-item").filter(
            (_, el) => $(el).find(".title").text().trim() === "Value",
          );

          const getValueRow = (rowTitle) =>
            valueItem
              .find("tr")
              .filter(
                (_, el) =>
                  $(el).find("td.other-title").text().trim() === rowTitle,
              )
              .find("td.other-value")
              .text()
              .trim();

          const masaWaktu = getValueRow("Masa Waktu");
          const kuotaNasional = getValueRow("Kuota Nasional");
          const kuotaLokal = getValueRow("Kuota Lokal");
          const lainnya = getValueRow("Lainnya");
          const masaTungguPaket = getValueRow("Masa Tunggu Paket");

          const getPendingRow = (rowTitle) =>
            pendingItem
              .find("tr")
              .filter(
                (_, el) =>
                  $(el).find("td.other-title").text().trim() === rowTitle,
              )
              .find("td.other-value")
              .text()
              .trim();

          const kuotaPending = getPendingRow("Kuota");
          const redeemPending = getPendingRow("Dapat di redeem hingga");

          const match = kuotaPending?.match(/\d+\s*GB/);
          const kuotaValue = match ? match[0] : null;
          const sisa_kuota =
            parseGB(kuotaNasional) + parseGB(kuotaLokal) + parseGB(lainnya);

          const statusPaket = masaWaktu ? "Value" : "Pending Paket";

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
              kuota: `${sisa_kuota} GB`,
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
            kuota: "0 GB",
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
    const BATCH_SIZE = 10;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Helper: aman untuk value undefined/null
    const safe = (val, fallback = null) => (val === undefined ? fallback : val);

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (data) => {
          // normalize semua field
          const sn = safe(normalize(data.serialNumber, data.sn), null);
          const msisdn = safe(normalize(data.phoneNumber, data.msisdn), null);
          const masaTungguTanggal = safe(
            normalize(data.masaTunggu?.tanggal, null),
            null,
          );
          const status = safe(normalize(data.masaTunggu?.status, null), null);
          const statusPaket = safe(normalize(data.statusPaket, null), null);
          const kuota = safe(normalize(data.kuota, "0 GB"), "0 GB");
          const check_quota_id = safe(data.id, null);

          // pastikan JSON tidak undefined
          const value_check =
            data.value && Object.keys(data.value).length > 0
              ? data.value
              : {
                  message: "coba periksa url",
                  sn,
                  msisdn,
                };

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
              await CheckRepository.insert(payload);

              // 🔹 Cek apakah hasil scraping error
              if (data.statusPaket === "Error") {
                await db.query(
                  `UPDATE gst_check_quota SET status = 2 WHERE id = ?`,
                  [data.id],
                );
                console.warn(
                  `❌ Gagal scraping untuk SN=${payload.sn}, ID=${data.id}`,
                );
              } else {
                await db.query(
                  `UPDATE gst_check_quota SET status = 4 WHERE id = ?`,
                  [data.id],
                );
                console.log(
                  `✅ Berhasil insert SN=${payload.sn}, ID=${data.id}`,
                );
              }
            } else {
              console.log(
                `⚠️ Data id=${payload.check_quota_id} untuk tanggal ${payload.date} sudah ada, skip insert`,
              );
              await db.query(
                `UPDATE gst_check_quota SET status = 3 WHERE id = ?`,
                [data.id],
              );
            }
          } catch (err) {
            console.error(`Gagal insert ${payload.sn}:`, err.message);
            await db.query(
              `UPDATE gst_check_quota SET status = 2 WHERE id = ?`,
              [data.id],
            );
          }
        }),
      );

      // delay antar batch
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
}
