import CheckService from "../services/check.service.js";
import RateLimiter from "../utils/rateLimiter.js";
import { delay, isInternetAvailable } from "../utils/helper.js";
// --- Configuration ---
const OPERATIONAL_START = 1; // 01:00
const OPERATIONAL_END = 15; // 15:00

const getStatus = () => {
  const now = new Date();
  const hour = now.getHours();
  const isWorkingTime = hour >= OPERATIONAL_START && hour < OPERATIONAL_END;

  // Hitung waktu tunggu sampai jam 1 pagi besok kalau sudah lewat jam 8 malam
  let msUntilStart = 0;
  if (!isWorkingTime) {
    const nextStart = new Date();
    if (hour >= OPERATIONAL_END) nextStart.setDate(nextStart.getDate() + 1);
    nextStart.setHours(OPERATIONAL_START, 0, 0, 0);
    msUntilStart = nextStart - now;
  }

  return { isWorkingTime, msUntilStart };
};

/**
 * Guard function (DRY)
 * Menangani pengecekan internet DAN jam operasional dalam satu pintu
 */
const ensureReadyToWork = async () => {
  while (true) {
    const { isWorkingTime, msUntilStart } = getStatus();

    if (!isWorkingTime) {
      console.log(
        `😴 Di luar jam operasional. Tidur selama ${Math.round(msUntilStart / 60000)} menit...`,
      );
      await delay(msUntilStart);
      continue; // Cek ulang setelah bangun
    }

    if (!(await isInternetAvailable())) {
      console.log("⚠️ Internet mati, nunggu 5 detik... (>///<)");
      await delay(5000);
      continue;
    }

    break; // Semua oke, silakan kerja!
  }
};

// --- Core Logic ---
const processCheckBatch = async (consoleId, batchLimit = 100) => {
  // Ambil URL dalam jumlah banyak sekaligus (Problem Solver: Mengurangi Round-trip)
  const urls = await CheckService.listUrls(consoleId, batchLimit);

  if (!urls || urls.length === 0) {
    await CheckService.resetAllErrorToZero(consoleId);
    return false;
  }

  console.log(`📦 Memproses batch sebesar: ${urls.length} data...`);

  // Naikkan concurrency kalau internet kuat (KISS)
  const concurrencyLevel = 10;
  const myLimiter = new RateLimiter(concurrencyLevel);

  const checked = await CheckService.checkAllUrls(urls, {
    concurrency: concurrencyLevel,
    rateLimiter: myLimiter,
  });
  if (checked.length === 0) return false;

  // Bulk insert sekaligus
  await CheckService.insertDB(checked, { batchSize: batchLimit });

  return true;
};

const runCheck = async (consoleId) => {
  console.log("🚀 Program dimulai...");
  await delay(Math.random() * 3000);
  while (true) {
    await ensureReadyToWork(); // Gatekeeper (Internet + Time)

    try {
      const hasMore = await processCheckBatch(consoleId, 100);

      if (!hasMore) {
        console.log("✅ Beres! Semua data diproses. Resetting...");
        await CheckService.resetStatusGstStuck(consoleId);
        await CheckService.resetStatusGst(consoleId);

        console.log("🕒 Istirahat 1 menit dulu ya senpai... (/'3')/");
        await delay(1 * 60 * 1000);
      }
    } catch (err) {
      console.error("❌ Error:", err.message);
      await delay(5000);
    }
  }
};

export default runCheck;
