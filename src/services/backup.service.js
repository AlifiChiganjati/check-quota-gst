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

  static async moveOldLogsToBackup(consoleId) {
    const allLogs = await BackupService.listAllLogs(consoleId);
    if (allLogs.length > 0) {
      for (const allLog of allLogs) {
        const alreadylogBackup = await BackupRepository.alreadyInsertLogsBackup(
          allLog.check_quota_id,
          allLog.date,
          allLog.ref,
        );
        if (alreadylogBackup.length === 0) {
          // console.log("belum ada backup", allLog.id);
          return;
        }
      }
    }
  }
  static async insertOldLogsToBackup(payload) {
    const [] = payload;
  }
}
