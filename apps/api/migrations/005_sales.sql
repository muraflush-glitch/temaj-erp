-- Temaj ERP — Faza 3 (prototip): klientët, çmimet, ofertat/porositë, rezervimi i stokut, dorëzimet.
-- Statusi: PROVIZOR. Çmimet janë NETO; TVSH-ja, faturat, fiskalizimi dhe regjistrimet kontabël
-- NUK janë pjesë e këtij migrimi (presin OPEN-06, OPEN-09, OPEN-23 dhe kontabilistin).
-- Rregulla të zbatuara nga databaza:
--   * nuk rezervohet më shumë se stoku i lirë; malli i rezervuar nuk del për dikë tjetër
--   * porosia e konfirmuar nuk ndryshohet; dorëzimi nuk e kalon sasinë e porositur

ALTER TABLE stock_balance ADD COLUMN reserved NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (reserved >= 0);
ALTER TABLE stock_balance ADD CONSTRAINT stock_balance_reserved_le_on_hand CHECK (reserved <= on_hand);

-- Daljet respektojnë rezervimet: del vetëm stoku i lirë (on_hand - reserved).
CREATE OR REPLACE FUNCTION stock_movement_apply() RETURNS trigger AS $$
DECLARE p product; step NUMERIC; lot_product BIGINT;
BEGIN
  SELECT * INTO p FROM product WHERE id = NEW.product_id;
  IF NOT p.is_active AND NEW.type IN ('RECEIPT', 'ADJUSTMENT_IN') THEN
    RAISE EXCEPTION 'PRODUCT_INACTIVE' USING ERRCODE = 'check_violation';
  END IF;
  IF p.tracks_lot AND NEW.lot_id IS NULL THEN
    RAISE EXCEPTION 'LOT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p.tracks_lot AND NEW.lot_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOT_NOT_ALLOWED' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT product_id INTO lot_product FROM stock_lot WHERE id = NEW.lot_id;
    IF lot_product <> NEW.product_id THEN
      RAISE EXCEPTION 'LOT_PRODUCT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  step := product_qty_step(p);
  IF step IS NOT NULL AND mod(NEW.qty, step) <> 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY_STEP' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.type IN ('RECEIPT', 'ADJUSTMENT_IN', 'TRANSFER_IN') THEN
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

CREATE TABLE customer (
  id                BIGSERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,30}$'),
  name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind              TEXT NOT NULL CHECK (kind IN ('PERSON', 'COMPANY')),
  phone             TEXT,
  email             CITEXT,
  -- Ruhen si të dhëna; zbatimi i limitit kërkon modulin e arkëtimeve/borxheve (i varur nga kontabiliteti).
  credit_limit      NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_term_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        BIGINT NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Çmimi NETO për njësinë bazë të produktit, me datë efektive. Historiku nuk mbishkruhet.
CREATE TABLE product_price (
  product_id BIGINT NOT NULL REFERENCES product(id),
  valid_from DATE NOT NULL,
  unit_price NUMERIC(19,4) NOT NULL CHECK (unit_price >= 0),
  set_by     BIGINT NOT NULL REFERENCES app_user(id),
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, valid_from)
);

-- Zbritja maksimale që një rol mund ta japë pa aprovim (DEC-G48-01). Vlerat vendosen nga drejtoria.
CREATE TABLE discount_limit (
  role_id BIGINT PRIMARY KEY REFERENCES role(id),
  max_pct NUMERIC(5,2) NOT NULL CHECK (max_pct BETWEEN 0 AND 100)
);

CREATE TABLE sales_order (
  id                  BIGSERIAL PRIMARY KEY,
  branch_id           BIGINT NOT NULL REFERENCES branch(id),
  warehouse_id        BIGINT NOT NULL REFERENCES warehouse(id),
  customer_id         BIGINT NOT NULL REFERENCES customer(id),
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED')),
  order_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  note                TEXT,
  approval_request_id BIGINT REFERENCES approval_request(id),
  created_by          BIGINT NOT NULL REFERENCES app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ,
  idempotency_key     TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key)
);

CREATE TABLE sales_order_line (
  order_id      BIGINT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL CHECK (line_no > 0),
  product_id    BIGINT NOT NULL REFERENCES product(id),
  lot_id        BIGINT REFERENCES stock_lot(id),
  qty           NUMERIC(19,4) NOT NULL CHECK (qty > 0),
  list_price    NUMERIC(19,4) NOT NULL CHECK (list_price >= 0),   -- çmimi i listës në ditën e porosisë
  unit_price    NUMERIC(19,4) NOT NULL CHECK (unit_price >= 0),   -- çmimi i aplikuar (ndryshe nga lista = përjashtim)
  discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  qty_delivered NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (qty_delivered >= 0),
  PRIMARY KEY (order_id, line_no),
  CHECK (qty_delivered <= qty)       -- dorëzimi nuk e kalon kurrë sasinë e porositur
);

