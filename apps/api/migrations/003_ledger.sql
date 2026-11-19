-- Temaj ERP — Faza 2 (prototip): libri kryesor me partia të dyfishta.
-- Statusi: PROVIZOR. Plani kontabël real pret OPEN-05; llogaritë e ngarkuara nga seed-i janë TESTUESE.
-- Rregullat e mëposhtme zbatohen në databazë, jo vetëm në kod:
--   * regjistrimi postohet vetëm nëse debi = kredi dhe ka së paku 2 rreshta
--   * regjistrimi i postuar dhe rreshtat e tij nuk ndryshohen dhe nuk fshihen; korrigjimi bëhet me kthim (storno)
--   * në periudhë të mbyllur nuk postohet; periudha e mbyllur nuk rihapet
--   * numrat e regjistrimeve janë pa boshllëqe për çdo subjekt ligjor

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE account_type AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

CREATE TABLE ledger_account (
  id              BIGSERIAL PRIMARY KEY,
  legal_entity_id BIGINT NOT NULL REFERENCES legal_entity(id),
  code            TEXT NOT NULL CHECK (code ~ '^[A-Z0-9.-]{1,20}$'),
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type            account_type NOT NULL,
  is_postable     BOOLEAN NOT NULL DEFAULT TRUE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_provisional  BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE deri në miratimin e planit kontabël (OPEN-05)
  UNIQUE (legal_entity_id, code)
);

