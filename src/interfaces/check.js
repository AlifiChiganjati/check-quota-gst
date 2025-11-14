// interfaces/check.js
import CheckService from "../services/check.service.js";
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

// 🔹 Proses batch utama: ambil URL, check, dan insert
const processCheckBatch = async (consoleId) => {
  console.log("Ambil URL dari DB...");
  const urls = await CheckService.listUrls(consoleId);

  if (urls.length === 0) {
    console.log("✅ Semua data hari ini sudah di-log, proses selesai");
    await CheckService.resetStatusGstStuck(consoleId);
    return false;
  }

  console.log(`Cek ${urls.length} URL...`);
  const checked = await CheckService.checkAllUrls(urls);

  console.log("Insert hasil ke DB...");
  await CheckService.insertDB(checked);

  console.log("Batch selesai ✅");
  return true;
};

// 🔹 Proses cleanup dan backup
const processCleanup = async (consoleId) => {
  console.log("🔄 Jalankan proses cleanup...");
  // await CheckService.resetStatusFailedInsert(consoleId);
  await CheckService.resetStatusGst(consoleId);
  console.log("Cleanup selesai ✅");
};

// 🔹 Proses utama pengecekan (1 siklus penuh)
const check = async (consoleId) => {
  console.log("🚀 Mulai proses check:", new Date().toLocaleString());
  const MAX_CYCLE = 10000;

  for (let cycle = 1; cycle <= MAX_CYCLE; cycle++) {
    let internet = await isInternetAvailable();
    while (!internet) {
      console.log("⚠️ Internet mati, menunggu 10 detik...");
      await delay(10000);
      internet = await isInternetAvailable();
    }

    try {
      const hasMore = await processCheckBatch(consoleId);
      if (!hasMore) break;
    } catch (err) {
      console.error("❌ Error saat step check/insert:", err);
      console.error("Stack trace:", err?.stack);
      await delay(10000);
    }

    if (cycle === MAX_CYCLE) {
      console.log("❌ Maksimal loop tercapai, hentikan proses untuk keamanan");
      break;
    }
  }

  // Setelah loop selesai, lakukan cleanup & backup sekali saja
  try {
    await processCleanup(consoleId);
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
const runCheck = async (consoleId) => {
  let internet = await isInternetAvailable();
  while (!internet) {
    console.log("⚠️ Internet mati sebelum runCheck, menunggu 10 detik...");
    await delay(10000);
    internet = await isInternetAvailable();
  }

  await check(consoleId);

  console.log("🕒 Tunggu 3 menit untuk run berikutnya...");
  setTimeout(() => runCheck(consoleId), 3 * 60 * 1000);
};

export default runCheck;
