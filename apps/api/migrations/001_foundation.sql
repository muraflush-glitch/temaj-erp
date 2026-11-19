-- Temaj ERP — Faza 1: themeli (organizata, përdoruesit, rolet, aprovimet, audit trail)
-- Statusi: PROVIZOR. Struktura juridike (OPEN-01) mbetet e konfigurueshme: një ose disa subjekte.
-- Paraja ruhet si NUMERIC(19,4); politika përfundimtare e saktësisë/rrumbullakimit pret miratim.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Organizata
-- ---------------------------------------------------------------------------
CREATE TABLE legal_entity (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- Të dhënat zyrtare (NUI/NRB) presin OPEN-11; lejohen bosh deri në verifikim.
  tax_number    TEXT,
  business_number TEXT,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branch (
  id              BIGSERIAL PRIMARY KEY,
  legal_entity_id BIGINT NOT NULL REFERENCES legal_entity(id),
  code            TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  city            TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warehouse (
  id         BIGSERIAL PRIMARY KEY,
  branch_id  BIGINT NOT NULL REFERENCES branch(id),
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,30}$'),
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Përdoruesit dhe sesionet
-- ---------------------------------------------------------------------------
CREATE TABLE app_user (
  id              BIGSERIAL PRIMARY KEY,
  email           CITEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  password_hash   TEXT NOT NULL,
  mfa_secret      TEXT,              -- TOTP; e enkriptuar me KMS në Production (detyrë e hapur)
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins   INTEGER NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT mfa_enabled OR mfa_secret IS NOT NULL)
);

CREATE TABLE user_session (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES app_user(id),
  token_hash   TEXT NOT NULL UNIQUE,   -- ruhet vetëm hash-i SHA-256, kurrë token-i
  mfa_passed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX user_session_user_idx ON user_session(user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Rolet dhe lejet (RBAC sipas degës)
-- ---------------------------------------------------------------------------
CREATE TABLE permission (
  code        TEXT PRIMARY KEY CHECK (code ~ '^[a-z]+(\.[a-z_]+)+$'),
  description TEXT NOT NULL
);

CREATE TABLE role (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]{2,40}$'),
  name        TEXT NOT NULL,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE role_permission (
  role_id         BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permission(code),
  PRIMARY KEY (role_id, permission_code)
);

-- branch_id NULL = i vlefshëm për të gjitha degët
CREATE TABLE user_role (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES app_user(id),
  role_id     BIGINT NOT NULL REFERENCES role(id),
  branch_id   BIGINT REFERENCES branch(id),
  granted_by  BIGINT REFERENCES app_user(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,              -- qasje e kufizuar në kohë (p.sh. furnitorë IT)
  revoked_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX user_role_active_uniq
  ON user_role(user_id, role_id, COALESCE(branch_id, 0)) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Aprovimet (katër sy, pa vetë-aprovim)
-- ---------------------------------------------------------------------------
CREATE TABLE approval_policy (
  id                  BIGSERIAL PRIMARY KEY,
  action_code         TEXT NOT NULL,
  branch_id           BIGINT REFERENCES branch(id),   -- NULL = të gjitha degët
  min_amount          NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  required_approvals  INTEGER NOT NULL CHECK (required_approvals BETWEEN 1 AND 5),
  approver_permission TEXT NOT NULL REFERENCES permission(code),
  escalate_after_hours INTEGER CHECK (escalate_after_hours > 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE approval_request (
  id                 BIGSERIAL PRIMARY KEY,
  action_code        TEXT NOT NULL,
  branch_id          BIGINT REFERENCES branch(id),       -- NULL = veprim për gjithë kompaninë
  amount             NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason             TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  policy_id          BIGINT NOT NULL REFERENCES approval_policy(id),
  required_approvals INTEGER NOT NULL CHECK (required_approvals >= 1),
  status             approval_status NOT NULL DEFAULT 'PENDING',
  requested_by       BIGINT NOT NULL REFERENCES app_user(id),
  idempotency_key    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at         TIMESTAMPTZ,
  UNIQUE (requested_by, idempotency_key),
  CHECK ((status = 'PENDING') = (decided_at IS NULL))
);

CREATE TABLE approval_decision (
  id          BIGSERIAL PRIMARY KEY,
  request_id  BIGINT NOT NULL REFERENCES approval_request(id),
  approver_id BIGINT NOT NULL REFERENCES app_user(id),
  decision    TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  comment     TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, approver_id)
);

-- Vetë-aprovimi ndalohet në nivel databaze, jo vetëm në kod.
CREATE FUNCTION forbid_self_approval() RETURNS trigger AS $$
DECLARE requester BIGINT; st approval_status;
BEGIN
  SELECT requested_by, status INTO requester, st FROM approval_request WHERE id = NEW.request_id FOR UPDATE;
  IF requester = NEW.approver_id THEN
    RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF st <> 'PENDING' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER approval_decision_no_self
  BEFORE INSERT ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_self_approval();

CREATE FUNCTION forbid_decision_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'APPROVAL_DECISION_IMMUTABLE' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER approval_decision_immutable
  BEFORE UPDATE OR DELETE ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_decision_change();

-- ---------------------------------------------------------------------------
-- Audit trail: vetëm shtim, zinxhir hash-esh që zbulon ndërhyrjet
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor_user_id BIGINT REFERENCES app_user(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  branch_id    BIGINT REFERENCES branch(id),
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);

CREATE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE last_hash TEXT;
BEGIN
  -- Serializon shtimet që zinxhiri të mos degëzohet.
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
  -- ID-ja merret BRENDA kyçjes, që renditja e ID-ve të përputhet me renditjen e zinxhirit.
  NEW.id := nextval(pg_get_serial_sequence('audit_log', 'id'));
  SELECT hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.occurred_at := clock_timestamp();
  NEW.hash := encode(sha256(convert_to(
      NEW.prev_hash || '|' || NEW.id::text || '|' || to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      COALESCE(NEW.actor_user_id::text, '') || '|' || NEW.action || '|' || NEW.entity_type || '|' ||
      COALESCE(NEW.entity_id, '') || '|' || COALESCE(NEW.branch_id::text, '') || '|' || NEW.details::text,
      'UTF8')), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_chain_ins
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY' USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Verifikon gjithë zinxhirin; kthen ID-në e parë të prishur ose NULL.
CREATE FUNCTION audit_log_verify() RETURNS BIGINT AS $$
DECLARE r RECORD; expected_prev TEXT := repeat('0', 64); h TEXT;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    IF r.prev_hash <> expected_prev THEN RETURN r.id; END IF;
    h := encode(sha256(convert_to(
      r.prev_hash || '|' || r.id::text || '|' || to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      COALESCE(r.actor_user_id::text, '') || '|' || r.action || '|' || r.entity_type || '|' ||
      COALESCE(r.entity_id, '') || '|' || COALESCE(r.branch_id::text, '') || '|' || r.details::text,
      'UTF8')), 'hex');
    IF h <> r.hash THEN RETURN r.id; END IF;
    expected_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE;
