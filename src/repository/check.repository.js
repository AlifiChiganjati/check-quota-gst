// repository/check.repository.js
import db from "../config/db.js";

export default class CheckRepository {
  static async getAllUrl(consoleId, limit = 10) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // STEP 1 — SELECT ID MASIH CEPAT (pakai index)
      const [idRows] = await connection.query(
        `SELECT id 
       FROM gst_check_quota
       WHERE status = 0
         AND console = ?
       ORDER BY id ASC
       LIMIT ?`,
        [consoleId, limit],
      );

      if (idRows.length === 0) {
        await connection.commit();
        return [];
      }

      const ids = idRows.map((r) => r.id);

      // STEP 2 — UPDATE cepat via IN (...)
      await connection.query(
        `UPDATE gst_check_quota
       SET status = 1
       WHERE id IN (?)`,
        [ids],
      );

      // STEP 3 — SELECT data lengkapnya
      const [rows] = await connection.query(
        `SELECT id, url_check, date_check, status, sn, msisdn
       FROM gst_check_quota
       WHERE id IN (?)
       ORDER BY id ASC`,
        [ids],
      );

      await connection.commit();
      return rows;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // repository/check.repository.js
  static async insertBulkLog(tableName, batch) {
    if (!Array.isArray(batch) || batch.length === 0) return null;

    const cols = [
      "raw_html",
      "sn",
      "msisdn",
      "masa_tunggu_kartu",
      "value_check",
      "date_check",
      "status",
      "status_paket",
      "kuota",
      "check_quota_id",
      "date",
      "ref",
    ];

    const placeholders = new Array(batch.length)
      .fill("(" + cols.map(() => "?").join(",") + ")")
      .join(",");

    const sql = `
    INSERT INTO ${tableName} (${cols.join(",")}) 
    VALUES ${placeholders} 
    ON DUPLICATE KEY UPDATE 
      raw_html=VALUES(raw_html),
      ref = ref + 1, 
      msisdn = VALUES(msisdn),
      date_check = VALUES(date_check),
      value_check = VALUES(value_check),
      status_paket = VALUES(status_paket)
  `;

    const values = [];
    for (const row of batch) {
      // Pastikan mapping di sini konsisten dengan array 'cols' di atas!
      values.push(
        row.raw_html || null,
        row.sn || null,
        row.msisdn || null, // Sekarang ini aman karena data sudah di-flatten di service
        row.masa_tunggu_kartu || null,
        typeof row.value_check === "object"
          ? JSON.stringify(row.value_check)
          : row.value_check,
        row.date_check || new Date(),
        row.status || null,
        row.status_paket || null,
        row.kuota || "0",
        row.check_quota_id,
        row.date,
        1,
      );
    }

    return await db.query(sql, values);
  }

  // Batch check existing rows for today for given ids
  static async getExistingLogs(checkQuotaIds, date) {
    if (!Array.isArray(checkQuotaIds) || checkQuotaIds.length === 0) return [];
    const sql = `
      SELECT DISTINCT check_quota_id
      FROM gst_log_check_quota
      WHERE date = ?
      AND check_quota_id IN (?)
    `;
    const [rows] = await db.query(sql, [date, checkQuotaIds]);
    return rows;
  }

  // Batch get lastRef per check_quota_id for date
  static async getLastRefs(checkQuotaIds, date) {
    if (!Array.isArray(checkQuotaIds) || checkQuotaIds.length === 0) return [];
    const sql = `
      SELECT check_quota_id, COALESCE(MAX(ref), 0) AS lastRef
      FROM gst_log_check_quota
      WHERE date = ?
      AND check_quota_id IN (?)
      GROUP BY check_quota_id
    `;
    const [rows] = await db.query(sql, [date, checkQuotaIds]);
    return rows;
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

  static async resetStuck(consoleId) {
    try {
      const [result] = await db.query(
        `UPDATE gst_check_quota 
       SET status = 0 
       WHERE status = 1
       AND console = ?`,
        [consoleId],
      );
      console.log(`Reset status=1 -> 0: ${result.affectedRows} row`);
      return result;
    } catch (err) {
      console.error("Error resetStuck:", err);
      throw err;
    }
  }

  static async getAllResetGst(consoleId) {
    const [rows] = await db.query(
      `SELECT * FROM gst_check_quota 
     WHERE status=3 AND console = ?`,
      [consoleId],
    );
    return rows;
  }

  static async updateAllResetGst(consoleId) {
    const [result] = await db.query(
      `UPDATE gst_check_quota 
         SET status = 0 
         WHERE status = 3 AND console = ?`,
      [consoleId],
    );
    return result;
  }

  static async updateStatus(id, status) {
    return await db.query(
      `UPDATE gst_check_quota SET status = ? WHERE id = ?`,
      [status, id],
    );
  }

  // Bulk update statuses (id -> newStatus) using single UPDATE CASE WHEN
  static async bulkUpdateStatuses(pairs, batchSize = 500) {
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    // Kita bagi pairs menjadi chunk kecil
    for (let i = 0; i < pairs.length; i += batchSize) {
      const chunk = pairs.slice(i, i + batchSize);
      const ids = chunk.map((p) => p.id);
      const cases = chunk
        .map((p) => `WHEN ${p.id} THEN ${p.newStatus}`)
        .join(" ");

      const sql = `
      UPDATE gst_check_quota
      SET status = CASE id
        ${cases}
        ELSE status
      END
      WHERE id IN (?)
    `;

      await db.query(sql, [ids]);
    }
    return { success: true };
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

  static async getAllGstError(consoleId) {
    const [rows] = await db.query(
      `SELECT id FROM gst_check_quota WHERE console=? AND status=2`,
      [consoleId],
    );
    // console.log(rows);
    return rows;
  }

  static async resetAllGstErrorToZero(consoleId) {
    const errorRows = await this.getAllGstError(consoleId);

    if (!errorRows || errorRows.length === 0) {
      return { affectedRows: 0, message: "No abnormal errors found" };
    }
    const ids = errorRows.map((r) => r.id);
    // console.log(ids);

    const sql = `
        UPDATE gst_check_quota
        SET status = 3
        WHERE status = 2
        AND console = ?
        AND id IN (?)
    `;

    const [result] = await db.query(sql, [consoleId, ids]);
    return {
      found: errorRows.length,
      affectedRows: result.affectedRows,
    };
  }
}
