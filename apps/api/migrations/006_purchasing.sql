-- Temaj ERP — Blerjet (prototip): furnitorët, porositë e blerjes, pranimet e mallit, faturat e furnitorit
-- me përputhje tripalëshe (porosi / pranim / faturë).
-- Statusi: PROVIZOR. NUK përfshin: pagesat e furnitorëve, kostot e importit (landed cost), valutat e huaja,
-- TVSH-në dhe regjistrimet kontabël — presin OPEN-03/06/08, DEC-G50-15 dhe kontabilistin.
-- Tolerancat e përputhjes janë zero derisa të miratohen.

CREATE TABLE supplier (
  id         BIGSERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,30}$'),
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  country    TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Llogaritë bankare të furnitorëve nuk ruhen ende: ndryshimi i tyre kërkon verifikim të pavarur (DEC-G52-13).
);

CREATE TABLE purchase_order (
  id                  BIGSERIAL PRIMARY KEY,
  branch_id           BIGINT NOT NULL REFERENCES branch(id),
  warehouse_id        BIGINT NOT NULL REFERENCES warehouse(id),
  supplier_id         BIGINT NOT NULL REFERENCES supplier(id),
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  currency            TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),   -- valutat e huaja presin politikën e kursit
  note                TEXT,
  approval_request_id BIGINT REFERENCES approval_request(id),
  created_by          BIGINT NOT NULL REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  idempotency_key     TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key)
);

CREATE TABLE purchase_order_line (
  po_id        BIGINT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL CHECK (line_no > 0),
  product_id   BIGINT NOT NULL REFERENCES product(id),
  qty          NUMERIC(19,4) NOT NULL CHECK (qty > 0),
  unit_cost    NUMERIC(19,4) NOT NULL CHECK (unit_cost >= 0),
  qty_received NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_invoiced NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (qty_invoiced >= 0),
  PRIMARY KEY (po_id, line_no),
  CHECK (qty_received <= qty),            -- nuk pranohet më shumë se sa është porositur
  CHECK (qty_invoiced <= qty_received)    -- nuk faturohet (për pagesë) më shumë se sa është pranuar
);

CREATE FUNCTION purchase_order_line_guard() RETURNS trigger AS $$
DECLARE st TEXT; pid BIGINT;
BEGIN
  pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.po_id ELSE NEW.po_id END;
  SELECT status INTO st FROM purchase_order WHERE id = pid FOR SHARE;
  IF st IS NULL OR st = 'DRAFT' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.qty_received >= OLD.qty_received AND NEW.qty_invoiced >= OLD.qty_invoiced
     AND (NEW.po_id, NEW.line_no, NEW.product_id, NEW.qty, NEW.unit_cost) IS NOT DISTINCT FROM (OLD.po_id, OLD.line_no, OLD.product_id, OLD.qty, OLD.unit_cost) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PURCHASE_ORDER_LOCKED' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_order_line_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_line
  FOR EACH ROW EXECUTE FUNCTION purchase_order_line_guard();

CREATE FUNCTION purchase_order_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'PURCHASE_ORDER_LOCKED' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('RECEIVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.branch_id, NEW.warehouse_id, NEW.supplier_id, NEW.currency)
       IS DISTINCT FROM (OLD.branch_id, OLD.warehouse_id, OLD.supplier_id, OLD.currency) THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_order_guard_trg BEFORE UPDATE OR DELETE ON purchase_order FOR EACH ROW EXECUTE FUNCTION purchase_order_guard();

CREATE TABLE goods_receipt (
  id              BIGSERIAL PRIMARY KEY,
  po_id           BIGINT NOT NULL REFERENCES purchase_order(id),
  document_ref    TEXT NOT NULL CHECK (length(trim(document_ref)) > 0),
  received_by     BIGINT NOT NULL REFERENCES app_user(id),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (received_by, idempotency_key)
);

CREATE TABLE goods_receipt_line (
  receipt_id  BIGINT NOT NULL REFERENCES goods_receipt(id),
  po_line_no  INTEGER NOT NULL,
  lot_id      BIGINT REFERENCES stock_lot(id),
  qty         NUMERIC(19,4) NOT NULL CHECK (qty > 0),
  movement_id BIGINT NOT NULL REFERENCES stock_movement(id),
  PRIMARY KEY (receipt_id, po_line_no, movement_id)
);

CREATE TABLE supplier_invoice (
  id            BIGSERIAL PRIMARY KEY,
  po_id         BIGINT NOT NULL REFERENCES purchase_order(id),
  supplier_id   BIGINT NOT NULL REFERENCES supplier(id),
  invoice_no    TEXT NOT NULL CHECK (length(trim(invoice_no)) > 0),
  invoice_date  DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('MATCHED', 'DISCREPANCY')),
  discrepancies JSONB NOT NULL DEFAULT '[]'::jsonb,
  entered_by    BIGINT NOT NULL REFERENCES app_user(id),
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, invoice_no),      -- e njëjta faturë e furnitorit nuk regjistrohet dy herë
  CHECK ((status = 'MATCHED') = (discrepancies = '[]'::jsonb))
);

CREATE TABLE supplier_invoice_line (
  invoice_id BIGINT NOT NULL REFERENCES supplier_invoice(id),
  po_line_no INTEGER NOT NULL,
  qty        NUMERIC(19,4) NOT NULL CHECK (qty > 0),
  unit_cost  NUMERIC(19,4) NOT NULL CHECK (unit_cost >= 0),
  PRIMARY KEY (invoice_id, po_line_no)
);

CREATE FUNCTION purchasing_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PURCHASE_DOCUMENT_IMMUTABLE' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER goods_receipt_immutable BEFORE UPDATE OR DELETE ON goods_receipt FOR EACH ROW EXECUTE FUNCTION purchasing_append_only();
CREATE TRIGGER goods_receipt_line_immutable BEFORE UPDATE OR DELETE ON goods_receipt_line FOR EACH ROW EXECUTE FUNCTION purchasing_append_only();
CREATE TRIGGER supplier_invoice_immutable BEFORE UPDATE OR DELETE ON supplier_invoice FOR EACH ROW EXECUTE FUNCTION purchasing_append_only();
CREATE TRIGGER supplier_invoice_line_immutable BEFORE UPDATE OR DELETE ON supplier_invoice_line FOR EACH ROW EXECUTE FUNCTION purchasing_append_only();
