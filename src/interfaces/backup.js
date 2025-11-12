// interfaces/check.js
import BackupService from "../services/backup.service.js";
import dns from "dns/promises";

// 🔹 Utilitas untuk cek koneksi internet
const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};

// 🔹 Helper: tunggu beberapa milidetik
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 🔹 Proses cleanup dan backup
const processBackup = async () => {
  console.log("🔄 Jalankan proses backup...");
  await BackupService.moveOldLogsToBackup();
  console.log("Backup selesai ✅");
};

// 🔹 Proses utama pengecekan (1 siklus penuh)
const backup = async (consoleId) => {
  try {
    console.log("🚀 Mulai proses check:", new Date().toLocaleString());

    let internet = await isInternetAvailable();
    while (!internet) {
      console.log("⚠️ Internet mati, menunggu 10 detik...");
      await delay(10000);
      internet = await isInternetAvailable();
    }

    await processBackup(consoleId);
  } catch (err) {
    console.error("❌ Error saat cleanup/backup:", err);
    console.error("Stack trace:", err?.stack);
  }

  console.log(
    "🎯 Proses check semua data selesai:",
    new Date().toLocaleString(),
  );
};

// 🔹 Jalankan loop pengecekan otomatis tiap 3 menit
const runBackup = async () => {
  let internet = await isInternetAvailable();
  while (!internet) {
    console.log("⚠️ Internet mati sebelum runCheck, menunggu 10 detik...");
    await delay(10000);
    internet = await isInternetAvailable();
  }

  await backup();

  console.log("🕒 Tunggu 3 menit untuk run berikutnya...");
  setTimeout(() => runBackup(), 3 * 60 * 1000);
};

export default runBackup;
