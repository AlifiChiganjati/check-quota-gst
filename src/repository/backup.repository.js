import db from "../config/db.js";

export default class BackupRepository {
  static async getAllLog(consoleId) {
    const [rows] = await db.query(
      `SELECT l.id,l.sn, l.msisdn, l.masa_tunggu_kartu, 
l.value_check, l.date_check, l.status, 
l.status_paket, l.kuota, l.status_mutasi, 
l.check_quota_id, l.date, l.ref
FROM gst_log_check_quota l
JOIN gst_check_quota AS gc
ON l.check_quota_id = gc.id
WHERE DATE(l.date) < CURDATE() - INTERVAL 14 DAY
AND gc.console=1
ORDER BY l.id ASC;`,
      [consoleId],
    );
    return rows;
  }
}
