-- Temaj ERP — Detyrimet ndaj furnitorëve dhe pagesat e tyre (PROVIZOR).
-- Fatura e furnitorit që përputhet krijon detyrim; pagesa bëhet vetëm pas aprovimit nga një person tjetër.
-- PROVIZOR: blerja regjistrohet në një llogari kalimtare ("Blerje mallrash"), jo si vlerë stoku — vlerësimi i stokut pret OPEN-03.
-- TVSH-ja e blerjeve dhe detyrimet doganore nuk llogariten.

ALTER TABLE account_role DROP CONSTRAINT account_role_role_check;
ALTER TABLE account_role ADD CONSTRAINT account_role_role_check
  CHECK (role IN ('RECEIVABLE', 'SALES_REVENUE', 'VAT_OUTPUT', 'CASH', 'BANK', 'CUSTOMER_ADVANCES', 'CASH_IN_TRANSIT', 'CASH_SHORTAGE', 'CASH_SURPLUS',
                  'PAYABLE', 'PURCHASES_CLEARING'));

ALTER TABLE supplier_invoice ADD COLUMN total NUMERIC(19,2) CHECK (total >= 0);
ALTER TABLE supplier_invoice ADD COLUMN journal_entry_id BIGINT REFERENCES journal_entry(id);
-- Vetëm fatura që përputhet krijon detyrim në libër.
ALTER TABLE supplier_invoice ADD CONSTRAINT supplier_invoice_posted_iff_matched CHECK ((status = 'MATCHED') = (journal_entry_id IS NOT NULL));

CREATE TABLE supplier_payment (
  id                  BIGSERIAL PRIMARY KEY,
  legal_entity_id     BIGINT NOT NULL REFERENCES legal_entity(id),
  supplier_id         BIGINT NOT NULL REFERENCES supplier(id),
  branch_id           BIGINT NOT NULL REFERENCES branch(id),
  amount              NUMERIC(19,2) NOT NULL CHECK (amount > 0),
  paid_on             DATE NOT NULL,
  reference           TEXT,
  journal_entry_id    BIGINT NOT NULL REFERENCES journal_entry(id),
  approval_request_id BIGINT NOT NULL UNIQUE REFERENCES approval_request(id),   -- pa aprovim nuk ka pagesë
  requested_by        BIGINT NOT NULL REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supplier_payment_allocation (
  payment_id BIGINT NOT NULL REFERENCES supplier_payment(id),
  invoice_id BIGINT NOT NULL REFERENCES supplier_invoice(id),
  amount     NUMERIC(19,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, invoice_id)
);

CREATE VIEW supplier_open_invoice AS
  SELECT i.id AS invoice_id, i.supplier_id, i.po_id, i.invoice_no, i.invoice_date, i.total,
         i.total - COALESCE((SELECT sum(a.amount) FROM supplier_payment_allocation a WHERE a.invoice_id = i.id), 0) AS open_amount
    FROM supplier_invoice i WHERE i.status = 'MATCHED';

-- Një faturë furnitori nuk paguhet më shumë se vlera e saj; pagesa shpërndahet e gjitha, as më shumë as më pak.
CREATE FUNCTION supplier_allocation_guard() RETURNS trigger AS $$
DECLARE inv_total NUMERIC; inv_paid NUMERIC; pay_amount NUMERIC; pay_used NUMERIC; inv_sup BIGINT; pay_sup BIGINT; st TEXT;
BEGIN
  SELECT total, supplier_id, status INTO inv_total, inv_sup, st FROM supplier_invoice WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT amount, supplier_id INTO pay_amount, pay_sup FROM supplier_payment WHERE id = NEW.payment_id FOR UPDATE;
  IF st <> 'MATCHED' OR inv_sup <> pay_sup THEN RAISE EXCEPTION 'SUPPLIER_ALLOCATION_INVALID' USING ERRCODE = 'check_violation'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO inv_paid FROM supplier_payment_allocation WHERE invoice_id = NEW.invoice_id;
  SELECT COALESCE(sum(amount), 0) INTO pay_used FROM supplier_payment_allocation WHERE payment_id = NEW.payment_id;
  IF inv_paid + NEW.amount > inv_total OR pay_used + NEW.amount > pay_amount THEN
    RAISE EXCEPTION 'OVER_ALLOCATION' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_allocation_guard_trg BEFORE INSERT ON supplier_payment_allocation FOR EACH ROW EXECUTE FUNCTION supplier_allocation_guard();

CREATE TRIGGER supplier_payment_immutable BEFORE UPDATE OR DELETE ON supplier_payment FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();
CREATE TRIGGER supplier_payment_allocation_immutable BEFORE UPDATE OR DELETE ON supplier_payment_allocation FOR EACH ROW EXECUTE FUNCTION financial_document_immutable();
