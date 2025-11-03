// interfaces/check.js
import CheckService from "../services/check.service.js";
import BackupService from "../services/backup.service.js";
import dns from "dns/promises";

const isInternetAvailable = async () => {
  try {
    await dns.lookup("google.com");
    return true;
  } catch {
    return false;
  }
};

const check = async (consoleId) => {
  console.log("Mulai proses check:", new Date().toLocaleString());
  let maxCycle = 300; // maksimal iterasi, misalnya 300 batch
  while (maxCycle-- > 0) {
    let internet = await isInternetAvailable();
    while (!internet) {
      console.log("Internet mati, menunggu 10 detik...");
      await new Promise((r) => setTimeout(r, 10000));
      internet = await isInternetAvailable();
    }

    try {
      console.log("Ambil URL dari DB...");
      const urls = await CheckService.listUrls(consoleId);

      console.log("Jumlah URL:", urls.length);
      if (!urls.length) {
        console.log("Semua data hari ini sudah di-log, proses selesai");

        // 🔹 Reset status 1 yang nyangkut sebelum break
        await CheckService.resetStatusGstStuck(consoleId);
        break;
      }

      console.log("Cek semua URL...");
      const checked = await CheckService.checkAllUrls(urls);

      console.log("Insert ke DB...");
      await CheckService.insertDB(checked);

      console.log("Insert batch selesai, lanjut batch berikutnya jika ada...");
    } catch (err) {
      console.error("❌ Error saat step check/insert:", err);
      console.error("Stack trace:", err?.stack);
      await new Promise((r) => setTimeout(r, 10000));
    }
    if (maxCycle <= 0) {
      console.log("❌ Maksimal loop tercapai, hentikan proses untuk keamanan");
      break;
    }
  }

  try {
    await CheckService.resetStatusFailedInsert(consoleId);
    await CheckService.resetStatusGst(consoleId);
    await BackupService.moveOldLogsToBackup(consoleId);
  } catch (err) {
    console.error("❌ Error Reset Gst SN:", err);
    console.error("Stack trace:", err?.stack);
    await new Promise((r) => setTimeout(r, 10000));
  }

  console.log("Proses check semua data selesai:", new Date().toLocaleString());
};

const runCheck = async (consoleId) => {
  let internet = await isInternetAvailable();
  while (!internet) {
    console.log("Internet mati sebelum runCheck, menunggu 10 detik...");
    await new Promise((r) => setTimeout(r, 10000));
    internet = await isInternetAvailable();
  }

  await check(consoleId);

  console.log("Tunggu 3 menit untuk run berikutnya...");
  setTimeout(() => runCheck(consoleId), 3 * 60 * 1000);
};

export default runCheck;
