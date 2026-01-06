// src/db/seed.js
import db from "../config/db.js";
import bcrypt from "bcrypt";

/**
 * Run: node src/db/seed.js
 *
 * Postgres version.
 *
 * Seeds:
 * - companies (default)
 * - wage_tiers (T1/T2/T3 per company)
 * - rules + company_rules (enable defaults)
 * - permissions
 * - roles (global)
 * - role_permissions (super_admin = all, manager/staff curated)
 * - users (admin + manager/staff) + user_roles + users.role_id sync
 */

// Small helpers (db.js already provides run/get/all/tx)
const run = (sql, params = []) => db.run(sql, params);
const get = (sql, params = []) => db.get(sql, params);

/* -----------------------------
   Company
------------------------------ */
async function ensureDefaultCompany() {
  const row = await get(`SELECT id FROM companies ORDER BY id LIMIT 1`);
  if (row?.id) return row.id;

  const inserted = await get(
    `
    INSERT INTO companies (name, short_code, address, phone)
    VALUES (?, ?, ?, ?)
    RETURNING id
    `,
    ["Default Company", "DEFAULT", "", ""]
  );

  if (!inserted?.id) throw new Error("Failed to create default company");
  return inserted.id;
}

/* -----------------------------
   Wage tiers
------------------------------ */
async function ensureWageTiers(companyId) {
  const tiers = [
    ["T1", "Tier 1", 10],
    ["T2", "Tier 2", 20],
    ["T3", "Tier 3", 30],
  ];

  for (const [tier_code, tier_name, sort_order] of tiers) {
    await run(
      `
      INSERT INTO wage_tiers (company_id, tier_code, tier_name, sort_order, is_active)
      VALUES (?, ?, ?, ?, TRUE)
      ON CONFLICT (company_id, tier_code) DO NOTHING
      `,
      [companyId, tier_code, tier_name, sort_order]
    );
  }
}

/* -----------------------------
   Rules
------------------------------ */
async function seedRules() {
  const rules = [
    [
      "BASE_NATIONALITY",
      "Base rule: wage by nationality tier",
      "Uses worker nationality (e.g. china1/2/3) to pick job wage tier",
      true,
    ],
    [
      "OVER_20K_5050",
      "Over 20k/month => 50/50 job price",
      "If monthly customer total reaches/exceeds 20k, wage_rate becomes 50% of customer_rate",
      false,
    ],
  ];

  for (const [code, name, description, is_default] of rules) {
    await run(
      `
      INSERT INTO rules (code, name, description, is_default)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (code) DO NOTHING
      `,
      [code, name, description, Boolean(is_default)]
    );
  }
}

async function ensureCompanyRules(companyId) {
  // Enable all default rules for the company, but don't duplicate
  await run(
    `
    INSERT INTO company_rules (company_id, rule_code, enabled)
    SELECT ?, r.code, TRUE
      FROM rules r
     WHERE r.is_default = TRUE
    ON CONFLICT (company_id, rule_code) DO NOTHING
    `,
    [companyId]
  );
}

/* -----------------------------
   Permissions
------------------------------ */
async function seedPermissions() {
  const permissions = [
    ["PAGE_DASHBOARD", "Can access Dashboard page"],
    ["PAGE_WORKERS", "Can access Workers page"],
    ["PAGE_JOBS", "Can access Jobs page"],
    ["PAGE_RECORDS", "Can access Records page"],
    ["PAGE_REPORTS", "Can access Reports page"],
    ["PAGE_COMPANIES", "Can access Companies page (admin)"],
    ["PAGE_USERS", "Can access Users/Accounts page (admin)"],
    ["PAGE_ROLES", "Can access Roles/Permissions page (admin)"],

    ["WORKER_CREATE", "Can create workers"],
    ["WORKER_EDIT", "Can edit workers"],
    ["WORKER_DELETE", "Can delete workers"],

    ["JOB_CREATE", "Can create jobs"],
    ["JOB_EDIT", "Can edit jobs"],
    ["JOB_DELETE", "Can delete jobs"],

    ["WORK_ENTRY_CREATE", "Can create work entries"],
    ["WORK_ENTRY_EDIT", "Can edit work entries"],
    ["WORK_ENTRY_DELETE", "Can delete work entries"],
    ["WORK_ENTRY_VIEW_ALL_DATES", "Can view work entries without date limit"],

    // ✅ used by workEntryRoutes.js
    ["WORK_ENTRY_EDIT_RATES", "Can edit customer/wage rates in work entries"],

    ["REPORT_EXPORT_PDF", "Can export reports as PDF"],
    ["REPORT_EXPORT_EXCEL", "Can export reports as Excel"],
    ["REPORT_FILTER_PAYTYPE", "Can filter reports by Cash/Bank"],

    ["USER_CREATE", "Can create users"],
    ["USER_EDIT", "Can edit users"],
    ["USER_DEACTIVATE", "Can activate/deactivate users"],

    ["ROLE_CREATE", "Can create roles"],
    ["ROLE_EDIT", "Can edit roles"],
    ["ROLE_ASSIGN", "Can assign roles to users"],
    ["PERMISSION_ASSIGN", "Can assign permissions to roles/users"],

    ["COMPANY_CREATE", "Can create companies"],
    ["COMPANY_EDIT", "Can edit companies"],
  ];

  for (const [code, description] of permissions) {
    await run(
      `
      INSERT INTO permissions (code, description, is_active)
      VALUES (?, ?, TRUE)
      ON CONFLICT (code) DO NOTHING
      `,
      [code, description]
    );
  }
}

