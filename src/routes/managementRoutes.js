// src/routes/managementRoutes.js
import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permission.js";

const router = Router();
router.use("/management", requireAuth, requirePermission("PAGE_MANAGEMENT"));

/* ---------------- helpers ---------------- */

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function redirectMgmt(res, tab = "users", params = {}) {
  const qs = new URLSearchParams({ tab, ...params });
  return res.redirect(`/management?${qs.toString()}`);
}

/* ---------------- GET /management ---------------- */

router.get("/management", requireAuth, async (req, res) => {
  const activeTab = req.query.tab || "users";

  // pagination (permissions)
  const permPage = clampInt(req.query.permPage, 1, 999999, 1);
  const permPageSize = clampInt(req.query.permPageSize, 5, 100, 10);

  try {
    const users = await db.all(
      `
      SELECT id, company_id, role_id, username, email, is_active, created_at
        FROM users
       ORDER BY created_at DESC, id DESC
      `
    );

    const companies = await db.all(
      `
      SELECT id, short_code, name
        FROM companies
       ORDER BY short_code ASC
      `
    );

    const roles = await db.all(
      `
      SELECT id, company_id, code, name, description, work_entries_days_limit
        FROM roles
       ORDER BY (company_id IS NOT NULL) DESC, company_id ASC, code ASC
      `
    );

    const totalRow = await db.get(`SELECT COUNT(*) AS total FROM permissions`);
    const permTotal = Number(totalRow?.total || 0);
    const permTotalPages = Math.max(1, Math.ceil(permTotal / permPageSize));
    const safePermPage = Math.min(permPage, permTotalPages);
    const permOffset = (safePermPage - 1) * permPageSize;

    const permissionsPage = await db.all(
      `
      SELECT id, code, description, is_active
        FROM permissions
       ORDER BY code ASC
       LIMIT ? OFFSET ?
      `,
      [permPageSize, permOffset]
    );

    // full list for role permission modal (show only active)
    const permissionsAll = await db.all(
      `
      SELECT id, code, description
        FROM permissions
       WHERE is_active = TRUE
       ORDER BY code ASC
      `
    );

    const rolePerms = await db.all(
      `SELECT role_id, permission_id FROM role_permissions`
    );

    const wageTiers = await db.all(
      `
      SELECT id, company_id, tier_code, tier_name, is_active, sort_order, created_at
        FROM wage_tiers
       ORDER BY company_id ASC, sort_order ASC, tier_code ASC
      `
    );

    return res.render("management", {
      title: "Management",
      error: req.query.error || null,
      success: req.query.success || null,
      activeTab,

      users,
      companies,
      roles,

      permissions: permissionsPage,
      permissionsAll,

      rolePerms,

      wageTiers,

      permPage: safePermPage,
      permPageSize,
      permTotal,
      permTotalPages,
    });
  } catch (err) {
    console.error(err);
    return res.render("management", {
      title: "Management",
      error: "Database error",
      activeTab,
      users: [],
      companies: [],
      roles: [],
      permissions: [],
      permissionsAll: [],
      rolePerms: [],
      wageTiers: [],
      permPage: 1,
      permPageSize,
      permTotal: 0,
      permTotalPages: 1,
    });
  }
});

// POST /management/users/:id/role
router.post("/management/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const roleIdRaw = req.body.role_id;
    const roleId = roleIdRaw === "" || roleIdRaw == null ? null : Number(roleIdRaw);

    if (!Number.isFinite(userId) || userId <= 0) {
      return redirectMgmt(res, "users", { error: "Invalid user id" });
    }
    if (roleId !== null && (!Number.isFinite(roleId) || roleId <= 0)) {
      return redirectMgmt(res, "users", { error: "Invalid role id" });
    }

    const result = await db.run(
      `UPDATE users SET role_id = ? WHERE id = ?`,
      [roleId, userId]
    );

    if (!result?.rowCount) return redirectMgmt(res, "users", { error: "User not found" });
    return redirectMgmt(res, "users", { success: "User role updated" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: err.message });
  }
});

