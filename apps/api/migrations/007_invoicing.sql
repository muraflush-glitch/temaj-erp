-- Temaj ERP — Faturimi dhe arkëtimet (PROVIZOR).
-- Me kërkesë të pronarit, rregullat e mëposhtme janë vendosur si vlera fillestare PROVIZORE, për t'u korrigjuar më vonë:
--   * norma e TVSH-së, rrumbullakimi në 2 shifra, lidhja e llogarive kontabël
-- Çdo vlerë provizore është e shënuar (is_provisional) dhe sistemi refuzon të niset në Production sa kohë ekzistojnë të tilla.
-- Faturat këtu NUK janë dokumente fiskale: fiskalizimi pret OPEN-09.
-- Kostoja e mallit të shitur NUK regjistrohet: pret metodën e vlerësimit të stokut (OPEN-03/04).

CREATE TABLE policy_setting (
  key            TEXT PRIMARY KEY,
  value          JSONB NOT NULL,
  description    TEXT NOT NULL,
  is_provisional BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by    BIGINT REFERENCES app_user(id),
  approved_at    TIMESTAMPTZ,
  CHECK (is_provisional = (approved_at IS NULL))
);

-- Cila llogari luan cilin rol në regjistrimet automatike.
CREATE TABLE account_role (
  legal_entity_id BIGINT NOT NULL REFERENCES legal_entity(id),
  role            TEXT NOT NULL CHECK (role IN ('RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'CASH', 'BANK', 'CUSTOMER_ADVANCES')),
  account_id      BIGINT NOT NULL REFERENCES ledger_account(id),
  is_provisional  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (legal_entity_id, role)
);

-- Porosia: me pagesë në dorëzim (parazgjedhje) ose me kredi (kontrollohet limiti i klientit).
ALTER TABLE sales_order ADD COLUMN on_credit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_order_line ADD COLUMN qty_invoiced NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (qty_invoiced >= 0);
ALTER TABLE sales_order_line ADD CONSTRAINT sales_line_invoiced_le_delivered CHECK (qty_invoiced <= qty_delivered);  -- faturohet vetëm malli i dorëzuar

CREATE OR REPLACE FUNCTION sales_order_line_guard() RETURNS trigger AS $$
DECLARE st TEXT; oid BIGINT;
BEGIN
  oid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT status INTO st FROM sales_order WHERE id = oid FOR SHARE;
  IF st IS NULL OR st = 'DRAFT' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Pas draftit lejohet vetëm rritja e sasisë së dorëzuar dhe të faturuar.
  IF TG_OP = 'UPDATE' AND NEW.qty_delivered >= OLD.qty_delivered AND NEW.qty_invoiced >= OLD.qty_invoiced
     AND (NEW.order_id, NEW.line_no, NEW.product_id, NEW.lot_id, NEW.qty, NEW.list_price, NEW.unit_price, NEW.discount_pct)
         IS NOT DISTINCT FROM (OLD.order_id, OLD.line_no, OLD.product_id, OLD.lot_id, OLD.qty, OLD.list_price, OLD.unit_price, OLD.discount_pct) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SALES_ORDER_LOCKED' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TABLE sales_invoice (
  id                 BIGSERIAL PRIMARY KEY,
  legal_entity_id    BIGINT NOT NULL REFERENCES legal_entity(id),
  fiscal_year        INTEGER NOT NULL,
  invoice_no         BIGINT,                      -- pa boshllëqe për subjekt dhe vit; e cakton databaza
  order_id           BIGINT NOT NULL REFERENCES sales_order(id),
  customer_id        BIGINT NOT NULL REFERENCES customer(id),
  branch_id          BIGINT NOT NULL REFERENCES branch(id),
  invoice_date       DATE NOT NULL,
  due_date           DATE NOT NULL,
  vat_rate           NUMERIC(5,2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  net                NUMERIC(19,2) NOT NULL CHECK (net >= 0),
  vat                NUMERIC(19,2) NOT NULL CHECK (vat >= 0),
  gross              NUMERIC(19,2) NOT NULL,
  is_provisional_tax BOOLEAN NOT NULL,            -- TRUE = llogaritur me rregulla tatimore të pamiratuara
  is_fiscalized      BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT is_fiscalized),   -- fiskalizimi nuk ekziston ende
  journal_entry_id   BIGINT NOT NULL REFERENCES journal_entry(id),
  created_by         BIGINT NOT NULL REFERENCES app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key    TEXT NOT NULL,
  UNIQUE (legal_entity_id, fiscal_year, invoice_no),
  UNIQUE (created_by, idempotency_key),
  CHECK (gross = net + vat),
  CHECK (due_date >= invoice_date)
);

CREATE TABLE sales_invoice_line (
  invoice_id    BIGINT NOT NULL REFERENCES sales_invoice(id),
  line_no       INTEGER NOT NULL,
  order_line_no INTEGER NOT NULL,
  product_id    BIGINT NOT NULL REFERENCES product(id),
  qty           NUMERIC(19,4) NOT NULL CHECK (qty > 0),
  unit_price    NUMERIC(19,4) NOT NULL,
  discount_pct  NUMERIC(5,2) NOT NULL,
  net           NUMERIC(19,2) NOT NULL,
  vat           NUMERIC(19,2) NOT NULL,
  PRIMARY KEY (invoice_id, line_no)
);

CREATE TABLE sales_invoice_counter (
  legal_entity_id BIGINT NOT NULL REFERENCES legal_entity(id),
  fiscal_year     INTEGER NOT NULL,
  last_no         BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (legal_entity_id, fiscal_year)
);

CREATE FUNCTION sales_invoice_number() RETURNS trigger AS $$
BEGIN
  NEW.fiscal_year := EXTRACT(YEAR FROM NEW.invoice_date)::int;
  INSERT INTO sales_invoice_counter(legal_entity_id, fiscal_year, last_no) VALUES (NEW.legal_entity_id, NEW.fiscal_year, 1)
    ON CONFLICT (legal_entity_id, fiscal_year) DO UPDATE SET last_no = sales_invoice_counter.last_no + 1
    RETURNING last_no INTO NEW.invoice_no;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER sales_invoice_number_trg BEFORE INSERT ON sales_invoice FOR EACH ROW EXECUTE FUNCTION sales_invoice_number();

CREATE TABLE customer_payment (
  id               BIGSERIAL PRIMARY KEY,
  legal_entity_id  BIGINT NOT NULL REFERENCES legal_entity(id),
  customer_id      BIGINT NOT NULL REFERENCES customer(id),
  branch_id        BIGINT NOT NULL REFERENCES branch(id),
  method           TEXT NOT NULL CHECK (method IN ('CASH', 'BANK')),
  amount           NUMERIC(19,2) NOT NULL CHECK (amount > 0),
  received_on      DATE NOT NULL,
  reference        TEXT,
  journal_entry_id BIGINT NOT NULL REFERENCES journal_entry(id),
  received_by      BIGINT NOT NULL REFERENCES app_user(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key  TEXT NOT NULL,
  UNIQUE (received_by, idempotency_key)
);

CREATE TABLE payment_allocation (
  payment_id BIGINT NOT NULL REFERENCES customer_payment(id),
  invoice_id BIGINT NOT NULL REFERENCES sales_invoice(id),
  amount     NUMERIC(19,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, invoice_id)
);

-- Një faturë nuk paguhet më shumë se vlera e saj; një pagesë nuk shpërndahet më shumë se shuma e saj.
CREATE FUNCTION payment_allocation_guard() RETURNS trigger AS $$
DECLARE inv_gross NUMERIC; inv_paid NUMERIC; pay_amount NUMERIC; pay_used NUMERIC; inv_cust BIGINT; pay_cust BIGINT;
BEGIN
  SELECT gross, customer_id INTO inv_gross, inv_cust FROM sales_invoice WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT amount, customer_id INTO pay_amount, pay_cust FROM customer_payment WHERE id = NEW.payment_id FOR UPDATE;
  IF inv_cust <> pay_cust THEN RAISE EXCEPTION 'ALLOCATION_CUSTOMER_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO inv_paid FROM payment_allocation WHERE invoice_id = NEW.invoice_id;
  SELECT COALESCE(sum(amount), 0) INTO pay_used FROM payment_allocation WHERE payment_id = NEW.payment_id;
  IF inv_paid + NEW.amount > inv_gross OR pay_used + NEW.amount > pay_amount THEN
    RAISE EXCEPTION 'OVER_ALLOCATION' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocation_guard_trg BEFORE INSERT ON payment_allocation FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();

CREATE FUNCTION financial_document_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_DOCUMENT_IMMUTABLE' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER sales_invoice_immutable BEFORE UPDATE OR DELETE ON sales_invoice FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();
CREATE TRIGGER sales_invoice_line_immutable BEFORE UPDATE OR DELETE ON sales_invoice_line FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();
CREATE TRIGGER customer_payment_immutable BEFORE UPDATE OR DELETE ON customer_payment FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();
CREATE TRIGGER payment_allocation_immutable BEFORE UPDATE OR DELETE ON payment_allocation FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();

-- Sa i detyrohet klienti: faturat e hapura minus pagesat e shpërndara.
CREATE VIEW customer_open_invoice AS
  SELECT i.id AS invoice_id, i.customer_id, i.branch_id, i.fiscal_year, i.invoice_no, i.invoice_date, i.due_date, i.gross,
         i.gross - COALESCE((SELECT sum(a.amount) FROM payment_allocation a WHERE a.invoice_id = i.id), 0) AS open_amount
    FROM sales_invoice i;
