// src/routes/rulesRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

/**
 * GET all available rules
 * GET /api/rules
 */
router.get("/rules", async (req, res) => {
  try {
    const rows = await db.all(
      `
      SELECT code, name, description, is_default
        FROM rules
       ORDER BY is_default DESC, name ASC
      `
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /rules error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/**
 * GET rules for a specific company
 * GET /api/companies/:id/rules
 */
router.get("/companies/:id/rules", async (req, res) => {
  try {
    const companyId = Number.parseInt(req.params.id, 10);

    const rows = await db.all(
      `
      SELECT
        r.code,
        r.name,
        r.description,
        r.is_default,
        CASE WHEN COALESCE(cr.enabled, FALSE) THEN TRUE ELSE FALSE END AS enabled
      FROM rules r
      LEFT JOIN company_rules cr
        ON cr.rule_code = r.code
       AND cr.company_id = ?
      ORDER BY r.is_default DESC, r.name ASC
      `,
      [companyId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET company rules error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/**
 * UPDATE company rules
 * PUT /api/companies/:id/rules
 */
router.put("/companies/:id/rules", async (req, res) => {
  try {
    const companyId = Number.parseInt(req.params.id, 10);
    const enabledRules = Array.isArray(req.body.rules) ? [...req.body.rules] : [];

    // Base rule must ALWAYS be enabled
    if (!enabledRules.includes("BASE_NATIONALITY")) {
      enabledRules.push("BASE_NATIONALITY");
    }

    await db.tx(async (t) => {
      await t.run(`DELETE FROM company_rules WHERE company_id = ?`, [companyId]);

      for (const code of enabledRules) {
        await t.run(
          `
          INSERT INTO company_rules (company_id, rule_code, enabled)
          VALUES (?, ?, TRUE)
          ON CONFLICT DO NOTHING
          `,
          [companyId, code]
        );
      }
    });

    res.json({
      message: "Company rules updated",
      rules: enabledRules,
    });
  } catch (err) {
    console.error("PUT company rules error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
