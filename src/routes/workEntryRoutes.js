// src/routes/workEntryRoutes.js  (Postgres-ready)
import { Router } from "express";
import db from "../config/db.js";
import { requirePermission } from "../middleware/permission.js";

const router = Router();

/**
 * Prefer:
 * - query.companyId (frontend passes it)
 * - body.company_id
 * - session.activeCompanyId (admin switcher)
 * - user's company_id
 * - fallback 1 (only as last resort)
 */
function getCompanyId(req) {
  if (req.query?.companyId) return Number.parseInt(req.query.companyId, 10);
  if (req.body?.company_id) return Number.parseInt(req.body.company_id, 10);

  const sess = req.session || {};
  if (sess.activeCompanyId) return Number(sess.activeCompanyId);

  const userCompanyId = sess.user?.company_id;
  if (userCompanyId) return Number(userCompanyId);

  return 1;
}

function isTrue(v) {
  return v === true || Number(v) === 1;
}

async function getDaysLimitForUser(req) {
  const userId = req.session?.user?.id;
  const isAdmin = isTrue(req.session?.user?.is_admin);

  if (!userId || isAdmin) return null; // unlimited

  const row = await db.get(
    `
    SELECT
      us.work_entries_days_limit_override AS override_limit,
      r.work_entries_days_limit AS role_limit
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
    `,
    [userId]
  );

  const limit =
    row?.override_limit != null
      ? Number(row.override_limit)
      : row?.role_limit != null
        ? Number(row.role_limit)
        : null;

  if (!Number.isFinite(limit) || limit <= 0) return null;
  return limit;
}

async function hasPermissionForReq(req, code) {
  const user = req.session?.user;
  if (!user?.id) return false;

  if (isTrue(user.is_admin)) return true;

  const row = await db.get(
    `
    SELECT 1 AS ok
      FROM users u
      JOIN roles r ON r.id = u.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = ?
       AND p.code = ?
       AND COALESCE(p.is_active, FALSE) = TRUE
     LIMIT 1
    `,
    [user.id, code]
  );

  return !!row;
}

/**
 * Helper: check if a record is editable/deletable by daysLimit.
 * If daysLimit = null => allowed
 *
 * Postgres-safe date limit:
 *   we.work_date::date >= (CURRENT_DATE - (?::int * INTERVAL '1 day'))
 */
async function ensureRowWithinLimit({ id, companyId, daysLimit }) {
  const dateSql =
    daysLimit != null
      ? `AND we.work_date::date >= (CURRENT_DATE - (?::int * INTERVAL '1 day'))`
      : "";

  const sql = `
    SELECT we.id
      FROM work_entries we
     WHERE we.id = ?
       AND we.company_id = ?
       ${dateSql}
     LIMIT 1
  `;

  const params = daysLimit != null ? [id, companyId, daysLimit] : [id, companyId];
  const row = await db.get(sql, params);
  return !!row;
}

