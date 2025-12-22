// ---------- interfaces/check.js (optimized runner) ----------
import CheckService from "../services/check.service.js";
import dns from "dns/promises";
import RateLimiter from "../utils/rateLimiter.js";

const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const processCheckBatch = async (consoleId) => {
  console.log("Ambil URL dari DB...");
  const urls = await CheckService.listUrls(consoleId);

  if (!urls.length) {
    console.log("✅ Semua data hari ini sudah di-log, proses selesai");
    await CheckService.resetStatusGstStuck(consoleId);
    return false;
  }

  console.log(`Cek ${urls.length} URL...`);

  const myLimiter = new RateLimiter(10);
  const checked = await CheckService.checkAllUrls(urls, {
    concurrency: 15,
    rateLimiter: myLimiter, // <--- Kamu kirim mesinnya langsung!
  });

  console.log("Insert hasil ke DB...");
  await CheckService.insertDB(checked, { batchSize: 1000 });

  console.log("Batch selesai ✅");
  return true;
};

const processCleanup = async (consoleId) => {
  console.log("🔄 Jalankan proses cleanup...");

  const resetStuck = await CheckService.resetStatusGst(consoleId);
  const resetStuckCount = resetStuck?.affectedRows ?? 0;

  console.log(`Reset stuck status=1 → 0: ${resetStuckCount}`);

  // Ambil hasil reset error abnormal
  const resetResult = await CheckService.resetAllErrorToZero(consoleId);
  console.log(`🟡 Ditemukan error abnormal: ${resetResult.found}`);
  console.log(`🟢 Berhasil reset status=3 → 0: ${resetResult.affectedRows}`);

  console.log("Cleanup selesai ✅");
};

const check = async (consoleId) => {
  console.log("🚀 Mulai proses check:", new Date().toLocaleString());

  while (true) {
    let internet = await isInternetAvailable();
    while (!internet) {
      console.log("⚠️ Internet mati, menunggu 5 detik...");
      await delay(5000);
      internet = await isInternetAvailable();
    }

    try {
      const hasMore = await processCheckBatch(consoleId);

      // ⛔ kondisi berhenti utama
      if (!hasMore) {
        console.log("✅ Tidak ada data lagi, hentikan loop check");
        break;
      }
    } catch (err) {
      console.error("❌ Error saat step check/insert:", err);
      console.error("Stack trace:", err?.stack);
      await delay(5000);
    }
  }

  try {
    await processCleanup(consoleId);
  } catch (err) {
    console.error("❌ Error saat cleanup", err);
    console.error("Stack trace:", err?.stack);
  }

  console.log(
    "🎯 Proses check semua data selesai:",
    new Date().toLocaleString(),
  );
};

const runCheck = async (consoleId) => {
  let internet = await isInternetAvailable();
  while (!internet) {
    console.log("⚠️ Internet mati sebelum runCheck, menunggu 5 detik...");
    await delay(5000);
    internet = await isInternetAvailable();
  }

  await check(consoleId);

  console.log("🕒 Tunggu 15 menit untuk run berikutnya...");
  setTimeout(() => runCheck(consoleId), 15 * 60 * 1000);
};

export default runCheck;
