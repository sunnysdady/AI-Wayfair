CREATE TABLE IF NOT EXISTS fulfillment_order_lines (
  source_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  order_date DATE,
  system_order_number TEXT NOT NULL DEFAULT '',
  parent_order_number TEXT NOT NULL,
  order_number TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  customer_name TEXT NOT NULL DEFAULT '',
  address_line_1 TEXT NOT NULL DEFAULT '',
  address_line_2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state_region TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  warehouse_sku_code TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  shipping_status TEXT NOT NULL DEFAULT '待补全',
  label_object_key TEXT NOT NULL DEFAULT '',
  label_file_name TEXT NOT NULL DEFAULT '',
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fulfillment_order_number_per_parent UNIQUE (parent_order_number, order_number)
);

CREATE INDEX IF NOT EXISTS fulfillment_order_lines_date_idx
  ON fulfillment_order_lines(order_date DESC, order_number);
CREATE INDEX IF NOT EXISTS fulfillment_order_lines_status_idx
  ON fulfillment_order_lines(shipping_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS fulfillment_order_lines_tracking_idx
  ON fulfillment_order_lines(tracking_number) WHERE tracking_number <> '';
