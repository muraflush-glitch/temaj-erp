-- Temaj ERP — Kthimet dhe notat e kreditit (PROVIZOR).
-- Fatura nuk ndryshohet kurrë: korrigjimi bëhet me notë krediti të lidhur me të, pas aprovimit nga një person tjetër.
-- Rregulla të zbatuara nga databaza: nuk kreditohet më shumë se sasia e faturuar; nota është e pandryshueshme; numra pa boshllëqe.
-- NUK përfshin: kthimin e parave klientit (kredia mbetet në llogarinë e klientit), karantinën e mallit të dëmtuar, fiskalizimin.

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'CUSTOMER_RETURN';

CREATE OR REPLACE FUNCTION stock_movement_apply() RETURNS trigger AS $$
DECLARE p product; step NUMERIC; lot_product BIGINT;
BEGIN
  SELECT * INTO p FROM product WHERE id = NEW.product_id;
  IF NOT p.is_active AND NEW.type::text IN ('RECEIPT', 'ADJUSTMENT_IN') THEN
    RAISE EXCEPTION 'PRODUCT_INACTIVE' USING ERRCODE = 'check_violation';
  END IF;
  IF p.tracks_lot AND NEW.lot_id IS NULL THEN RAISE EXCEPTION 'LOT_REQUIRED' USING ERRCODE = 'check_violation'; END IF;
  IF NOT p.tracks_lot AND NEW.lot_id IS NOT NULL THEN RAISE EXCEPTION 'LOT_NOT_ALLOWED' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT product_id INTO lot_product FROM stock_lot WHERE id = NEW.lot_id;
    IF lot_product <> NEW.product_id THEN RAISE EXCEPTION 'LOT_PRODUCT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  step := product_qty_step(p);
  IF step IS NOT NULL AND mod(NEW.qty, step) <> 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY_STEP' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.type::text IN ('RECEIPT', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'CUSTOMER_RETURN') THEN
    INSERT INTO stock_balance(warehouse_id, product_id, lot_id, on_hand) VALUES (NEW.warehouse_id, NEW.product_id, NEW.lot_id, NEW.qty)
      ON CONFLICT (warehouse_id, product_id, COALESCE(lot_id, 0)) DO UPDATE SET on_hand = stock_balance.on_hand + EXCLUDED.on_hand;
  ELSE
    UPDATE stock_balance SET on_hand = on_hand - NEW.qty
     WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id AND COALESCE(lot_id, 0) = COALESCE(NEW.lot_id, 0)
       AND on_hand - reserved >= NEW.qty;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM stock_balance WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id
                    AND COALESCE(lot_id, 0) = COALESCE(NEW.lot_id, 0) AND on_hand >= NEW.qty) THEN
        RAISE EXCEPTION 'STOCK_RESERVED' USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TABLE credit_note (
  id                  BIGSERIAL PRIMARY KEY,
  legal_entity_id     BIGINT NOT NULL REFERENCES legal_entity(id),
  fiscal_year         INTEGER NOT NULL,
  credit_no           BIGINT,
  invoice_id          BIGINT NOT NULL REFERENCES sales_invoice(id),
  customer_id         BIGINT NOT NULL REFERENCES customer(id),
  branch_id           BIGINT NOT NULL REFERENCES branch(id),
  credit_date         DATE NOT NULL,
  reason              TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  restocked           BOOLEAN NOT NULL,
  net                 NUMERIC(19,2) NOT NULL CHECK (net >= 0),
  vat                 NUMERIC(19,2) NOT NULL CHECK (vat >= 0),
  gross               NUMERIC(19,2) NOT NULL CHECK (gross > 0),
  journal_entry_id    BIGINT NOT NULL REFERENCES journal_entry(id),
  approval_request_id BIGINT NOT NULL UNIQUE REFERENCES approval_request(id),   -- pa aprovim nuk ka notë krediti
  requested_by        BIGINT NOT NULL REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, fiscal_year, credit_no),
  CHECK (gross = net + vat)
);

CREATE TABLE credit_note_line (
  credit_note_id  BIGINT NOT NULL REFERENCES credit_note(id),
  invoice_id      BIGINT NOT NULL,
  invoice_line_no INTEGER NOT NULL,
  qty             NUMERIC(19,4) NOT NULL CHECK (qty > 0),
  net             NUMERIC(19,2) NOT NULL,
  vat             NUMERIC(19,2) NOT NULL,
  PRIMARY KEY (credit_note_id, invoice_line_no),
  FOREIGN KEY (invoice_id, invoice_line_no) REFERENCES sales_invoice_line(invoice_id, line_no)
);

CREATE TABLE credit_note_counter (
  legal_entity_id BIGINT NOT NULL REFERENCES legal_entity(id),
  fiscal_year     INTEGER NOT NULL,
  last_no         BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (legal_entity_id, fiscal_year)
);

CREATE FUNCTION credit_note_number() RETURNS trigger AS $$
BEGIN
  NEW.fiscal_year := EXTRACT(YEAR FROM NEW.credit_date)::int;
  INSERT INTO credit_note_counter(legal_entity_id, fiscal_year, last_no) VALUES (NEW.legal_entity_id, NEW.fiscal_year, 1)
    ON CONFLICT (legal_entity_id, fiscal_year) DO UPDATE SET last_no = credit_note_counter.last_no + 1
    RETURNING last_no INTO NEW.credit_no;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER credit_note_number_trg BEFORE INSERT ON credit_note FOR EACH ROW EXECUTE FUNCTION credit_note_number();

-- Nuk kreditohet më shumë se sasia e faturuar në atë rresht (duke llogaritur notat e mëparshme).
CREATE FUNCTION credit_note_line_guard() RETURNS trigger AS $$
DECLARE invoiced NUMERIC; credited NUMERIC;
BEGIN
  PERFORM 1 FROM sales_invoice WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT qty INTO invoiced FROM sales_invoice_line WHERE invoice_id = NEW.invoice_id AND line_no = NEW.invoice_line_no;
  SELECT COALESCE(sum(qty), 0) INTO credited FROM credit_note_line WHERE invoice_id = NEW.invoice_id AND invoice_line_no = NEW.invoice_line_no;
  IF credited + NEW.qty > invoiced THEN
    RAISE EXCEPTION 'OVER_CREDIT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER credit_note_line_guard_trg BEFORE INSERT ON credit_note_line FOR EACH ROW EXECUTE FUNCTION credit_note_line_guard();

CREATE TRIGGER credit_note_immutable BEFORE UPDATE OR DELETE ON credit_note FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();
CREATE TRIGGER credit_note_line_immutable BEFORE UPDATE OR DELETE ON credit_note_line FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();

-- Borxhi i hapur i faturës tani zbret edhe notat e kreditit. Vlera negative = kompania i detyrohet klientit.
CREATE OR REPLACE VIEW customer_open_invoice AS
  SELECT i.id AS invoice_id, i.customer_id, i.branch_id, i.fiscal_year, i.invoice_no, i.invoice_date, i.due_date, i.gross,
         i.gross - COALESCE((SELECT sum(a.amount) FROM payment_allocation a WHERE a.invoice_id = i.id), 0)
                 - COALESCE((SELECT sum(c.gross) FROM credit_note c WHERE c.invoice_id = i.id), 0) AS open_amount
    FROM sales_invoice i;
