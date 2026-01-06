-- companies (same as yours)
CREATE TABLE IF NOT EXISTS companies (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  short_code  TEXT NOT NULL UNIQUE,
  address     TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- roles: needs days limit + optional company scope
CREATE TABLE IF NOT EXISTS roles (
  id                       BIGSERIAL PRIMARY KEY,
  company_id               BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  description              TEXT,
  work_entries_days_limit  INT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, code)
);

-- permissions: seed.js uses (code, description) and your middleware checks is_active
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

-- users: must have role_id that points to roles
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  role_id       BIGINT REFERENCES roles(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE (user_id, role_id)
);

-- wage_tiers / jobs / job_wages (matches your other routes)
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
  worker_code         TEXT NOT NULL,
  worker_name         TEXT,
  worker_english_name TEXT,
  passport_no         TEXT,
  employment_start    TEXT,
  nationality         TEXT,
  field1              TEXT,
  wage_tier_id        BIGINT REFERENCES wage_tiers(id),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, worker_code)
);

-- ✅ work_entries: MUST match workEntryRoutes.js
CREATE TABLE IF NOT EXISTS work_entries (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  worker_id       BIGINT NOT NULL REFERENCES workers(id),
  job_id          BIGINT NOT NULL REFERENCES jobs(id),

  amount          NUMERIC(10,2) NOT NULL, -- hours / quantity
  is_bank         BOOLEAN NOT NULL DEFAULT FALSE,

  customer_rate   NUMERIC(12,2) NOT NULL,
  customer_total  NUMERIC(12,2) NOT NULL,

  wage_tier_id    BIGINT REFERENCES wage_tiers(id),
  wage_rate       NUMERIC(12,2) NOT NULL,
  wage_total      NUMERIC(12,2) NOT NULL,

  job_no1         TEXT NOT NULL,
  job_no2         TEXT,

  work_date       DATE NOT NULL,
  fees_collected  NUMERIC(12,2) NOT NULL,

  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (company_id, job_no1)
);


-- user_settings: add override used by this route
CREATE TABLE IF NOT EXISTS user_settings (
  id                           BIGSERIAL PRIMARY KEY,
  user_id                       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id                    BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  can_see_rates                 BOOLEAN NOT NULL DEFAULT FALSE,
  work_entries_days_limit_override INT,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, company_id)
);

-- rules tables (your seed uses these)
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
