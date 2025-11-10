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
AND gc.console=?
ORDER BY l.id ASC;`,
      [consoleId],
    );
    return rows;
  }

  static async alreadyInsertLogsBackup(check_quota_id, date, ref) {
    const [rows] = await db.query(
      `
SELECT id 
FROM gst_log_check_quota_backup 
WHERE check_quota_id = ? 
AND date = ?
AND ref = ?`,
      [check_quota_id, date, ref],
    );
    return rows;
  }

  static async insertLogsBackup(payload) {
    const {
      sn,
      msisdn,
      masa_tunggu_kartu,
      value_check,
      date_check,
      status,
      status_paket,
      kuota,
      check_quota_id,
      date,
      ref,
    } = payload;

    const sql = `
  INSERT INTO gst_log_check_quota_backup
  (sn, msisdn, masa_tunggu_kartu, value_check, date_check, status, status_paket, kuota, check_quota_id, date, ref)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

    const values = [
      sn,
      msisdn,
      masa_tunggu_kartu,
      value_check,
      date_check,
      status,
      status_paket,
      kuota,
      check_quota_id,
      date,
      ref,
    ];

    return await db.execute(sql, values);
  }

  static async deleteLogById(id) {
    const sql = `DELETE FROM gst_log_check_quota WHERE id = ?`;
    return await db.execute(sql, [id]);
  }
}
