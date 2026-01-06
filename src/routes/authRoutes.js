// src/routes/authRoutes.js
import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";

const router = Router();

function isTrue(v) {
  // compatible with boolean + 0/1
  return v === true || Number(v) === 1;
}

// GET /login
router.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.render("login", { title: "Login", error: null, username: "" });
});

// POST /login
router.post("/login", async (req, res) => {
  const username = (req.body?.username || "").trim();
  const password = req.body?.password || "";

  if (!username || !password) {
    return res.status(400).render("login", {
      title: "Login",
      error: "Username and password are required.",
      username,
    });
  }

  try {
    const user = await db.get(
      `
      SELECT id, company_id, role_id, username, email, password_hash, is_active, is_admin
        FROM users
       WHERE username = ?
      `,
      [username]
    );

    if (!user) {
      return res.status(401).render("login", {
        title: "Login",
        error: "Invalid username or password.",
        username,
      });
    }

    if (!isTrue(user.is_active)) {
      return res.status(403).render("login", {
        title: "Login",
        error: "Account is disabled.",
        username,
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).render("login", {
        title: "Login",
        error: "Invalid username or password.",
        username,
      });
    }

    // ✅ Load permissions for this user (via role)
    const permRows = await db.all(
      `
      SELECT DISTINCT p.code
        FROM users u
        JOIN roles r ON r.id = u.role_id
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = ?
         AND COALESCE(p.is_active::boolean, false) = true
      `,
      [Number(user.id)]
    );

    const permissions = (permRows || []).map((x) => x.code);

    // ✅ Save session
    req.session.user = {
      id: Number(user.id),
      company_id: user.company_id != null ? Number(user.company_id) : null,
      username: user.username,
      email: user.email,
      is_admin: isTrue(user.is_admin),
      role_id: user.role_id != null ? Number(user.role_id) : null,
      permissions,
    };

    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Login DB error:", err);
    return res.status(500).render("login", {
      title: "Login",
      error: "Database error.",
      username,
    });
  }
});

// POST /logout (safer than GET)
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

export default router;