// numeric helpers
const toNumOrNull = (v) => {
  if (v === "" || v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const toReqNum = (v) => {
  const x = toNumOrNull(v);
  return x == null ? null : x;
};

/* ===========================
   GET all work entries
   GET /api/work-entries?companyId=1
   =========================== */
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const daysLimit = await getDaysLimitForUser(req);

    const params = [companyId];
    const dateFilterSql =
      daysLimit != null
        ? `AND we.work_date::date >= (CURRENT_DATE - (?::int * INTERVAL '1 day'))`
        : "";

    if (daysLimit != null) params.push(daysLimit);

    const rows = await db.all(
      `
      SELECT
        we.id,
        we.company_id,

        we.worker_id,
        wk.worker_code,
        wk.worker_name,

        we.job_id,
        j.job_code,
        j.job_type,

        we.amount,
        we.is_bank,

        we.customer_rate,
        we.customer_total,

        we.wage_tier_id,
        wt.tier_name AS wage_tier_name,
        we.wage_rate,
        we.wage_total,

        we.job_no1,
        we.job_no2,
        we.work_date,
        we.note,
        we.fees_collected,
        we.created_at
      FROM work_entries we
      LEFT JOIN workers wk
        ON wk.id = we.worker_id AND wk.company_id = we.company_id
      LEFT JOIN jobs j
        ON j.id = we.job_id AND j.company_id = we.company_id
      LEFT JOIN wage_tiers wt
        ON wt.id = we.wage_tier_id AND wt.company_id = we.company_id
      WHERE we.company_id = ?
        ${dateFilterSql}
      ORDER BY we.work_date DESC, we.id DESC
      `,
      params
    );

    res.json(rows || []);
  } catch (err) {
    console.error("GET /api/work-entries error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   CREATE work entry
   POST /api/work-entries
   =========================== */
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const {
      company_id,
      worker_id,
      job_code,
      amount,
      is_bank,

      customer_rate,
      customer_total,

      wage_tier_id,
      wage_rate,
      wage_total,

      // legacy (optional)
      rate,
      pay,

      job_no1,
      job_no2,
      work_date,

      // new
      fees_collected,

      note,
    } = req.body;

    const finalCompanyId = Number(company_id || companyId || 1);

    // required checks
    if (!finalCompanyId || !worker_id || !job_code || !amount || !job_no1 || !work_date) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    if (customer_rate == null || customer_total == null || wage_rate == null || wage_total == null) {
      return res.status(400).json({
        error: "customer_rate/customer_total/wage_rate/wage_total are required.",
      });
    }

    const amountNum = toReqNum(amount);
    const customerRateNum = toReqNum(customer_rate);
    const customerTotalNum = toReqNum(customer_total);
    const wageRateNum = toReqNum(wage_rate);
    const wageTotalNum = toReqNum(wage_total);

    if (
      amountNum == null ||
      customerRateNum == null ||
      customerTotalNum == null ||
      wageRateNum == null ||
      wageTotalNum == null
    ) {
      return res.status(400).json({ error: "Invalid numeric value in amount/rates/totals." });
    }

    // Fees Collected default: customer_total
    const feesCollectedNum = toNumOrNull(fees_collected);
    const finalFeesCollected = feesCollectedNum == null ? customerTotalNum : feesCollectedNum;

    const out = await db.tx(async (t) => {
      const jobRow = await t.get(
        `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
        [finalCompanyId, String(job_code).trim()]
      );

      if (!jobRow) {
        const e = new Error(`Invalid job_code: ${job_code}`);
        e.status = 400;
        throw e;
      }

      const inserted = await t.get(
        `
        INSERT INTO work_entries (
          company_id, worker_id, job_id, amount,
          is_bank,
          customer_rate, customer_total,
          wage_tier_id, wage_rate, wage_total,
          rate, pay,
          job_no1, job_no2, work_date,
          note, fees_collected
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        `,
        [
          finalCompanyId,
          Number(worker_id),
          jobRow.id,
          amountNum,

          isTrue(is_bank),

          customerRateNum,
          customerTotalNum,

          wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null,
          wageRateNum,
          wageTotalNum,

          toNumOrNull(rate) ?? wageRateNum ?? 0,
          toNumOrNull(pay) ?? wageTotalNum ?? 0,

          String(job_no1).trim(),
          (job_no2 || "").trim() || null,
          work_date,

          (note || "").trim() || null,
          finalFeesCollected,
        ]
      );

      return inserted;
    });

    res.status(201).json({ id: out.id, fees_collected: finalFeesCollected });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(400).json({ error: "Job No1 already exists for this company." });
    }
    if (err?.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error("INSERT work_entries error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   UPDATE work entry (protected by daysLimit)
   PUT /api/work-entries/:id?companyId=1
   =========================== */
router.put("/:id", requirePermission("WORK_ENTRY_EDIT"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);

    const {
      worker_id,
      job_code,
      amount,
      is_bank,
      customer_rate,
      wage_tier_id,
      wage_rate,
      job_no1,
      job_no2,
      work_date,
      note,
      fees_collected,
    } = req.body;

    if (!Number.isFinite(id) || id <= 0 || !companyId) {
      return res.status(400).json({ error: "Invalid id/company." });
    }
    if (!worker_id) return res.status(400).json({ error: "worker_id is required." });
    if (!job_code || amount == null || !job_no1 || !work_date) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const hrs = Number(amount);
    if (!Number.isFinite(hrs) || hrs <= 0) {
      return res.status(400).json({ error: "Invalid amount (hours)." });
    }

    const daysLimit = await getDaysLimitForUser(req);
    const ok = await ensureRowWithinLimit({ id, companyId, daysLimit });
    if (!ok) {
      return res.status(403).json({
        error: "You cannot edit this record (out of allowed date range).",
      });
    }

    const jobRow = await db.get(
      `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
      [companyId, String(job_code).trim()]
    );
    if (!jobRow) return res.status(400).json({ error: `Invalid job_code: ${job_code}` });
    const jobId = jobRow.id;

    const canEditRates = await hasPermissionForReq(req, "WORK_ENTRY_EDIT_RATES");

    const existing = await db.get(
      `SELECT * FROM work_entries WHERE id = ? AND company_id = ? LIMIT 1`,
      [id, companyId]
    );
    if (!existing) return res.status(404).json({ error: "Work entry not found." });

    const wantsRateChange =
      (customer_rate != null && Number(customer_rate) !== Number(existing.customer_rate)) ||
      (wage_rate != null && Number(wage_rate) !== Number(existing.wage_rate));

    if (wantsRateChange && !canEditRates) {
      return res.status(403).json({ error: "No permission to edit rates." });
    }

    const finalTierId =
      wage_tier_id != null && wage_tier_id !== ""
        ? Number(wage_tier_id)
        : (existing.wage_tier_id ?? null);

    const requestedFees = toNumOrNull(fees_collected);
    if (requestedFees != null && requestedFees < 0) {
      return res.status(400).json({ error: "fees_collected cannot be negative." });
    }

    let finalCustomerRate;
    let finalWageRate;

    if (!canEditRates) {
      const rateRow = await db.get(
        `
        SELECT
          j.normal_price AS customer_rate,
          COALESCE(jw.wage_rate, 0) AS wage_rate
        FROM jobs j
        LEFT JOIN job_wages jw
          ON jw.job_id = j.id
         AND jw.tier_id = ?
         AND jw.company_id = j.company_id
        WHERE j.id = ?
          AND j.company_id = ?
        LIMIT 1
        `,
        [finalTierId, jobId, companyId]
      );

      if (!rateRow) {
        return res.status(400).json({
          error: "Failed to resolve rates for selected job/tier.",
        });
      }

      finalCustomerRate = Number(rateRow.customer_rate || 0);
      finalWageRate = Number(rateRow.wage_rate || 0);

      if (!Number.isFinite(finalCustomerRate) || finalCustomerRate <= 0) {
        return res.status(400).json({ error: "Invalid customer rate for this job." });
      }
      if (!Number.isFinite(finalWageRate) || finalWageRate <= 0) {
        return res.status(400).json({ error: "Invalid wage rate for this wage tier." });
      }
    } else {
      finalCustomerRate = Number(customer_rate);
      finalWageRate = Number(wage_rate);

      if (!Number.isFinite(finalCustomerRate) || finalCustomerRate <= 0) {
        return res.status(400).json({ error: "Invalid customer_rate." });
      }
      if (!Number.isFinite(finalWageRate) || finalWageRate <= 0) {
        return res.status(400).json({ error: "Invalid wage_rate." });
      }
    }

    const finalCustomerTotal = finalCustomerRate * hrs;
    const finalWageTotal = finalWageRate * hrs;
    const finalFeesCollected = requestedFees == null ? finalCustomerTotal : requestedFees;

    const result = await db.run(
      `
      UPDATE work_entries
         SET job_id = ?,
             amount = ?,
             is_bank = ?,
             worker_id = ?,

             customer_rate = ?,
             customer_total = ?,

             wage_tier_id = ?,
             wage_rate = ?,
             wage_total = ?,

             rate = ?,
             pay = ?,

             job_no1 = ?,
             job_no2 = ?,
             work_date = ?,
             note = ?,
             fees_collected = ?
       WHERE id = ?
         AND company_id = ?
      `,
      [
        jobId,
        hrs,
        isTrue(is_bank),
        Number(worker_id),

        finalCustomerRate,
        finalCustomerTotal,

        finalTierId,
        finalWageRate,
        finalWageTotal,

        finalWageRate,  // legacy rate
        finalWageTotal, // legacy pay

        String(job_no1).trim(),
        (job_no2 || "").trim() || null,
        work_date,
        (note || "").trim() || null,
        finalFeesCollected,

        id,
        companyId,
      ]
    );

    if (!result?.rowCount) return res.status(404).json({ error: "Work entry not found." });

    res.json({
      message: "Updated",
      changes: result.rowCount,
      canEditRates,
      fees_collected: finalFeesCollected,
    });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(400).json({ error: "Job No1 already exists for this company." });
    }
    console.error("UPDATE work_entries error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   DELETE work entry (protected by daysLimit)
   DELETE /api/work-entries/:id?companyId=1
   =========================== */
router.delete("/:id", requirePermission("WORK_ENTRY_DELETE"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number.parseInt(req.params.id, 10);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id." });
    }

    const daysLimit = await getDaysLimitForUser(req);
    const ok = await ensureRowWithinLimit({ id, companyId, daysLimit });

    if (!ok) {
      return res.status(403).json({
        error: "You cannot delete this record (out of allowed date range).",
      });
    }

    const result = await db.run(
      `DELETE FROM work_entries WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (!result?.rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted", changes: result.rowCount });
  } catch (err) {
    console.error("DELETE work_entries error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   GET worker month customer total
   GET /api/work-entries/worker-month-customer-total?companyId=1&workerId=2&month=YYYY-MM
   =========================== */
router.get("/worker-month-customer-total", async (req, res) => {
  try {
    const companyId = Number.parseInt(req.query.companyId, 10) || 1;
    const workerId = Number.parseInt(req.query.workerId, 10);
    const month = (req.query.month || "").trim();

    if (!workerId || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return res
        .status(400)
        .json({ error: "companyId, workerId, and month(YYYY-MM) are required." });
    }

    const start = `${month}-01`;
    const end = new Date(`${month}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const endStr = end.toISOString().slice(0, 10);

    const row = await db.get(
      `
      SELECT COALESCE(SUM(customer_total), 0) AS total
        FROM work_entries
       WHERE company_id = ?
         AND worker_id = ?
         AND work_date::date >= ?::date
         AND work_date::date < ?::date
      `,
      [companyId, workerId, start, endStr]
    );

    res.json({ total: Number(row?.total || 0) });
  } catch (err) {
    console.error("GET worker-month-customer-total error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
