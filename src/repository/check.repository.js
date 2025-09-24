import db from "../config/db.js";

export default class CheckRepository {
  static async getAllUrl() {
    const [rows] = await db.query(
      "SELECT url_check,date_check,status FROM gst_check_quota WHERE status=0 ORDER BY RAND() LIMIT 5",
    );
    return rows;
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
    } = data;

    const sql = `
      INSERT INTO gst_log_check_quota
      (sn, msisdn, masa_tunggu_kartu, value_check, date_check, status, status_paket, kuota)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      sn,
      msisdn,
      masa_tunggu_kartu,
      JSON.stringify(value_check),
      date_check,
      status,
      status_paket,
      kuota,
    ];

    return await db.execute(sql, values);
  }

  static async isAlreadyLoggedToday(sn, msisdn) {
    const [rows] = await db.query(
      `SELECT 1 FROM gst_log_check_quota 
     WHERE sn = ? AND msisdn = ? 
       AND DATE(date_check) = CURDATE()`,
      [sn, msisdn],
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
