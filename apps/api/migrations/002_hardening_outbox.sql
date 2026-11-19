-- Temaj ERP — Faza 1, pjesa 2: enkriptimi i çelësave 2FA, kufizimi sipas IP-së, outbox, eskalimi i aprovimeve.

-- Çelësi 2FA ruhet vetëm i enkriptuar (format "v1:<keyId>:<iv>:<tag>:<ciphertext>").
ALTER TABLE app_user ADD CONSTRAINT app_user_mfa_secret_encrypted
  CHECK (mfa_secret IS NULL OR mfa_secret LIKE 'v1:%');

-- Tentativat e hyrjes sipas IP-së (kundër provave masive të fjalëkalimeve).
CREATE TABLE login_attempt (
  id           BIGSERIAL PRIMARY KEY,
  ip           INET NOT NULL,
  email        CITEXT,
  succeeded    BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_ip_time_idx ON login_attempt(ip, attempted_at DESC);

-- Transactional outbox: ngjarjet shkruhen në të njëjtin transaksion me veprimin
-- dhe dërgohen më pas nga punëtori, me riprovim dhe dead-letter.
CREATE TYPE outbox_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');

CREATE TABLE outbox_event (
  id              BIGSERIAL PRIMARY KEY,
  topic           TEXT NOT NULL CHECK (topic ~ '^[a-z]+(\.[a-z_]+)+$'),
  payload         JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          outbox_status NOT NULL DEFAULT 'PENDING',
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX outbox_ready_idx ON outbox_event(next_attempt_at) WHERE status IN ('PENDING', 'PROCESSING');

-- VETËM Development/Staging: kuti postare e simuluar, e shënuar qartë si e tillë.
-- Ofruesi real i email/SMS pret OPEN-18 dhe OPEN-19.
CREATE TABLE dev_notification_sink (
  id         BIGSERIAL PRIMARY KEY,
  channel    TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  event_id   BIGINT NOT NULL UNIQUE REFERENCES outbox_event(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dev_notification_sink IS 'SIMULIM — vetëm Development/Staging. Nuk dërgon asgjë jashtë.';

ALTER TABLE approval_request ADD COLUMN escalated_at TIMESTAMPTZ;