-- Vlera neto e rreshtit. Politika e rrumbullakimit pret miratim; këtu ruhen 4 shifra.
CREATE FUNCTION sales_line_net(l sales_order_line) RETURNS NUMERIC AS $$
  SELECT round(l.qty * l.unit_price * (100 - l.discount_pct) / 100, 4)
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION sales_order_line_guard() RETURNS trigger AS $$
DECLARE st TEXT; oid BIGINT;
BEGIN
  oid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT status INTO st FROM sales_order WHERE id = oid FOR SHARE;
  IF st IS NULL OR st = 'DRAFT' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Pas draftit lejohet vetëm rritja e sasisë së dorëzuar.
  IF TG_OP = 'UPDATE' AND NEW.qty_delivered >= OLD.qty_delivered
     AND (NEW.order_id, NEW.line_no, NEW.product_id, NEW.lot_id, NEW.qty, NEW.list_price, NEW.unit_price, NEW.discount_pct)
         IS NOT DISTINCT FROM (OLD.order_id, OLD.line_no, OLD.product_id, OLD.lot_id, OLD.qty, OLD.list_price, OLD.unit_price, OLD.discount_pct) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SALES_ORDER_LOCKED' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER sales_order_line_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON sales_order_line
  FOR EACH ROW EXECUTE FUNCTION sales_order_line_guard();

CREATE FUNCTION sales_order_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'SALES_ORDER_LOCKED' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'SALES_ORDER_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.branch_id, NEW.warehouse_id, NEW.customer_id, NEW.order_date)
       IS DISTINCT FROM (OLD.branch_id, OLD.warehouse_id, OLD.customer_id, OLD.order_date) THEN
    RAISE EXCEPTION 'SALES_ORDER_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER sales_order_guard_trg BEFORE UPDATE OR DELETE ON sales_order FOR EACH ROW EXECUTE FUNCTION sales_order_guard();

-- Rezervimi: një rresht për çdo rresht porosie; e mban stock_balance.reserved në hap.
CREATE TABLE stock_reservation (
  order_id     BIGINT NOT NULL,
  line_no      INTEGER NOT NULL,
  warehouse_id BIGINT NOT NULL REFERENCES warehouse(id),
  product_id   BIGINT NOT NULL REFERENCES product(id),
  lot_id       BIGINT REFERENCES stock_lot(id),
  qty          NUMERIC(19,4) NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (order_id, line_no),
  FOREIGN KEY (order_id, line_no) REFERENCES sales_order_line(order_id, line_no)
);

CREATE FUNCTION stock_reservation_apply() RETURNS trigger AS $$
DECLARE delta NUMERIC; r stock_reservation;
BEGIN
  IF TG_OP = 'INSERT' THEN delta := NEW.qty; r := NEW;
  ELSIF TG_OP = 'DELETE' THEN delta := -OLD.qty; r := OLD;
  ELSE
    IF (NEW.order_id, NEW.line_no, NEW.warehouse_id, NEW.product_id, NEW.lot_id)
       IS DISTINCT FROM (OLD.order_id, OLD.line_no, OLD.warehouse_id, OLD.product_id, OLD.lot_id) THEN
      RAISE EXCEPTION 'RESERVATION_KEY_IMMUTABLE' USING ERRCODE = 'check_violation';
    END IF;
    delta := NEW.qty - OLD.qty; r := NEW;
  END IF;
  IF delta > 0 THEN
    -- Kushti brenda UPDATE-it: dy porosi paralele nuk e rezervojnë dot të njëjtin mall.
    UPDATE stock_balance SET reserved = reserved + delta
     WHERE warehouse_id = r.warehouse_id AND product_id = r.product_id AND COALESCE(lot_id, 0) = COALESCE(r.lot_id, 0)
       AND on_hand - reserved >= delta;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_STOCK' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF delta < 0 THEN
    UPDATE stock_balance SET reserved = reserved + delta
     WHERE warehouse_id = r.warehouse_id AND product_id = r.product_id AND COALESCE(lot_id, 0) = COALESCE(r.lot_id, 0);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_reservation_apply_trg
  BEFORE INSERT OR UPDATE OR DELETE ON stock_reservation
  FOR EACH ROW EXECUTE FUNCTION stock_reservation_apply();
