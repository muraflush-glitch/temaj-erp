-- Temaj ERP — Faza 4 (prototip): produktet, lotet dhe stoku fizik (vetëm SASI, pa vlerë).
-- Statusi: PROVIZOR. Vlerësimi i stokut pret OPEN-03; katalogu real pret OPEN-21; lokacionet OPEN-22.
-- Rregulla të zbatuara nga databaza:
--   * stoku fizik nuk bëhet kurrë negativ
--   * çdo lëvizje ka dokument dhe është e pandryshueshme; gjendja ndryshon VETËM përmes lëvizjeve
--   * sasia respekton paketimin (kuti të plota, përveç produkteve që lejojnë kuti të hapura)
--   * produktet me nuancë/kalibër kërkojnë lot në çdo lëvizje
--   * transferi: malli del nga dega dërguese, mbetet "në rrugë" dhe hyn vetëm kur e konfirmon dega pranuese

CREATE TYPE base_uom AS ENUM ('M2', 'PIECE');

CREATE TABLE product (
  id                BIGSERIAL PRIMARY KEY,
  sku               TEXT NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9._-]{2,40}$'),
  name              TEXT NOT NULL CHECK (length(trim(name)) > 0),
  base_uom          base_uom NOT NULL,                 -- njësia bazë përcaktohet për çdo produkt (DEC-G49-01)
  pieces_per_box    INTEGER CHECK (pieces_per_box > 0),
  m2_per_piece      NUMERIC(12,6) CHECK (m2_per_piece > 0),
  allow_partial_box BOOLEAN NOT NULL DEFAULT FALSE,
  tracks_lot        BOOLEAN NOT NULL DEFAULT FALSE,    -- nuancë / kalibër / lot
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Produktet në m² duhet të kenë paketim të plotë, sipas paketimit real (DEC-G49-02).
  CHECK (base_uom <> 'M2' OR (m2_per_piece IS NOT NULL AND pieces_per_box IS NOT NULL))
);

-- Hapi më i vogël i lejuar i sasisë në njësinë bazë; NULL = pa kufizim.
CREATE FUNCTION product_qty_step(p product) RETURNS NUMERIC AS $$
  SELECT CASE
    WHEN p.base_uom = 'M2' THEN CASE WHEN p.allow_partial_box THEN p.m2_per_piece ELSE p.m2_per_piece * p.pieces_per_box END
    WHEN p.pieces_per_box IS NULL OR p.allow_partial_box THEN 1
    ELSE p.pieces_per_box END
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE stock_lot (
  id         BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES product(id),
  lot_code   TEXT NOT NULL CHECK (length(trim(lot_code)) > 0),
  shade      TEXT NOT NULL DEFAULT '',
  caliber    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, lot_code, shade, caliber)
);

CREATE TABLE stock_balance (
  warehouse_id BIGINT NOT NULL REFERENCES warehouse(id),
  product_id   BIGINT NOT NULL REFERENCES product(id),
  lot_id       BIGINT REFERENCES stock_lot(id),
  on_hand      NUMERIC(19,4) NOT NULL CHECK (on_hand >= 0)    -- mbrojtja e fundit kundër stokut negativ
);
CREATE UNIQUE INDEX stock_balance_key ON stock_balance(warehouse_id, product_id, COALESCE(lot_id, 0));

CREATE TABLE stock_transfer (
  id                BIGSERIAL PRIMARY KEY,
  from_warehouse_id BIGINT NOT NULL REFERENCES warehouse(id),
  to_warehouse_id   BIGINT NOT NULL REFERENCES warehouse(id),
  status            TEXT NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT', 'RECEIVED', 'DISCREPANCY')),
  document_ref      TEXT NOT NULL CHECK (length(trim(document_ref)) > 0),
  dispatched_by     BIGINT NOT NULL REFERENCES app_user(id),
  dispatched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by       BIGINT REFERENCES app_user(id),
  received_at       TIMESTAMPTZ,
  idempotency_key   TEXT NOT NULL,
  UNIQUE (dispatched_by, idempotency_key),
  CHECK (from_warehouse_id <> to_warehouse_id),
  CHECK ((status = 'IN_TRANSIT') = (received_at IS NULL)),
  -- Dy palë të ndryshme: dërguesi nuk e konfirmon vetë pranimin.
  CHECK (received_by IS NULL OR received_by <> dispatched_by)
);