CREATE TYPE period_status AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE fiscal_period (
  id              BIGSERIAL PRIMARY KEY,
  legal_entity_id BIGINT NOT NULL REFERENCES legal_entity(id),
  name            TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          period_status NOT NULL DEFAULT 'OPEN',
  closed_at       TIMESTAMPTZ,
  closed_by       BIGINT REFERENCES app_user(id),
  CHECK (end_date >= start_date),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  -- Periudhat e të njëjtit subjekt nuk mbivendosen.
  EXCLUDE USING gist (legal_entity_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TYPE entry_status AS ENUM ('DRAFT', 'POSTED');

CREATE TABLE journal_entry (
  id                BIGSERIAL PRIMARY KEY,
  legal_entity_id   BIGINT NOT NULL REFERENCES legal_entity(id),
  entry_no          BIGINT,
  entry_date        DATE NOT NULL,
  period_id         BIGINT REFERENCES fiscal_period(id),
  description       TEXT NOT NULL CHECK (length(trim(description)) > 0),
  source_type       TEXT NOT NULL DEFAULT 'MANUAL',
  source_ref        TEXT,
  status            entry_status NOT NULL DEFAULT 'DRAFT',
  created_by        BIGINT NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by         BIGINT REFERENCES app_user(id),
  posted_at         TIMESTAMPTZ,
  reverses_entry_id BIGINT UNIQUE REFERENCES journal_entry(id),   -- një regjistrim kthehet vetëm një herë
  idempotency_key   TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key),
  UNIQUE (legal_entity_id, entry_no),
  CHECK ((status = 'POSTED') = (entry_no IS NOT NULL AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND period_id IS NOT NULL))
);
CREATE INDEX journal_entry_date_idx ON journal_entry(legal_entity_id, entry_date) WHERE status = 'POSTED';

CREATE TABLE journal_entry_counter (
  legal_entity_id BIGINT PRIMARY KEY REFERENCES legal_entity(id),
  last_no         BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE journal_line (
  id          BIGSERIAL PRIMARY KEY,
  entry_id    BIGINT NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL CHECK (line_no > 0),
  account_id  BIGINT NOT NULL REFERENCES ledger_account(id),
  branch_id   BIGINT REFERENCES branch(id),     -- dimension analitik; NULL = niveli i kompanisë
  debit       NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT,
  UNIQUE (entry_id, line_no),
  -- Çdo rresht është ose debi ose kredi, kurrë të dyja dhe kurrë zero.
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX journal_line_account_idx ON journal_line(account_id);

-- ---------------------------------------------------------------------------
-- Rreshtat: të ndryshueshëm vetëm sa kohë regjistrimi është DRAFT
-- ---------------------------------------------------------------------------
CREATE FUNCTION journal_line_guard() RETURNS trigger AS $$
DECLARE st entry_status; eid BIGINT;
BEGIN
  eid := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  -- FOR SHARE: pret postimin që mund të jetë në vazhdim dhe sheh statusin e ri.
  SELECT status INTO st FROM journal_entry WHERE id = eid FOR SHARE;
  IF st = 'POSTED' THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.entry_id <> OLD.entry_id THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION journal_line_guard();

-- ---------------------------------------------------------------------------
-- Regjistrimi: postimi kontrollohet këtu; pas postimit është i pandryshueshëm
-- ---------------------------------------------------------------------------
CREATE FUNCTION journal_entry_guard() RETURNS trigger AS $$
DECLARE n INTEGER; d NUMERIC; c NUMERIC; p RECORD; orig entry_status;
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.legal_entity_id <> OLD.legal_entity_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'POSTED' THEN
    -- Numri dhe të dhënat e postimit nuk vendosen me dorë në draft.
    NEW.entry_no := NULL; NEW.posted_at := NULL; NEW.posted_by := NULL; NEW.period_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.posted_by IS NULL THEN
    RAISE EXCEPTION 'POSTED_BY_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*), COALESCE(sum(debit), 0), COALESCE(sum(credit), 0) INTO n, d, c FROM journal_line WHERE entry_id = NEW.id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'UNBALANCED_ENTRY' USING ERRCODE = 'check_violation';
  END IF;

  -- Kyçja e periudhës e serializon postimin me mbylljen e saj.
  SELECT id, status INTO p FROM fiscal_period
   WHERE legal_entity_id = NEW.legal_entity_id AND NEW.entry_date BETWEEN start_date AND end_date FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_FISCAL_PERIOD' USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'CLOSED' THEN
    RAISE EXCEPTION 'PERIOD_CLOSED' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_line l JOIN ledger_account a ON a.id = l.account_id
              WHERE l.entry_id = NEW.id AND (NOT a.is_active OR NOT a.is_postable OR a.legal_entity_id <> NEW.legal_entity_id)) THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_line l JOIN branch b ON b.id = l.branch_id
              WHERE l.entry_id = NEW.id AND b.legal_entity_id <> NEW.legal_entity_id) THEN
    RAISE EXCEPTION 'INVALID_BRANCH' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT status INTO orig FROM journal_entry WHERE id = NEW.reverses_entry_id;
    IF orig IS DISTINCT FROM 'POSTED' THEN
      RAISE EXCEPTION 'REVERSAL_TARGET_NOT_POSTED' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Numër pa boshllëqe: rreshti i numëruesit kyçet deri në fund të transaksionit.
  INSERT INTO journal_entry_counter(legal_entity_id, last_no) VALUES (NEW.legal_entity_id, 1)
    ON CONFLICT (legal_entity_id) DO UPDATE SET last_no = journal_entry_counter.last_no + 1
    RETURNING last_no INTO NEW.entry_no;
  NEW.period_id := p.id;
  NEW.posted_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_guard_trg
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();

-- Regjistrimi krijohet gjithmonë si DRAFT; postimi kalon vetëm përmes kontrollit më lart.
CREATE FUNCTION journal_entry_insert_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'ENTRY_MUST_START_AS_DRAFT' USING ERRCODE = 'check_violation';
  END IF;
  NEW.entry_no := NULL; NEW.posted_at := NULL; NEW.posted_by := NULL; NEW.period_id := NULL;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_insert_guard_trg
  BEFORE INSERT ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION journal_entry_insert_guard();

CREATE FUNCTION ledger_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'JOURNAL_ENTRY_IMMUTABLE' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_no_truncate BEFORE TRUNCATE ON journal_entry FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();
CREATE TRIGGER journal_line_no_truncate BEFORE TRUNCATE ON journal_line FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate();

-- Numëruesi nuk kthehet mbrapsht.
CREATE FUNCTION journal_counter_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.last_no <> OLD.last_no + 1 THEN
    RAISE EXCEPTION 'ENTRY_COUNTER_PROTECTED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER journal_counter_guard_trg
  BEFORE UPDATE OR DELETE ON journal_entry_counter
  FOR EACH ROW EXECUTE FUNCTION journal_counter_guard();

-- ---------------------------------------------------------------------------
-- Periudhat: mbyllja është e pakthyeshme në këtë nivel
-- (rihapja kërkon një proces të kontrolluar që pret politikën e miratuar kontabël)
-- ---------------------------------------------------------------------------
CREATE FUNCTION fiscal_period_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'CLOSED' THEN RAISE EXCEPTION 'PERIOD_CLOSED' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'PERIOD_CLOSED' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date OR NEW.legal_entity_id <> OLD.legal_entity_id THEN
    IF EXISTS (SELECT 1 FROM journal_entry WHERE period_id = OLD.id) THEN
      RAISE EXCEPTION 'PERIOD_HAS_ENTRIES' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'CLOSED' THEN
    IF NEW.closed_by IS NULL THEN RAISE EXCEPTION 'CLOSED_BY_REQUIRED' USING ERRCODE = 'check_violation'; END IF;
    -- Draftet e mbetura nuk do të mund të postoheshin kurrë: duhen postuar ose fshirë para mbylljes.
    IF EXISTS (SELECT 1 FROM journal_entry WHERE legal_entity_id = OLD.legal_entity_id AND status = 'DRAFT'
                AND entry_date BETWEEN OLD.start_date AND OLD.end_date) THEN
      RAISE EXCEPTION 'PERIOD_HAS_DRAFTS' USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER fiscal_period_guard_trg
  BEFORE UPDATE OR DELETE ON fiscal_period
  FOR EACH ROW EXECUTE FUNCTION fiscal_period_guard();
