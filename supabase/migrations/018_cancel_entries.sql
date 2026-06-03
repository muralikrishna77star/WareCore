-- ============================================================
-- WareCore WMS - Cancel Purchase Bill & Sale Entry
-- Adds cancel status to bills/dispatches and reverses stock
-- ============================================================

-- ── Extend stock_ledger entry_type to include cancel types ──────────────────

ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_entry_type_check;
ALTER TABLE stock_ledger
  ADD CONSTRAINT stock_ledger_entry_type_check
  CHECK (entry_type IN (
    'PURCHASE_IN', 'VENDOR_RETURN_IN',
    'SALE_OUT',
    'JOB_WORK_OUT', 'JOB_WORK_RETURN_IN',
    'TRANSFER_OUT', 'TRANSFER_IN',
    'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
    'PURCHASE_CANCEL', 'SALE_CANCEL'
  ));

-- ── Add status + cancel metadata to purchase_bills ───────────────────────────

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_notes TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_bills_status_check'
  ) THEN
    ALTER TABLE purchase_bills
      ADD CONSTRAINT purchase_bills_status_check
      CHECK (status IN ('active', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_bills_status ON purchase_bills(status);

-- ── Add status + cancel metadata to dispatch_orders ──────────────────────────

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_notes TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dispatch_orders_status_check'
  ) THEN
    ALTER TABLE dispatch_orders
      ADD CONSTRAINT dispatch_orders_status_check
      CHECK (status IN ('active', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispatch_orders_status ON dispatch_orders(status);

-- ── Atomic cancel function for Purchase Bills ─────────────────────────────────
-- Inserts a PURCHASE_CANCEL stock entry (negative quantity) for every line item
-- and marks the bill as cancelled — all in one transaction.

CREATE OR REPLACE FUNCTION cancel_purchase_bill(
  p_bill_id UUID,
  p_notes   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bill  purchase_bills%ROWTYPE;
  v_item  purchase_bill_items%ROWTYPE;
BEGIN
  -- Lock the row to prevent concurrent cancellations
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill not found');
  END IF;

  IF v_bill.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill is already cancelled');
  END IF;

  -- Insert a reversal PURCHASE_CANCEL entry for each line item
  FOR v_item IN
    SELECT * FROM purchase_bill_items WHERE bill_id = p_bill_id
  LOOP
    INSERT INTO stock_ledger (
      entry_type,
      company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      notes, entry_date,
      purchase_line_id
    ) VALUES (
      'PURCHASE_CANCEL',
      v_bill.company_id, v_bill.warehouse_id,
      v_item.material_type_id, v_item.material_size_id, v_item.size_label,
      -v_item.quantity,           -- negate: reverses the original PURCHASE_IN
      'purchase_bill', v_bill.id, v_bill.bill_number,
      p_notes,
      CURRENT_DATE,
      v_item.purchase_line_id
    );
  END LOOP;

  -- Mark bill as cancelled
  UPDATE purchase_bills
  SET
    status          = 'cancelled',
    cancelled_at    = NOW(),
    cancelled_notes = p_notes,
    updated_at      = NOW()
  WHERE id = p_bill_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── Atomic cancel function for Dispatch (Sale) Orders ────────────────────────
-- Inserts a SALE_CANCEL stock entry (positive quantity) for every dispatched item,
-- restoring the stock that was deducted, and marks the order as cancelled.

CREATE OR REPLACE FUNCTION cancel_dispatch_order(
  p_order_id UUID,
  p_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order dispatch_orders%ROWTYPE;
  v_item  dispatch_items%ROWTYPE;
BEGIN
  -- Lock the row to prevent concurrent cancellations
  SELECT * INTO v_order FROM dispatch_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order not found');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dispatch order is already cancelled');
  END IF;

  -- Insert a reversal SALE_CANCEL entry for each dispatched item
  FOR v_item IN
    SELECT * FROM dispatch_items WHERE dispatch_order_id = p_order_id
  LOOP
    INSERT INTO stock_ledger (
      entry_type,
      company_id, warehouse_id,
      material_type_id, material_size_id, size_label,
      quantity,
      reference_type, reference_id, reference_number,
      notes, entry_date,
      purchase_line_id, sub_purchase_line_id
    ) VALUES (
      'SALE_CANCEL',
      v_order.company_id, v_order.warehouse_id,
      v_item.material_type_id, v_item.material_size_id, v_item.size_label,
      v_item.quantity,            -- positive: reverses the original SALE_OUT (which was negative)
      'dispatch', v_order.id, v_order.invoice_number,
      p_notes,
      CURRENT_DATE,
      v_item.purchase_line_id,
      v_item.sub_purchase_line_id
    );
  END LOOP;

  -- Mark order as cancelled
  UPDATE dispatch_orders
  SET
    status          = 'cancelled',
    cancelled_at    = NOW(),
    cancelled_notes = p_notes,
    updated_at      = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