CREATE TABLE stock_transfer_line (
  transfer_id    BIGINT NOT NULL REFERENCES stock_transfer(id),
  line_no        INTEGER NOT NULL CHECK (line_no > 0),
  product_id     BIGINT NOT NULL REFERENCES product(id),
  lot_id         BIGINT REFERENCES stock_lot(id),
  qty_dispatched NUMERIC(19,4) NOT NULL CHECK (qty_dispatched > 0),
  qty_received   NUMERIC(19,4) CHECK (qty_received >= 0 AND qty_received <= qty_dispatched),
  PRIMARY KEY (transfer_id, line_no)
);

CREATE TYPE movement_type AS ENUM ('RECEIPT', 'DISPATCH', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN');

CREATE TABLE stock_movement (
  id              BIGSERIAL PRIMARY KEY,
  type            movement_type NOT NULL,
  warehouse_id    BIGINT NOT NULL REFERENCES warehouse(id),
  product_id      BIGINT NOT NULL REFERENCES product(id),
  lot_id          BIGINT REFERENCES stock_lot(id),
  qty             NUMERIC(19,4) NOT NULL CHECK (qty > 0),     -- gjithmonë pozitive; drejtimin e jep lloji
  document_ref    TEXT NOT NULL CHECK (length(trim(document_ref)) > 0),
  reason          TEXT,
  transfer_id     BIGINT REFERENCES stock_transfer(id),
  created_by      BIGINT NOT NULL REFERENCES app_user(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key),
  CHECK ((type IN ('TRANSFER_OUT', 'TRANSFER_IN')) = (transfer_id IS NOT NULL)),
  CHECK (type NOT IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT') OR length(trim(COALESCE(reason, ''))) > 0)
);
CREATE INDEX stock_movement_item_idx ON stock_movement(warehouse_id, product_id, lot_id);

-- ---------------------------------------------------------------------------
-- Lëvizja: kontrollohet dhe e përditëson gjendjen në të njëjtin transaksion
-- ---------------------------------------------------------------------------
CREATE FUNCTION stock_movement_apply() RETURNS trigger AS $$
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
    -- Kushti on_hand >= qty brenda UPDATE-it: dy dalje paralele nuk e kalojnë dot stokun.
    UPDATE stock_balance SET on_hand = on_hand - NEW.qty
     WHERE warehouse_id = NEW.warehouse_id AND product_id = NEW.product_id AND COALESCE(lot_id, 0) = COALESCE(NEW.lot_id, 0) AND on_hand >= NEW.qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movement_apply_trg
  BEFORE INSERT ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION stock_movement_apply();

CREATE FUNCTION stock_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'STOCK_MOVEMENT_IMMUTABLE' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON stock_movement FOR EACH ROW EXECUTE FUNCTION stock_append_only();
CREATE TRIGGER stock_movement_no_truncate BEFORE TRUNCATE ON stock_movement FOR EACH STATEMENT EXECUTE FUNCTION stock_append_only();

-- Gjendja nuk preket drejtpërdrejt: vetëm trigger-i i lëvizjes (thellësia > 1) mund ta ndryshojë.
CREATE FUNCTION stock_balance_guard() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'STOCK_BALANCE_ONLY_VIA_MOVEMENT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_balance_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON stock_balance FOR EACH ROW EXECUTE FUNCTION stock_balance_guard();
CREATE TRIGGER stock_balance_no_truncate BEFORE TRUNCATE ON stock_balance FOR EACH STATEMENT EXECUTE FUNCTION stock_append_only();

-- Paketimi i një produkti me lëvizje nuk ndryshohet (do t'i bënte të pavlefshme sasitë ekzistuese).
CREATE FUNCTION product_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW.base_uom, NEW.pieces_per_box, NEW.m2_per_piece, NEW.tracks_lot) IS DISTINCT FROM (OLD.base_uom, OLD.pieces_per_box, OLD.m2_per_piece, OLD.tracks_lot)
     AND EXISTS (SELECT 1 FROM stock_movement WHERE product_id = OLD.id) THEN
    RAISE EXCEPTION 'PRODUCT_PACKAGING_LOCKED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER product_guard_trg BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION product_guard();

-- Rreshtat e transferit nuk ndryshohen pas pranimit.
CREATE FUNCTION transfer_line_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.qty_received IS NOT NULL
     OR (NEW.product_id, NEW.lot_id, NEW.qty_dispatched) IS DISTINCT FROM (OLD.product_id, OLD.lot_id, OLD.qty_dispatched) THEN
    RAISE EXCEPTION 'TRANSFER_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER transfer_line_guard_trg BEFORE UPDATE OR DELETE ON stock_transfer_line FOR EACH ROW EXECUTE FUNCTION transfer_line_guard();

CREATE FUNCTION transfer_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER transfer_guard_trg BEFORE UPDATE OR DELETE ON stock_transfer FOR EACH ROW EXECUTE FUNCTION transfer_guard();
