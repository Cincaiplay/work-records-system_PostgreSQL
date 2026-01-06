// src/config/db.js
import dotenv from "dotenv";
dotenv.config();

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL env var (needed for Postgres).");
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Convert SQLite-style ? placeholders to Postgres $1, $2...
// NOTE: this is simple and assumes your SQL does not contain '?' inside string literals.
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  return pool.query(toPgPlaceholders(sql), params);
}

async function run(sql, params = []) {
  return query(sql, params); // returns { rowCount, rows, ... }
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] ?? null;
}

async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const api = {
      query: (sql, params = []) => client.query(toPgPlaceholders(sql), params),
      run: (sql, params = []) => client.query(toPgPlaceholders(sql), params),
      get: async (sql, params = []) => {
        const r = await client.query(toPgPlaceholders(sql), params);
        return r.rows[0] ?? null;
      },
      all: async (sql, params = []) => {
        const r = await client.query(toPgPlaceholders(sql), params);
        return r.rows;
      },
    };

    const out = await fn(api);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function initDb() {
  const schemaPath = path.join(__dirname, "./schema.pg.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(sql);
  console.log("✅ Postgres schema ensured.");
}

// Compatibility helper (if any old code still calls db.close())
async function close() {
  await pool.end();
}

export default {
  pool,
  query,
  run,
  get,
  all,
  tx,
  close,
};