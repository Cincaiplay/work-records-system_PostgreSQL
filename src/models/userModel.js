// src/models/userModel.js
import db from "../config/db.js";

export async function getAllUsers() {
  // NOTE: Your main system "users" table is actually:
  // id, company_id, role_id, username, email, password_hash, is_active, is_admin, created_at, ...
  // This "name" field probably does NOT exist in that table.
  //
  // If you still want this simple API for testing, use username instead of name.
  const rows = await db.all(
    `
    SELECT id,
           username AS name,
           email,
           created_at
      FROM users
     ORDER BY created_at DESC, id DESC
    `
  );
  return rows;
}

export async function createUser(name, email) {
  // Same note: store into username/email instead of name/email
  // (password_hash required in your real auth flow, so this is really just a demo endpoint)
  const row = await db.get(
    `
    INSERT INTO users (username, email, is_active, is_admin)
    VALUES (?, ?, TRUE, FALSE)
    RETURNING id, username AS name, email
    `,
    [String(name).trim(), String(email).trim()]
  );

  return row;
}
