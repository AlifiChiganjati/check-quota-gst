//repository
import db from "../config/db.js";

export default class CheckRepository {
  static async getAllUrl(consoleId) {
    const connection = await db.getConnection(); // pastikan pool support getConnection()
    try {
      await connection.beginTransaction();

      // Ambil 5 data dengan kunci row
      const [rows] = await connection.query(
        `SELECT id, url_check, date_check, status, sn, msisdn
       FROM gst_check_quota
       WHERE status = 0
       AND console=?
       ORDER BY id ASC
       LIMIT 8
       FOR UPDATE`,
        [consoleId],
      );

      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        // update status jadi 9 supaya tidak diambil proses lain
        await connection.query(
          `UPDATE gst_check_quota 
         SET status = 1
         WHERE id IN (?)`,
          [ids],
        );
      }

      await connection.commit();
      return rows;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // Insert data ke gst_log_check_kuota
  static async insert(data) {
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
      ref = 1,
    } = data;

    const sql = `
  INSERT INTO gst_log_check_quota
  (sn, msisdn, masa_tunggu_kartu, value_check, date_check, status, status_paket, kuota, check_quota_id, date, ref)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`; // <--- 11 placeholder

    const values = [
      sn,
      msisdn,
      masa_tunggu_kartu,
      JSON.stringify(value_check),
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

  static async isAlreadyInserted(check_gst_id, date) {
    const [rows] = await db.query(
      `SELECT 1 FROM gst_log_check_quota 
     WHERE check_quota_id = ? AND date = ? 
     LIMIT 1`,
      [check_gst_id, date],
    );
    return rows.length > 0;
  }

  static async updateGst() {
    try {
      const [result] = await db.query(
        "UPDATE gst_check_quota SET status = 0 WHERE status IN (2, 3, 4)",
      );
      console.log(`Jumlah baris diupdate: ${result.affectedRows}`);
      return result;
    } catch (err) {
      console.error("Error updateGst:", err);
      throw err;
    }
  }

  // repository/check.repository.js
  static async resetStuck() {
    try {
      const [result] = await db.query(
        `UPDATE gst_check_quota 
       SET status = 0 
       WHERE status = 1`,
      );
      console.log(`Reset status=1 -> 0: ${result.affectedRows} row`);
      return result;
    } catch (err) {
      console.error("Error resetStuck:", err);
      throw err;
    }
  }

  static async resetStatusGst(consoleId) {
    const result = await db.query(
      `UPDATE gst_check_quota SET status = 0 WHERE status = 3 AND console = ?`,
      [consoleId],
    );
    return result;
  }

  static async getAllResetGst(consoleId) {
    const [rows] = await db.query(
      `SELECT * FROM gst_check_quota 
     WHERE status=3 AND console = ?`,
      [consoleId],
    );
    return rows;
  }

  static async updateStatus(id, status) {
    return await db.query(
      `UPDATE gst_check_quota SET status = ? WHERE id = ?`,
      [status, id],
    );
  }

  static async getLastRef(check_quota_id, date) {
    const [rows] = await db.query(
      `SELECT COALESCE(MAX(ref), 0) AS lastRef 
     FROM gst_log_check_quota 
     WHERE check_quota_id = ? AND date = ?`,
      [check_quota_id, date],
    );
    return rows[0]?.lastRef || 0;
  }
}
