// check.js ini handler
import CheckService from "../services/check.service.js";
import RateLimiter from "../utils/rateLimiter.js";
import { delay, isInternetAvailable } from "../utils/helper.js";
/* ATUR JAM OEPRASIONAL PROGRAMM CHECK QUOTA
 * OPERATIONAL_START mulai 1 pagi
 * OPERATIONAL_END akhir dari program jam 3 sore
 */
const OPERATIONAL_START = 1; // 01:00
const OPERATIONAL_END = 15; // 15:00

const getStatus = () => {
  const now = new Date();
  const hour = now.getHours();
  const isWorkingTime = hour >= OPERATIONAL_START && hour < OPERATIONAL_END;

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
const processCheckBatch = async (consoleId, batchLimit = 50) => {
  // Ambil URL dalam jumlah banyak sekaligus (Problem Solver: Mengurangi Round-trip)
  const CLAIM_LIMIT = 50; // sekali claim banyak
  const PROCESS_CHUNK = 10; // proses kecil-kecil
  const urls = await CheckService.listUrls(consoleId, CLAIM_LIMIT);
  await delay(Math.random() * 500);

  let hasResetError = false;

  if (!urls || urls.length === 0) {
    if (!hasResetError) {
      await CheckService.resetAllErrorToZero(consoleId);
      hasResetError = true;
    }
    return false;
  }
  hasResetError = false;

  console.log(`📦 Memproses batch sebesar: ${urls.length} data...`);
  // Naikkan concurrency kalau internet kuat (KISS)
  const concurrencyLevel = 3;
  const myLimiter = new RateLimiter(concurrencyLevel);

  for (let i = 0; i < urls.length; i += PROCESS_CHUNK) {
    const chunk = urls.slice(i, i + PROCESS_CHUNK);

    const checked = await CheckService.checkAllUrls(chunk, {
      rateLimiter: myLimiter,
    });

    await CheckService.insertDB(checked, { batchSize: PROCESS_CHUNK });
    await delay(500);
  }
  return true;
};

const runCheck = async (consoleId) => {
  console.log("🚀 Program dimulai...");
  await delay(Math.random() * 3000);
  let idleCount = 0;
  while (true) {
    await ensureReadyToWork(); // Gatekeeper (Internet + Time)

    try {
      const hasMore = await processCheckBatch(consoleId, 50);

      if (!hasMore) {
        idleCount++;
        console.log("✅ Beres! Semua data diproses. Resetting...");
        await CheckService.resetStatusGstStuck(consoleId);
        await CheckService.resetStatusGst(consoleId);

        console.log("🕒 Istirahat 1 menit dulu ya senpai... (/'3')/");
        await delay(1 * 60 * 1000);
      }
      idleCount = 0;
      await delay(1000);
    } catch (err) {
      console.error("❌ Error:", err.message);
      await delay(5000);
    }
  }
};

export default runCheck;