router.post("/management/permissions/:id/toggle", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    await db.run(
      `
      UPDATE permissions
         SET is_active = NOT COALESCE(is_active, FALSE)
       WHERE id = ?
      `,
      [id]
    );

    return res.redirect(
      "/management?tab=perms&success=" +
        encodeURIComponent("Permission status updated")
    );
  } catch (err) {
    console.error("Toggle permission error:", err.message);
    return res.redirect(
      "/management?tab=perms&error=" + encodeURIComponent("Toggle failed")
    );
  }
});

/* ---------------- USERS ---------------- */

router.post("/management/users/create", requireAuth, requireAdmin, async (req, res) => {
  try {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    const email = (req.body.email || "").trim() || null;
    const company_id = req.body.company_id ? Number(req.body.company_id) : null;

    if (!username || !password) {
      return redirectMgmt(res, "users", { error: "Username & password required" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    await db.run(
      `INSERT INTO users (company_id, username, email, password_hash, is_active)
       VALUES (?, ?, ?, ?, TRUE)`,
      [company_id, username, email, password_hash]
    );

    return redirectMgmt(res, "users", { success: "User created" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: err.message });
  }
});

router.post("/management/users/:id/toggle", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.run(
      `
      UPDATE users
         SET is_active = NOT COALESCE(is_active, FALSE)
       WHERE id = ?
      `,
      [Number(req.params.id)]
    );

    return redirectMgmt(res, "users", { success: "User status updated" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: "Toggle failed" });
  }
});

router.post("/management/users/:id/update", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const username = (req.body.username || "").trim();
    const email = (req.body.email || "").trim() || null;
    const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
    const is_active = Number(req.body.is_active) === 1;
    const password = req.body.password || "";

    if (!username) {
      return redirectMgmt(res, "users", { error: "Username required" });
    }

    const fields = [`username = ?`, `email = ?`, `company_id = ?`, `is_active = ?`];
    const params = [username, email, company_id, is_active];

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push("password_hash = ?");
      params.push(hash);
    }

    params.push(id);

    await db.run(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      params
    );

    return redirectMgmt(res, "users", { success: "User updated" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: err.message });
  }
});

/* ---------------- ROLES ---------------- */

router.post("/management/roles/create", requireAuth, requireAdmin, async (req, res) => {
  try {
    const code = (req.body.code || "").trim();
    const name = (req.body.name || "").trim();
    const description = (req.body.description || "").trim() || null;
    const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;

    if (!code || !name) {
      return redirectMgmt(res, "roles", { error: "Code & name required" });
    }

    await db.run(
      `INSERT INTO roles (company_id, code, name, description)
       VALUES (?, ?, ?, ?)`,
      [company_id, code, name, description]
    );

    return redirectMgmt(res, "roles", { success: "Role created" });
  } catch (err) {
    return redirectMgmt(res, "roles", { error: err.message });
  }
});

