ALTER TABLE orders
  ALTER COLUMN po_date TYPE TIMESTAMPTZ
  USING po_date::timestamptz;
