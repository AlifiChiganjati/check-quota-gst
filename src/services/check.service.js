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
          const cleanDate = (str) => {
            if (!str) return null;
            // validasi format tanggal (ex: "25 Nov 2025 23:59:59")
            const pattern = /^\d{1,2}\s\w{3}\s\d{4}\s\d{2}:\d{2}:\d{2}$/;
            return pattern.test(str.trim()) ? str.trim() : null;
          };

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
          const masaTungguPaket = cleanDate(getValueRow("Masa Tunggu Paket"));

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

          let kuotaValue = 0;
          if (kuotaPending && !kuotaPending.includes("InternetMAX")) {
            const match = kuotaPending.match(/\d+\s*GB/);
            kuotaValue = match ? match[0] : 0;
          }

          const sisa_kuota =
            parseGB(kuotaNasional) + parseGB(kuotaLokal) + parseGB(lainnya);

          const hasInfoItem = $(".info-item").length > 0;

          let statusPaket = "";
          let errorMessage = null;

          if (hasInfoItem) {
            // parsing normal seperti sebelumnya
            statusPaket = masaWaktu ? "Value" : "Pending Paket";

            const tanggalMasaTungguTrim = tanggalMasaTunggu?.trim() || null;
            const statusMasaTungguTrim = statusMasaTunggu?.trim() || null;

            if (!tanggalMasaTungguTrim && !statusMasaTungguTrim) {
              // ambil pesan <p> yang relevan
              errorMessage = $("p").first().text().trim() || null;
              statusPaket = errorMessage
                ? `Error: ${errorMessage}`
                : "Error: Data tidak ditemukan";
            }
          } else {
            // halaman HTML penuh, info-item tidak ada
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
    const BATCH_SIZE = 10;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const safe = (val, fallback = null) => (val === undefined ? fallback : val);

    // helper status update
    const handleStatusUpdate = async (isSuccess, id, sn) => {
      const newStatus = isSuccess ? 4 : 2;
      await CheckRepository.updateStatus(id, newStatus);
      if (isSuccess) {
        console.log(`✅ SN=${sn}, ID=${id} berhasil disimpan`);
      } else {
        console.warn(`❌ SN=${sn}, ID=${id} gagal disimpan`);
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
          const kuota = safe(normalize(data.kuota, "0 GB"), "0");
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
              await handleStatusUpdate(true, data.id, payload.sn);
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
              await handleStatusUpdate(true, data.id, payload.sn);
            }
          } catch (err) {
            console.error(`Gagal insert SN=${payload.sn}:`, err.message);
            await handleStatusUpdate(false, data.id, payload.sn);
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
        [result] = await db.query(
          `UPDATE gst_check_quota 
         SET status = 0 
         WHERE status = 3 AND console = ?`,
          [consoleId],
        );
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
