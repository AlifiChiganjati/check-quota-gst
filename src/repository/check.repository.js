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
       ORDER BY RAND()
       LIMIT 5
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
    } = data;

    const sql = `
  INSERT INTO gst_log_check_quota
  (sn, msisdn, masa_tunggu_kartu, value_check, date_check, status, status_paket, kuota, check_quota_id, date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`; // <--- 10 placeholder

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
}
