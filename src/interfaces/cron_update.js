import CheckService from "../services/check.service.js";
import cron from "node-cron";
import dns from "dns/promises";

// Cek koneksi internet
const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};

// Update status
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

// ✅ export default → supaya bisa dipanggil dari loader
export default async function cronUpdate() {
  console.log("▶️ Menjalankan cron_update...");

  cron.schedule(
    "0 1 * * *",
    () => {
      console.log(
        "⏰ Cron job update status dijalankan:",
        new Date().toLocaleString(),
      );
      runUpdate();
    },
    { timezone: "Asia/Makassar" },
  );

  console.log("✅ Cron job sudah dipasang (01:00 WITA setiap hari).");
}
