-- src/config/schema.pg.sql
-- Matches current routes + seed (Postgres)

-- Optional: enable uuid etc (not needed)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------
-- Core tables
-- ---------------------------

CREATE TABLE IF NOT EXISTS companies (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  short_code  TEXT NOT NULL UNIQUE,
  address     TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id                     BIGSERIAL PRIMARY KEY,
  company_id              BIGINT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                   TEXT NOT NULL,
  name                   TEXT NOT NULL,
  description            TEXT,
  work_entries_days_limit INT NULL,
  created_at             TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

-- Prevent duplicate "global" roles (company_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS ux_roles_global_code
  ON roles (code)
  WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  role_id       BIGINT REFERENCES roles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS permissions (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id            BIGSERIAL PRIMARY KEY,
  role_id       BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
  id                              BIGSERIAL PRIMARY KEY,
  user_id                          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id                       BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  can_see_rates                    BOOLEAN NOT NULL DEFAULT FALSE,
  work_entries_days_limit_override INT NULL,
  created_at                       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, company_id)
);

-- ---------------------------
-- Business tables
-- ---------------------------

CREATE TABLE IF NOT EXISTS jobs (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_code     TEXT NOT NULL,
  job_type     TEXT NOT NULL,
  normal_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, job_code)
);

CREATE TABLE IF NOT EXISTS wage_tiers (
  id         BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tier_code  TEXT NOT NULL,
  tier_name  TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, tier_code)
);

CREATE TABLE IF NOT EXISTS job_wages (
  id         BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id     BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tier_id    BIGINT NOT NULL REFERENCES wage_tiers(id) ON DELETE CASCADE,
  wage_rate  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (job_id, tier_id)
);

CREATE TABLE IF NOT EXISTS workers (
  id                  BIGSERIAL PRIMARY KEY,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  legacy_id           BIGINT,
  worker_code         TEXT NOT NULL,
  worker_name         TEXT,
  worker_english_name TEXT,
  passport_no         TEXT,
  employment_start    TEXT,
  nationality         TEXT,
  field1              TEXT,
  wage_tier_id        BIGINT REFERENCES wage_tiers(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, worker_code)
);

-- IMPORTANT: this is the Postgres version your routes expect
CREATE TABLE IF NOT EXISTS work_entries (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  worker_id     BIGINT REFERENCES workers(id) ON DELETE SET NULL,
  job_id        BIGINT REFERENCES jobs(id) ON DELETE SET NULL,

  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_bank       BOOLEAN NOT NULL DEFAULT FALSE,

  customer_rate  NUMERIC(12,2) NOT NULL DEFAULT 0,
  customer_total NUMERIC(12,2) NOT NULL DEFAULT 0,

  wage_tier_id  BIGINT REFERENCES wage_tiers(id) ON DELETE SET NULL,
  wage_rate     NUMERIC(12,2) NOT NULL DEFAULT 0,
  wage_total    NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- legacy compat fields (your code still writes them)
  rate          NUMERIC(12,2) NOT NULL DEFAULT 0,
  pay           NUMERIC(12,2) NOT NULL DEFAULT 0,

  job_no1       TEXT NOT NULL,
  job_no2       TEXT,
  work_date     DATE NOT NULL,

  fees_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE (company_id, job_no1)
);

-- Helpful indexes for reports & listing
CREATE INDEX IF NOT EXISTS ix_work_entries_company_date
  ON work_entries (company_id, work_date);

CREATE INDEX IF NOT EXISTS ix_work_entries_company_worker_date
  ON work_entries (company_id, worker_id, work_date);

-- ---------------------------
-- Rules tables
-- ---------------------------

CREATE TABLE IF NOT EXISTS rules (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS company_rules (
  id         BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rule_code  TEXT NOT NULL REFERENCES rules(code) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, rule_code)
);
