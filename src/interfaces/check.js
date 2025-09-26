import CheckService from "../services/check.service.js";
import CheckRepository from "../repository/check.repository.js";
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
      // tunggu sebentar biar ga spam kalau error
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  console.log("Proses check semua data selesai:", new Date().toLocaleString());
};

const runCheck = async (consoleId) => {
  // cek internet dulu sebelum mulai proses
  let internet = await isInternetAvailable();
  while (!internet) {
    console.log("Internet mati sebelum runCheck, menunggu 10 detik...");
    await new Promise((r) => setTimeout(r, 10000));
    internet = await isInternetAvailable();
  }

  await check(consoleId);

  console.log("Tunggu 5 menit untuk run berikutnya...");
  setTimeout(() => runCheck(consoleId), 5 * 60 * 1000);
};

// ambil consoleId dari argumen CLI, default null
const consoleId = process.argv[2] ? parseInt(process.argv[2], 10) : null;
runCheck(consoleId);
