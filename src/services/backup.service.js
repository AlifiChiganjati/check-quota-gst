import BackupRepository from "../repository/backup.repository.js";

export default class BackupService {
  static async listAllLogs(consoleId) {
    try {
      console.log("Ambil semua untuk backup");
      const result = await BackupRepository.getAllLog(consoleId);
      console.log(`Jumlah row query yg mau di backup: ${result.length}`);
      return result;
    } catch (err) {
      console.log("Error: ", err);
    }
  }
}