/* -----------------------------
   Roles (global roles => company_id NULL)
------------------------------ */
async function seedRoles() {
  const roles = [
    [null, "super_admin", "Super Admin", "System owner: full access across companies", null],
    [null, "manager", "Manager", "Company manager: manage data within their company", null],
    [null, "staff", "Staff", "Standard staff: limited actions within their company", 30],
  ];

  for (const [company_id, code, name, description, daysLimit] of roles) {
    await run(
      `
      INSERT INTO roles (company_id, code, name, description, work_entries_days_limit)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (company_id, code) DO NOTHING
      `,
      [company_id, code, name, description, daysLimit]
    );
  }
}

async function roleIdByCode(code) {
  const row = await get(
    `SELECT id FROM roles WHERE company_id IS NULL AND code = ? LIMIT 1`,
    [code]
  );
  return row?.id || null;
}

async function permissionIdByCode(code) {
  const row = await get(`SELECT id FROM permissions WHERE code = ? LIMIT 1`, [code]);
  return row?.id || null;
}

async function grant(roleCode, permissionCodes) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  for (const pCode of permissionCodes) {
    const permId = await permissionIdByCode(pCode);
    if (!permId) throw new Error(`Permission not found: ${pCode}`);

    await run(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (?, ?)
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [roleId, permId]
    );
  }
}

async function seedRolePermissions() {
  // super_admin => all permissions
  const superRoleId = await roleIdByCode("super_admin");
  if (superRoleId) {
    await run(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT ?, p.id
        FROM permissions p
       WHERE p.is_active = TRUE
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [superRoleId]
    );
  }

  await grant("manager", [
    "PAGE_DASHBOARD",
    "PAGE_WORKERS",
    "PAGE_JOBS",
    "PAGE_RECORDS",
    "PAGE_REPORTS",

    "WORKER_CREATE",
    "WORKER_EDIT",
    "WORKER_DELETE",

    "JOB_CREATE",
    "JOB_EDIT",
    "JOB_DELETE",

    "WORK_ENTRY_CREATE",
    "WORK_ENTRY_EDIT",
    "WORK_ENTRY_DELETE",
    "WORK_ENTRY_EDIT_RATES",

    "REPORT_EXPORT_PDF",
    "REPORT_FILTER_PAYTYPE",

    "USER_CREATE",
    "USER_EDIT",
    "USER_DEACTIVATE",
  ]);

  await grant("staff", [
    "PAGE_DASHBOARD",
    "PAGE_WORKERS",
    "PAGE_JOBS",
    "PAGE_RECORDS",
    "PAGE_REPORTS",

    "WORK_ENTRY_CREATE",
    "REPORT_EXPORT_PDF",
  ]);
}

/* -----------------------------
   Users + role assignment
   IMPORTANT: permission.js uses users.role_id
------------------------------ */
async function ensureUser({
  companyId = null,
  username,
  email,
  password_hash,
  is_admin = false,
  is_active = true,
  roleCode = null,
}) {
  const existing = await get(`SELECT id FROM users WHERE username = ? LIMIT 1`, [username]);
  const roleId = roleCode ? await roleIdByCode(roleCode) : null;

  if (existing?.id) {
    if (roleId) await run(`UPDATE users SET role_id = ? WHERE id = ?`, [roleId, existing.id]);
    await run(`UPDATE users SET company_id = ? WHERE id = ?`, [companyId, existing.id]);
    await run(`UPDATE users SET is_admin = ?, is_active = ? WHERE id = ?`, [
      Boolean(is_admin),
      Boolean(is_active),
      existing.id,
    ]);
    return existing.id;
  }

  const inserted = await get(
    `
    INSERT INTO users (company_id, username, email, password_hash, is_active, is_admin, role_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
    `,
    [companyId, username, email, password_hash, Boolean(is_active), Boolean(is_admin), roleId]
  );

  if (!inserted?.id) throw new Error(`Failed to create user: ${username}`);
  return inserted.id;
}

async function assignRoleToUser(userId, roleCode) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  // legacy sync for permission.js
  await run(`UPDATE users SET role_id = ? WHERE id = ?`, [roleId, userId]);

  // mapping table (future RBAC upgrade)
  await run(
    `
    INSERT INTO user_roles (user_id, role_id)
    VALUES (?, ?)
    ON CONFLICT (user_id, role_id) DO NOTHING
    `,
    [userId, roleId]
  );
}

async function seedDefaultUsers(defaultCompanyId) {
  const DEV_HASH = await bcrypt.hash("123123", 10);

  // admin has NO company
  const adminId = await ensureUser({
    companyId: null,
    username: "admin",
    email: "admin@example.com",
    password_hash: DEV_HASH,
    is_admin: true,
    roleCode: "super_admin",
  });

  const managerId = await ensureUser({
    companyId: defaultCompanyId,
    username: "manager",
    email: "manager@example.com",
    password_hash: DEV_HASH,
    is_admin: false,
    roleCode: "manager",
  });

  const staffId = await ensureUser({
    companyId: defaultCompanyId,
    username: "staff",
    email: "staff@example.com",
    password_hash: DEV_HASH,
    is_admin: false,
    roleCode: "staff",
  });

  await assignRoleToUser(adminId, "super_admin");
  await assignRoleToUser(managerId, "manager");
  await assignRoleToUser(staffId, "staff");
}

/* -----------------------------
   Main
------------------------------ */
async function main() {
  try {
    const companyId = await ensureDefaultCompany();

    await ensureWageTiers(companyId);

    await seedRules();
    await ensureCompanyRules(companyId);

    await seedPermissions();
    await seedRoles();
    await seedRolePermissions();

    await seedDefaultUsers(companyId);

    console.log("✅ Seed complete.");
    console.log("Login accounts (password: 123123):");
    console.log(" - admin / 123123");
    console.log(" - manager / 123123");
    console.log(" - staff / 123123");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    if (db?.pool) await db.pool.end();
  }
}

main();