router.post("/management/roles/:id/permissions", requireAuth, requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);

  let permIds = req.body.permissions || [];
  if (!Array.isArray(permIds)) permIds = [permIds];
  permIds = permIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);

  try {
    await db.tx(async (t) => {
      await t.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

      for (const pid of permIds) {
        await t.run(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES (?, ?)
           ON CONFLICT DO NOTHING`,
          [roleId, pid]
        );
      }
    });

    return redirectMgmt(res, "roles", { success: "Permissions updated" });
  } catch (err) {
    console.error(err);
    return redirectMgmt(res, "roles", { error: err.message || "Failed to update permissions" });
  }
});

// POST /management/roles/:id/delete
router.post("/management/roles/:id/delete", requireAuth, requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);

  if (!Number.isFinite(roleId) || roleId <= 0) {
    return redirectMgmt(res, "roles", { error: "Invalid role id" });
  }

  try {
    await db.tx(async (t) => {
      await t.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

      const del = await t.run(`DELETE FROM roles WHERE id = ?`, [roleId]);

      if (!del?.rowCount) {
        const e = new Error("Role not found");
        e.status = 404;
        throw e;
      }
    });

    return redirectMgmt(res, "roles", { success: "Role deleted" });
  } catch (err) {
    if (err.status === 404) return redirectMgmt(res, "roles", { error: "Role not found" });
    return redirectMgmt(res, "roles", { error: err.message || "Delete failed" });
  }
});

/* ---------------- PERMISSIONS ---------------- */

router.post("/management/permissions/create", requireAuth, requireAdmin, async (req, res) => {
  try {
    const code = (req.body.code || "").trim();
    const description = (req.body.description || "").trim() || null;

    if (!code) {
      return redirectMgmt(res, "perms", { error: "Permission code required" });
    }

    await db.run(
      `INSERT INTO permissions (code, description, is_active)
       VALUES (?, ?, TRUE)`,
      [code, description]
    );

    return redirectMgmt(res, "perms", { success: "Permission created" });
  } catch (err) {
    return redirectMgmt(res, "perms", { error: err.message });
  }
});

// POST /management/permissions/:id/delete  (hard delete - only if NOT used)
router.post("/management/permissions/:id/delete", requireAuth, requireAdmin, async (req, res) => {
  const permId = Number(req.params.id);

  if (!Number.isFinite(permId) || permId <= 0) {
    return redirectMgmt(res, "perms", { error: "Invalid permission id" });
  }

  try {
    const row = await db.get(
      `
      SELECT COUNT(*) AS cnt
        FROM role_permissions
       WHERE permission_id = ?
      `,
      [permId]
    );

    const usedCount = Number(row?.cnt || 0);
    if (usedCount > 0) {
      return redirectMgmt(res, "perms", {
        error: "Cannot delete: permission is assigned to roles. Deactivate it instead.",
      });
    }

    const del = await db.run(`DELETE FROM permissions WHERE id = ?`, [permId]);
    if (!del?.rowCount) return redirectMgmt(res, "perms", { error: "Permission not found" });

    return redirectMgmt(res, "perms", { success: "Permission deleted" });
  } catch (err) {
    console.error("Delete permission error:", err.message);
    return redirectMgmt(res, "perms", { error: err.message || "Database error" });
  }
});

// ---------------- WAGE TIERS ----------------

// POST /management/wage-tiers/create
router.post("/management/wage-tiers/create", requireAuth, requireAdmin, async (req, res) => {
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
  const tier_code = (req.body.tier_code || "").trim();
  const tier_name = (req.body.tier_name || "").trim();
  const sort_order = req.body.sort_order !== "" ? Number(req.body.sort_order) : 0;

  if (!company_id || !tier_code || !tier_name) {
    return redirectMgmt(res, "wage_tiers", {
      error: "Company, tier code, and tier name are required",
    });
  }

  try {
    await db.run(
      `INSERT INTO wage_tiers (company_id, tier_code, tier_name, sort_order, is_active)
       VALUES (?, ?, ?, ?, TRUE)`,
      [company_id, tier_code, tier_name, Number.isFinite(sort_order) ? sort_order : 0]
    );

    return redirectMgmt(res, "wage_tiers", { success: "Wage tier created" });
  } catch (err) {
    // UNIQUE(company_id, tier_code) triggers this
    return redirectMgmt(res, "wage_tiers", { error: err.message });
  }
});

// TOGGLE active
router.post("/management/wage-tiers/:id/toggle", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    await db.run(
      `
      UPDATE wage_tiers
         SET is_active = NOT COALESCE(is_active, FALSE)
       WHERE id = ?
      `,
      [id]
    );

    return redirectMgmt(res, "wage_tiers", { success: "Wage tier updated" });
  } catch (err) {
    return redirectMgmt(res, "wage_tiers", { error: "Toggle failed" });
  }
});

// HARD DELETE (only allow if not referenced)
router.post("/management/wage-tiers/:id/delete", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const row = await db.get(
      `SELECT COUNT(*) AS cnt FROM workers WHERE wage_tier_id = ?`,
      [id]
    );

    if (Number(row?.cnt || 0) > 0) {
      return redirectMgmt(res, "wage_tiers", { error: "Cannot delete: tier is used by workers" });
    }

    await db.run(`DELETE FROM wage_tiers WHERE id = ?`, [id]);
    return redirectMgmt(res, "wage_tiers", { success: "Wage tier deleted" });
  } catch (err) {
    return redirectMgmt(res, "wage_tiers", { error: err.message });
  }
});

export default router;
