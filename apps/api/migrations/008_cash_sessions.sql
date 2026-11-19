-- Temaj ERP — Arka ditore (PROVIZOR): hapja dhe mbyllja e arkës me numërim, mungesa/teprica me aprovim.
-- Rregulla të zbatuara nga databaza:
--   * arkëtimi me para në dorë pranohet vetëm kur arka e degës është e hapur
--   * një arkë ka vetëm një seancë të hapur; seanca e mbyllur nuk ndryshohet
--   * shuma e pritur llogaritet nga sistemi, jo nga arkëtari
-- Regjistrimet kontabël të mungesës/tepricës dhe të dorëzimit në bankë përdorin llogari PROVIZORE.

ALTER TABLE account_role DROP CONSTRAINT account_role_role_check;
ALTER TABLE account_role ADD CONSTRAINT account_role_role_check
  CHECK (role IN ('RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'CASH', 'BANK', 'CUSTOMER_ADVANCES', 'CASH_IN_TRANSIT', 'CASH_SHORTAGE', 'CASH_SURPLUS'));

CREATE TABLE cash_register (
  id        BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  code      TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,30}$'),
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
-- Një arkë aktive për degë në këtë fazë (arkëtimi e gjen arkën nga dega).
CREATE UNIQUE INDEX cash_register_one_per_branch ON cash_register(branch_id) WHERE is_active;

CREATE TABLE cash_session (
  id                  BIGSERIAL PRIMARY KEY,
  register_id         BIGINT NOT NULL REFERENCES cash_register(id),
  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PENDING_CLOSE', 'CLOSED')),
  opened_by           BIGINT NOT NULL REFERENCES app_user(id),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float       NUMERIC(19,2) NOT NULL CHECK (opening_float >= 0),   -- paratë e mbetura nga mbyllja e fundit
  counted             NUMERIC(19,2) CHECK (counted >= 0),                  -- paratë e numëruara në mbyllje
  expected            NUMERIC(19,2),                                      -- e llogarit sistemi
  bank_deposit        NUMERIC(19,2) CHECK (bank_deposit >= 0),             -- paratë e nxjerra për dorëzim në bankë
  close_reason        TEXT,
  approval_request_id BIGINT REFERENCES approval_request(id),
  closed_by           BIGINT REFERENCES app_user(id),
  closed_at           TIMESTAMPTZ,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK (status = 'OPEN' OR (counted IS NOT NULL AND expected IS NOT NULL AND bank_deposit IS NOT NULL AND closed_by IS NOT NULL)),
  CHECK (bank_deposit IS NULL OR bank_deposit <= counted)
);
CREATE UNIQUE INDEX cash_session_one_open ON cash_session(register_id) WHERE status <> 'CLOSED';

ALTER TABLE customer_payment ADD COLUMN cash_session_id BIGINT REFERENCES cash_session(id);
ALTER TABLE customer_payment ADD CONSTRAINT customer_payment_cash_needs_session CHECK ((method = 'CASH') = (cash_session_id IS NOT NULL));

-- Arkëtimi me para në dorë lidhet vetëm me një seancë të hapur të së njëjtës degë.
CREATE FUNCTION customer_payment_session_guard() RETURNS trigger AS $$
DECLARE st TEXT; br BIGINT;
BEGIN
  IF NEW.cash_session_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.status, r.branch_id INTO st, br FROM cash_session s JOIN cash_register r ON r.id = s.register_id WHERE s.id = NEW.cash_session_id FOR SHARE OF s;
  IF st IS DISTINCT FROM 'OPEN' OR br <> NEW.branch_id THEN
    RAISE EXCEPTION 'CASH_SESSION_NOT_OPEN' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER customer_payment_session_guard_trg BEFORE INSERT ON customer_payment FOR EACH ROW EXECUTE FUNCTION customer_payment_session_guard();

CREATE FUNCTION cash_session_expected(sid BIGINT) RETURNS NUMERIC AS $$
  SELECT s.opening_float + COALESCE((SELECT sum(p.amount) FROM customer_payment p WHERE p.cash_session_id = s.id), 0)
    FROM cash_session s WHERE s.id = sid
$$ LANGUAGE sql VOLATILE;

CREATE FUNCTION cash_session_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'CASH_SESSION_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.register_id, NEW.opened_by, NEW.opened_at, NEW.opening_float) IS DISTINCT FROM (OLD.register_id, OLD.opened_by, OLD.opened_at, OLD.opening_float) THEN
    RAISE EXCEPTION 'CASH_SESSION_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'OPEN' THEN
    -- Shumën e pritur e vendos gjithmonë sistemi; kyçja e seancës i ndalon arkëtimet e reja gjatë llogaritjes.
    NEW.expected := cash_session_expected(OLD.id);
  END IF;
  IF NEW.status = 'CLOSED' THEN NEW.closed_at := now(); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER cash_session_guard_trg BEFORE UPDATE OR DELETE ON cash_session FOR EACH ROW EXECUTE FUNCTION cash_session_guard();
