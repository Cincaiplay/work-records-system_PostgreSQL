// src/middleware/permission.js
import db from "../config/db.js";

function isApiRequest(req) {
  return (
    req.originalUrl?.startsWith("/api/") ||
    req.headers.accept?.includes("application/json")
  );
}

function isAdminUser(user) {
  // compatible with old 0/1 and new boolean
  return user?.is_admin === true || Number(user?.is_admin) === 1;
}

export function requirePermission(code) {
  return async (req, res, next) => {
    const user = req.session?.user;

    if (!user?.id) {
      return isApiRequest(req)
        ? res.status(401).json({ error: "Unauthorized" })
        : res.redirect("/login");
    }

    if (isAdminUser(user)) return next();

    try {
      const row = await db.get(
        `
        SELECT 1 AS ok
          FROM users u
          JOIN roles r ON r.id = u.role_id
          JOIN role_permissions rp ON rp.role_id = r.id
          JOIN permissions p ON p.id = rp.permission_id
         WHERE u.id = ?
           AND p.code = ?
         LIMIT 1
        `,
        [Number(user.id), String(code)]
      );

      if (!row) {
        return isApiRequest(req)
          ? res.status(403).json({ error: "Forbidden", missingPermission: code })
          : res.status(403).render("403", {
              title: "Access denied",
              active: null,
              missingPermission: code,
              message: "Ask an admin to grant you access via Roles & Permissions.",
              path: req.originalUrl,
              method: req.method,
            });
      }

      return next();
    } catch (err) {
      console.error("requirePermission error:", err);
      return isApiRequest(req)
        ? res.status(500).json({ error: "Server error" })
        : res.status(500).send("Server error");
    }
  };
}

export async function hasPermission(userId, code) {
  try {
    if (!userId) return false;

    const row = await db.get(
      `
      SELECT 1 AS ok
        FROM users u
        JOIN roles r ON r.id = u.role_id
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = ?
         AND p.code = ?
       LIMIT 1
      `,
      [Number(userId), String(code)]
    );

    return !!row;
  } catch (err) {
    console.error("hasPermission error:", err);
    return false;
  }
}
