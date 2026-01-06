// src/routes/companyRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

function parseId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pgUniqueViolation(err) {
  // Postgres unique_violation
  return err?.code === "23505";
}

// GET all companies
router.get("/", async (req, res) => {
  try {
    const rows = await db.all(
      `
      SELECT id, name, short_code, address, phone, created_at
        FROM companies
       ORDER BY short_code ASC NULLS LAST, name ASC
      `
    );
    return res.json(rows || []);
  } catch (err) {
    console.error("GET /api/companies error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// GET company details
router.get("/:id", async (req, res) => {
  try {
    const companyId = parseId(req.params.id);
    if (!companyId) return res.status(400).json({ error: "Invalid company id" });

    const row = await db.get(
      `
      SELECT id, name, short_code, address, phone, created_at
        FROM companies
       WHERE id = ?
      `,
      [companyId]
    );

    if (!row) return res.status(404).json({ error: "Company not found" });
    return res.json(row);
  } catch (err) {
    console.error("GET /api/companies/:id error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// CREATE company
router.post("/", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    const short_code = (req.body?.short_code || "").trim() || null;
    const address = (req.body?.address || "").trim();
    const phone = (req.body?.phone || "").trim();

    if (!name) return res.status(400).json({ error: "name is required." });

    const inserted = await db.get(
      `
      INSERT INTO companies (name, short_code, address, phone)
      VALUES (?, ?, ?, ?)
      RETURNING id, name, short_code, address, phone, created_at
      `,
      [name, short_code, address, phone]
    );

    return res.status(201).json(inserted);
  } catch (err) {
    console.error("POST /api/companies error:", err);
    if (pgUniqueViolation(err)) {
      return res.status(409).json({ error: "short_code must be unique." });
    }
    return res.status(500).json({ error: "Database error" });
  }
});

// UPDATE company
router.put("/:id", async (req, res) => {
  try {
    const companyId = parseId(req.params.id);
    if (!companyId) return res.status(400).json({ error: "Invalid company id" });

    const name = (req.body?.name || "").trim();
    const short_code = (req.body?.short_code || "").trim() || null;
    const address = (req.body?.address || "").trim();
    const phone = (req.body?.phone || "").trim();

    if (!name) return res.status(400).json({ error: "name is required." });

    const result = await db.run(
      `
      UPDATE companies
         SET name       = ?,
             short_code = ?,
             address    = ?,
             phone      = ?
       WHERE id = ?
      `,
      [name, short_code, address, phone, companyId]
    );

    if (!result?.rowCount) {
      return res.status(404).json({ error: "Company not found." });
    }

    return res.json({ message: "Company updated", changes: result.rowCount });
  } catch (err) {
    console.error("PUT /api/companies error:", err);
    if (pgUniqueViolation(err)) {
      return res.status(409).json({ error: "short_code must be unique." });
    }
    return res.status(500).json({ error: "Database error" });
  }
});

// DELETE company
router.delete("/:id", async (req, res) => {
  try {
    const companyId = parseId(req.params.id);
    if (!companyId) return res.status(400).json({ error: "Invalid company id" });

    const result = await db.run(`DELETE FROM companies WHERE id = ?`, [companyId]);

    if (!result?.rowCount) {
      return res.status(404).json({ error: "Company not found." });
    }

    return res.json({ message: "Company deleted", changes: result.rowCount });
  } catch (err) {
    console.error("DELETE /api/companies error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
