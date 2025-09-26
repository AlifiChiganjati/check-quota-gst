import CheckService from "../services/check.service.js";
import CheckRepository from "../repository/check.repository.js";
import cron from "node-cron";
import dns from "dns/promises";
import { url } from "inspector";

// Fungsi cek koneksi internet
const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};

const runCheck = async (consoleId) => {
  console.log("Mulai proses check:", new Date().toLocaleString());

  while (true) {
    let internet = await isInternetAvailable();
    while (!internet) {
      console.log("Internet mati, menunggu 10 detik...");
      await new Promise((r) => setTimeout(r, 10000));
      internet = await isInternetAvailable();
    }

    try {
      const urls = await CheckRepository.getAllUrl(consoleId);
      if (!urls.length) {
        console.log("Semua data hari ini sudah di-log, proses selesai");
        break;
      }

      const checked = await CheckService.checkAllUrls(urls);
      console.log(`Batch ${urls.length} selesai dicek`);

      await CheckService.insertDB(checked, consoleId);
      console.log("Insert batch selesai, lanjut batch berikutnya jika ada...");
    } catch (err) {
      console.error("Error saat check atau insert:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log("Proses check semua data selesai:", new Date().toLocaleString());
};

// Cron job: check dan insert data jam 01:00 lokal Makassar
cron.schedule(
  "0 1 * * *",
  () => {
    console.log(
      "Cron job check & insert dijalankan:",
      new Date().toLocaleString(),
    );
    runCheck();
  },
  { timezone: "Asia/Makassar" },
);
