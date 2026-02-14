// repository/check.repository.js ini adalah query-query yang akan dipakai.
import db from "../config/db.js";

export default class CheckRepository {
  static async getAllUrl(consoleId, limit = 10) {
    const conn = await db.getConnection(); // ambil 1 koneksi tetap

    try {
      await conn.beginTransaction();

      // 1️⃣ Select + Lock
      const [ids] = await conn.query(
        `
      SELECT id
      FROM gst_check_quota
      WHERE status = 0
      AND console = ?
      ORDER BY id ASC
      LIMIT ?
      FOR UPDATE
      `,
        [consoleId, limit],
      );

      if (!ids.length) {
        await conn.commit();
        return [];
      }

      const idList = ids.map((r) => r.id);

      // 2️⃣ Update status jadi processing
      await conn.query(
        `
      UPDATE gst_check_quota
      SET status = 1
      WHERE id IN (?)
      `,
        [idList],
      );

      // 3️⃣ Ambil data lengkap
      const [rows] = await conn.query(
        `
      SELECT id, url_check, sn, msisdn
      FROM gst_check_quota
      WHERE id IN (?)
      ORDER BY id ASC
      `,
        [idList],
      );

      await conn.commit();

      return rows;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  static async getLastRefs(checkQuotaIds, date) {
    if (!Array.isArray(checkQuotaIds) || checkQuotaIds.length === 0) return [];

    const sql = `
    SELECT check_quota_id, MAX(ref) AS lastRef
    FROM gst_log_check_quota
    WHERE date = ?
    AND check_quota_id IN (?)
    GROUP BY check_quota_id
  `;

    const [rows] = await db.query(sql, [date, checkQuotaIds]);
    return rows;
  }

  // repository/check.repository.js
  static async insertBulkLog(tableName, batch) {
    if (!Array.isArray(batch) || batch.length === 0) return null;

    const cols = [
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
VALUES ${placeholders} `;
    const values = [];
    for (const row of batch) {
      // Pastikan mapping di sini konsisten dengan array 'cols' di atas!
      values.push(
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
        row.ref,
      );
    }

    return await db.query(sql, values);
  }

  // Batch check existing rows for today for given ids
  static async getExistingLogs(checkQuotaIds, date) {
    if (!Array.isArray(checkQuotaIds) || checkQuotaIds.length === 0) return [];

    // Kita cari log yang punya ref paling besar di hari ini untuk ID-ID tersebut
    const sql = `
    SELECT check_quota_id, MAX(ref) as last_ref
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
        "UPDATE gst_check_quota SET status = 0, last_error_message = NULL WHERE status IN (2, 3, 4)",
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

    for (let i = 0; i < pairs.length; i += batchSize) {
      const chunk = pairs.slice(i, i + batchSize);

      const ids = [];
      const statusCases = [];
      const errorCases = [];
      const statusValues = [];
      const errorValues = [];

      chunk.forEach((p) => {
        ids.push(p.id);

        // status
        statusCases.push(`WHEN ${p.id} THEN ?`);
        statusValues.push(p.newStatus);

        // error message
        if (typeof p.lastError === "string" && p.lastError.length > 0) {
          errorCases.push(`WHEN ${p.id} THEN ?`);
          errorValues.push(p.lastError);
        }
      });

      const sql = `
      UPDATE gst_check_quota
      SET
        status = CASE id
          ${statusCases.join(" ")}
          ELSE status
        END
        ${
          errorCases.length > 0
            ? `,
        last_error_message = CASE id
          ${errorCases.join(" ")}
          ELSE last_error_message
        END`
            : ""
        }
      WHERE id IN (${ids.join(",")})
    `;

      await db.query(sql, [...statusValues, ...errorValues]);
    }

    return { success: true };
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
