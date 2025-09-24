import CheckRepository from "../repository/check.repository.js";
import * as cheerio from "cheerio";
import axios from "axios";
import db from "../config/db.js";

export default class CheckService {
  static async listUrls() {
    return await CheckRepository.getAllUrl();
  }

  static async checkAllUrls() {
    const urls = await CheckRepository.getAllUrl();
    const results = [];

    for (const { url_check } of urls) {
      try {
        const response = await axios.get(url_check, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Node.js Scraper)",
          },
        });

        const $ = cheerio.load(response.data);

        // helper untuk title exact
        const getExactValueByTitle = (title) => {
          const item = $(".info-item").filter((_, el) => {
            return $(el).find(".title").text().trim() === title;
          });
          return item.find(".single-value").text().trim();
        };

        // ambil serial number & phone
        const serialNumber = getExactValueByTitle("Serial Number");
        const phoneNumber = getExactValueByTitle("Number");

        // Ambil Masa Tunggu Kartu
        const masaTungguItem = $(".info-item").filter(
          (_, el) => $(el).find(".title").text().trim() === "Masa Tunggu Kartu",
        );
        const tanggalMasaTunggu = masaTungguItem.find(".date").text().trim();
        const statusMasaTunggu = masaTungguItem
          .find(".date-desc")
          .text()
          .trim();

        // Ambil Pending Paket
        const pendingItem = $(".info-item").filter(
          (_, el) => $(el).find(".title").text().trim() === "Pending Paket",
        );

        // Value Section
        const valueItem = $(".info-item").filter(
          (_, el) => $(el).find(".title").text().trim() === "Value",
        );

        const getValueRow = (rowTitle) => {
          return valueItem
            .find("tr")
            .filter(
              (_, el) =>
                $(el).find("td.other-title").text().trim() === rowTitle,
            )
            .find("td.other-value")
            .text()
            .trim();
        };

        const masaWaktu = getValueRow("Masa Waktu");
        const kuotaNasional = getValueRow("Kuota Nasional");
        const kuotaLokal = getValueRow("Kuota Lokal");
        const lainnya = getValueRow("Lainnya");
        const masaTungguPaket = getValueRow("Masa Tunggu Paket");

        // Pending Paket rows
        const getPendingRow = (rowTitle) => {
          return pendingItem
            .find("tr")
            .filter(
              (_, el) =>
                $(el).find("td.other-title").text().trim() === rowTitle,
            )
            .find("td.other-value")
            .text()
            .trim();
        };
        const kuotaPending = getPendingRow("Kuota");
        const redeemPending = getPendingRow("Dapat di redeem hingga");
        // Ambil status paket dari Pending Paket
        const statusPaket = masaWaktu
          ? masaTungguItem.find(".title").text().trim() // "Masa Tunggu Kartu"
          : pendingItem.find(".title").text().trim(); // "Pending Paket"
        // Cara 1: pakai regex
        const match = kuotaPending.match(/\d+\s*GB/);
        // Push result bergantung Value Section
        if (masaWaktu) {
          results.push({
            url: url_check,
            serialNumber,
            phoneNumber,
            masaTunggu: {
              tanggal: tanggalMasaTunggu,
              status: statusMasaTunggu,
            },
            statusPaket,
            value: {
              masaWaktu,
              kuotaNasional,
              kuotaLokal,
              lainnya,
              masaTungguPaket,
            },
            kuota: kuotaNasional,
          });
        } else {
          results.push({
            url: url_check,
            serialNumber,
            phoneNumber,
            masaTunggu: {
              tanggal: tanggalMasaTunggu,
              status: statusMasaTunggu,
            },
            statusPaket,
            value: {
              kuotaPending,
              redeemPending,
            },
            kuota: match[0],
          });
        }
      } catch (err) {
        results.push({
          url: url_check,
          status: err.response?.status || "ERROR",
        });
      }
    }

    return results;
  }

  static async insertDB(results) {
    console.log("start insert log");

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const BATCH_SIZE = 5;

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      // Insert setiap batch
      await Promise.all(
        batch.map(async (data) => {
          const payload = {
            sn: data.serialNumber,
            msisdn: data.phoneNumber,
            masa_tunggu_kartu: data.masaTunggu.tanggal,
            value_check: data.value,
            date_check: new Date(),
            status: data.masaTunggu.status,
            status_paket: data.statusPaket,
            kuota: data.kuota,
          };

          try {
            const alreadyLogged = await CheckRepository.isAlreadyLoggedToday(
              payload.sn,
              payload.msisdn,
            );

            if (!alreadyLogged) {
              await CheckRepository.insert(payload);
              await db.query(
                `UPDATE gst_check_quota SET status = 4 WHERE url_check = ?`,
                [data.url],
              );
            } else {
              console.log(
                `Data ${payload.sn} sudah di-log hari ini, skip insert`,
              );
              await db.query(
                `UPDATE gst_check_quota SET status = 3 WHERE url_check = ?`,
                [data.url],
              );
            }
          } catch (err) {
            console.error(`Gagal insert ${payload.sn}:`, err.message);
            await db.query(
              `UPDATE gst_check_quota SET status = 2 WHERE url_check = ?`,
              [data.url],
            );
          }
        }),
      );

      // Delay 1 detik setelah insert batch 5 data
      if (i + BATCH_SIZE < results.length) {
        await delay(1000);
      }
    }
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
