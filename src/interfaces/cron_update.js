import CheckService from "../services/check.service.js";
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
