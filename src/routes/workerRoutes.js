// src/routes/workerRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

function getCompanyId(req) {
  if (req.query?.companyId) return Number.parseInt(req.query.companyId, 10) || 1;
  if (req.body?.companyId != null) return Number.parseInt(req.body.companyId, 10) || 1;
  if (req.body?.company_id != null) return Number.parseInt(req.body.company_id, 10) || 1;
  return 1;
}

function isTrue(v) {
  return v === true || Number(v) === 1;
}

function pgUniqueViolation(err) {
  return err?.code === "23505";
}

// =======================
// GET all workers for a company (+ wage tier name)
// GET /api/workers?companyId=1
// =======================
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const rows = await db.all(
      `
      SELECT
        w.*,
        wt.tier_name AS wage_tier_name
      FROM workers w
      LEFT JOIN wage_tiers wt
        ON wt.id = w.wage_tier_id
       AND wt.company_id = w.company_id
      WHERE w.company_id = ?
      ORDER BY w.worker_code ASC
      `,
      [companyId]
    );

    return res.json(rows || []);
  } catch (err) {
    console.error("GET /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// =======================
// CREATE worker
// POST /api/workers
// =======================
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const worker_code = (req.body?.worker_code || "").trim();
    const worker_name = (req.body?.worker_name || "").trim() || null;
    const worker_english_name = (req.body?.worker_english_name || "").trim() || null;
    const passport_no = (req.body?.passport_no || "").trim() || null;
    const employment_start = req.body?.employment_start || null; // expect YYYY-MM-DD (or null)
    const nationality = (req.body?.nationality || "").trim() || null;
    const field1 = (req.body?.field1 || "").trim() || null;
    const wage_tier_id =
      req.body?.wage_tier_id != null && req.body.wage_tier_id !== ""
        ? Number(req.body.wage_tier_id)
        : null;
    const is_active = req.body?.is_active == null ? true : isTrue(req.body.is_active);

    if (!worker_code) {
      return res.status(400).json({ error: "worker_code is required." });
    }

    const inserted = await db.get(
      `
      INSERT INTO workers (
        company_id, worker_code, worker_name, worker_english_name,
        passport_no, employment_start, nationality, field1,
        wage_tier_id, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
      `,
      [
        companyId,
        worker_code,
        worker_name,
        worker_english_name,
        passport_no,
        employment_start,
        nationality,
        field1,
        Number.isFinite(wage_tier_id) ? wage_tier_id : null,
        is_active,
      ]
    );

    return res.status(201).json({ id: Number(inserted?.id) });
  } catch (err) {
    if (pgUniqueViolation(err)) {
      // assumes UNIQUE(company_id, worker_code)
      return res.status(400).json({ error: "Worker code already exists for this company." });
    }
    console.error("POST /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// =======================
// UPDATE worker
// PUT /api/workers/:id?companyId=1
// =======================
router.put("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid worker id." });
    }

    const worker_code = (req.body?.worker_code || "").trim();
    const worker_name = (req.body?.worker_name || "").trim() || null;
    const worker_english_name = (req.body?.worker_english_name || "").trim() || null;
    const passport_no = (req.body?.passport_no || "").trim() || null;
    const employment_start = req.body?.employment_start || null;
    const nationality = (req.body?.nationality || "").trim() || null;
    const field1 = (req.body?.field1 || "").trim() || null;
    const wage_tier_id =
      req.body?.wage_tier_id != null && req.body.wage_tier_id !== ""
        ? Number(req.body.wage_tier_id)
        : null;
    const is_active = req.body?.is_active == null ? true : isTrue(req.body.is_active);

    if (!worker_code) {
      return res.status(400).json({ error: "worker_code is required." });
    }

    const result = await db.run(
      `
      UPDATE workers
         SET worker_code = ?,
             worker_name = ?,
             worker_english_name = ?,
             passport_no = ?,
             employment_start = ?,
             nationality = ?,
             field1 = ?,
             wage_tier_id = ?,
             is_active = ?
       WHERE id = ?
         AND company_id = ?
      `,
      [
        worker_code,
        worker_name,
        worker_english_name,
        passport_no,
        employment_start,
        nationality,
        field1,
        Number.isFinite(wage_tier_id) ? wage_tier_id : null,
        is_active,
        id,
        companyId,
      ]
    );

    if (!result?.rowCount) {
      return res.status(404).json({ error: "Worker not found for this company." });
    }

    return res.json({ message: "Worker updated", changes: result.rowCount });
  } catch (err) {
    if (pgUniqueViolation(err)) {
      return res.status(400).json({ error: "Worker code already exists for this company." });
    }
    console.error("PUT /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// =======================
// DELETE worker
// DELETE /api/workers/:id?companyId=1
// =======================
router.delete("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid worker id." });
    }

    const result = await db.run(`DELETE FROM workers WHERE id = ? AND company_id = ?`, [
      id,
      companyId,
    ]);

    if (!result?.rowCount) {
      return res.status(404).json({ error: "Worker not found for this company." });
    }

    return res.json({ message: "Worker deleted", changes: result.rowCount });
  } catch (err) {
    console.error("DELETE /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
