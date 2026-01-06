// src/routes/wageTierRoutes.js
import { Router } from "express";
import db from "../config/db.js";
import { requirePermission } from "../middleware/permission.js";

const router = Router();

function getCompanyId(req) {
  if (req.query?.companyId) return Number.parseInt(req.query.companyId, 10);
  if (req.body?.companyId != null) return Number.parseInt(req.body.companyId, 10);
  if (req.body?.company_id != null) return Number.parseInt(req.body.company_id, 10);

  const sess = req.session || {};
  if (sess.activeCompanyId) return Number(sess.activeCompanyId);

  const userCompanyId = sess.user?.company_id;
  if (userCompanyId) return Number(userCompanyId);

  return 1;
}

// GET /api/wage-tiers?companyId=1
router.get("/", requirePermission("PAGE_JOBS"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const rows = await db.all(
      `
      SELECT id, tier_code, tier_name, is_active, sort_order
        FROM wage_tiers
       WHERE company_id = ?
       ORDER BY sort_order ASC, id ASC
      `,
      [companyId]
    );

    res.json(rows || []);
  } catch (err) {
    console.error("GET /api/wage-tiers error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
