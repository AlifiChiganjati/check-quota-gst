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

    if (allLogs.length === 0) {
      console.log("Tidak ada data lama untuk dibackup 😌");
      return;
    }

    let count = 0; // 🔢 Hitung jumlah log yang sudah diproses

    for (const log of allLogs) {
      if (count >= 100) {
        console.log("⚠️ Batas maksimum 100 log tercapai, hentikan proses.");
        break;
      }

      try {
        const alreadyBackup = await BackupRepository.alreadyInsertLogsBackup(
          log.check_quota_id,
          log.date,
          log.ref,
        );

        if (alreadyBackup.length === 0) {
          // ⬇️ Insert ke backup
          const [insertResult] = await BackupRepository.insertLogsBackup(log);
          console.log(`✅ Backup sukses untuk log ID: ${log.id}`);

          if (insertResult.affectedRows > 0) {
            await BackupRepository.deleteLogById(log.id);
          }
        } else {
          await BackupRepository.deleteLogById(log.id);
        }

        count++; // ⏫ Tambah counter setelah berhasil diproses

        // 🕐 Delay 500ms sebelum lanjut ke log berikutnya
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`❌ Error pada log ID ${log.id}:`, err.message);
      }
    }

    console.log("🎉 Proses backup & delete selesai!");
  }
}
