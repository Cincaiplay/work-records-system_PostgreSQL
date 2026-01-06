// src/routes/jobRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

/* ------------------ helpers ------------------ */
function getCompanyId(req) {
  if (req.query?.companyId) return Number(req.query.companyId);
  if (req.body?.companyId) return Number(req.body.companyId);
  if (req.body?.company_id) return Number(req.body.company_id);
  return 1;
}

function normalizeWageRates(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => ({
      tier_id: Number(x?.tier_id),
      wage_rate: Number(x?.wage_rate || 0),
    }))
    .filter((x) => Number.isFinite(x.tier_id) && x.tier_id > 0);
}

/* ------------------ GET jobs + wages ------------------ */
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const rows = await db.all(
      `
      SELECT
        j.id AS job_id,
        j.job_code,
        j.job_type,
        j.normal_price,
        j.normal_price AS customer_rate,
        j.is_active,

        wt.id AS tier_id,
        wt.tier_name,
        COALESCE(jw.wage_rate, 0) AS wage_rate

      FROM jobs j
      LEFT JOIN wage_tiers wt
        ON wt.company_id = j.company_id
      LEFT JOIN job_wages jw
        ON jw.job_id = j.id
       AND jw.tier_id = wt.id

      WHERE j.company_id = ?
      ORDER BY j.job_code, wt.sort_order, wt.id
      `,
      [companyId]
    );

    const map = new Map();

    for (const r of rows || []) {
      if (!map.has(r.job_id)) {
        map.set(r.job_id, {
          id: r.job_id,
          job_code: r.job_code,
          job_type: r.job_type,
          normal_price: r.normal_price,
          customer_rate: Number(r.customer_rate || 0),
          is_active: r.is_active,
          wage_rates: [],
        });
      }

      if (r.tier_id != null) {
        map.get(r.job_id).wage_rates.push({
          tier_id: r.tier_id,
          tier_name: r.tier_name,
          wage_rate: Number(r.wage_rate || 0),
        });
      }
    }

    return res.json([...map.values()]);
  } catch (err) {
    console.error("GET /api/jobs error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* ------------------ CREATE job ------------------ */
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const job_code = (req.body?.job_code || "").trim();
    const job_type = (req.body?.job_type || "").trim();
    const normal_price = Number(req.body?.normal_price || 0);
    const is_active = req.body?.is_active == null ? true : (req.body.is_active === true || Number(req.body.is_active) === 1);
    const rates = normalizeWageRates(req.body?.wage_rates);

    if (!job_code || !job_type) {
      return res.status(400).json({ error: "job_code and job_type required" });
    }

    const created = await db.tx(async (t) => {
      const inserted = await t.get(
        `
        INSERT INTO jobs (company_id, job_code, job_type, normal_price, is_active)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
        `,
        [companyId, job_code, job_type, normal_price, is_active]
      );

      const jobId = Number(inserted?.id);
      if (!jobId) throw new Error("Failed to create job");

      for (const r of rates) {
        await t.run(
          `
          INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (job_id, tier_id)
          DO UPDATE SET wage_rate = EXCLUDED.wage_rate
          `,
          [companyId, jobId, r.tier_id, r.wage_rate]
        );
      }

      return { id: jobId };
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("POST /api/jobs error:", err);
    // unique violation (if you have UNIQUE(company_id, job_code))
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Job code already exists for this company." });
    }
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

/* ------------------ UPDATE job ------------------ */
router.put("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const jobId = Number(req.params.id);

    if (!Number.isFinite(jobId) || jobId <= 0) {
      return res.status(400).json({ error: "Invalid job id" });
    }

    const job_code = (req.body?.job_code || "").trim();
    const job_type = (req.body?.job_type || "").trim();
    const normal_price = Number(req.body?.normal_price || 0);
    const is_active = req.body?.is_active == null ? true : (req.body.is_active === true || Number(req.body.is_active) === 1);
    const rates = normalizeWageRates(req.body?.wage_rates);

    await db.tx(async (t) => {
      const updated = await t.run(
        `
        UPDATE jobs
           SET job_code = ?,
               job_type = ?,
               normal_price = ?,
               is_active = ?
         WHERE id = ?
           AND company_id = ?
        `,
        [job_code, job_type, normal_price, is_active, jobId, companyId]
      );

      if (!updated?.rowCount) {
        const e = new Error("Job not found");
        e.status = 404;
        throw e;
      }

      // optional: clean removed tiers (keeps DB in sync with UI)
      if (rates.length) {
        await t.run(
          `
          DELETE FROM job_wages
           WHERE company_id = ?
             AND job_id = ?
             AND tier_id <> ALL(?)
          `,
          [companyId, jobId, rates.map((r) => r.tier_id)]
        );
      } else {
        await t.run(`DELETE FROM job_wages WHERE company_id = ? AND job_id = ?`, [companyId, jobId]);
      }

      for (const r of rates) {
        await t.run(
          `
          INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (job_id, tier_id)
          DO UPDATE SET wage_rate = EXCLUDED.wage_rate
          `,
          [companyId, jobId, r.tier_id, r.wage_rate]
        );
      }
    });

    return res.json({ message: "Job updated" });
  } catch (err) {
    console.error("PUT /api/jobs error:", err);
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Job code already exists for this company." });
    }
    return res.status(err.status || 500).json({ error: err.message || "Database error" });
  }
});

/* ------------------ DELETE job ------------------ */
router.delete("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const jobId = Number(req.params.id);

    if (!Number.isFinite(jobId) || jobId <= 0) {
      return res.status(400).json({ error: "Invalid job id" });
    }

    const result = await db.run(`DELETE FROM jobs WHERE id = ? AND company_id = ?`, [jobId, companyId]);
    if (!result?.rowCount) return res.status(404).json({ error: "Not found" });

    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("DELETE /api/jobs error:", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

export default router;
