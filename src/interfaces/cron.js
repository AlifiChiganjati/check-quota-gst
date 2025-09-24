import CheckService from "../services/check.service.js";
import CheckRepository from "../repository/check.repository.js";
import cron from "node-cron";
import dns from "dns/promises";

// Fungsi cek koneksi internet
const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};

// Fungsi untuk proses semua data batch 5 sampai habis
const runCheck = async () => {
  console.log("Mulai proses check:", new Date().toLocaleString());

  while (true) {
    let internet = await isInternetAvailable();
    while (!internet) {
      console.log("Internet mati, menunggu 10 detik...");
      await new Promise((r) => setTimeout(r, 10000));
      internet = await isInternetAvailable();
    }

    // Ambil batch 5 data dengan status 0
    const urls = await CheckRepository.getAllUrl();
    if (!urls.length) {
      console.log("Semua data hari ini sudah di-log, proses selesai");
      break; // berhenti loop
    }

    try {
      // checkAllUrls sudah otomatis ambil data dari repository
      const checked = await CheckService.checkAllUrls();
      console.log(`Batch ${urls.length} selesai dicek`);

      await CheckService.insertDB(checked);
      console.log("Insert batch selesai, lanjut batch berikutnya jika ada...");
    } catch (err) {
      console.error("Error saat check atau insert:", err.message);
      // tunggu 5 detik sebelum retry
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log("Proses check semua data selesai:", new Date().toLocaleString());
};

// Fungsi update status GST (misal jam 22:00)
const runUpdate = async () => {
  let internet = await isInternetAvailable();
  while (!internet) {
    console.log("Internet mati, menunggu 10 detik...");
    await new Promise((r) => setTimeout(r, 10000));
    internet = await isInternetAvailable();
  }

  try {
    console.log("Memulai update status GST...");
    const updated = await CheckService.updateStatus();
    console.log(`Update selesai, baris terpengaruh: ${updated.affectedRows}`);
  } catch (err) {
    console.error("Error saat update status:", err.message);
  }
};

// Cron job: update status jam 23:00 lokal Makassar
cron.schedule(
  "0 23 * * *",
  () => {
    console.log(
      "Cron job update status dijalankan:",
      new Date().toLocaleString(),
    );
    runUpdate();
  },
  { timezone: "Asia/Makassar" },
);

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
