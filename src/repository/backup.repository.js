import db from "../config/db.js";

export default class BackupRepository {
  static async getAllLog() {
    const [rows] = await db.query(
      `SELECT id, sn, msisdn, masa_tunggu_kartu,
value_check, date_check, status, 
status_paket, kuota, status_mutasi, 
check_quota_id, date, ref
FROM gst_log_check_quota 
WHERE DATE(date) < CURDATE() - INTERVAL 14 DAY
ORDER BY id ASC;`,
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
