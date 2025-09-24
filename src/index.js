import CheckService from "./services/check.service.js";
import dns from "dns/promises";

const main = async () => {
  try {
    // const checked = await CheckService.checkAllUrls();
    // console.log("Hasil cek:", checked);
    // simpan ke DB
    // await CheckService.insertDB(checked);
  } catch (err) {
    console.error("Error:", err.message);
  }
};

main();
