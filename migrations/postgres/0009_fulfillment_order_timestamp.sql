ALTER TABLE fulfillment_order_lines
  ALTER COLUMN order_date TYPE TIMESTAMPTZ
  USING order_date::timestamp AT TIME ZONE 'Etc/GMT+4';
