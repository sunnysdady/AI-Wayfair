ALTER TABLE sku_costs
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS currency_certified_at TEXT,
  ADD COLUMN IF NOT EXISTS currency_certification_source TEXT;

-- Legacy rows are untrusted until both part number and cents match the
-- independently reconciled operating snapshot.
UPDATE sku_costs
SET currency = 'UNVERIFIED',
    currency_certified_at = NULL,
    currency_certification_source = NULL;

WITH certified(part_number, unit_cost_cents) AS (
  VALUES
    ('3T-B', 4300),
    ('3T-W', 4300),
    ('4T-Kayak', 7500),
    ('5T-1830-1200', 6800),
    ('5T-1830-900', 4500),
    ('5T-1980-1200', 6000),
    ('6T-2095-122', 7000),
    ('LFC-2B', 7540),
    ('LFC-2B-680', 6420),
    ('LFC-2W', 7540),
    ('LFC-2W-680', 6420),
    ('LFC-3B', 9048),
    ('LFC-3W', 9094),
    ('LFC-4B', 11322),
    ('LFC-4W', 11322),
    ('LFC-4W-400', 11322),
    ('MFC-D2-B', 7000),
    ('MFC-D2-W', 7000),
    ('MFC-D2W', 7000),
    ('MFC-D3-B', 6800),
    ('MFC-D3-W', 6800),
    ('VF-ZH-4B', 11500),
    ('VF-ZH-4W', 11500),
    ('VFC-2B', 5290),
    ('VFC-2W', 5290),
    ('VFC-3B', 7090),
    ('VFC-3W', 7090),
    ('VFC-5B', 10530)
)
UPDATE sku_costs AS costs
SET currency = 'USD',
    currency_certified_at = '2026-07-28T00:00:00.000Z',
    currency_certification_source = 'legacy-cost-reconciliation:dmom-operating-2026-06.json'
FROM certified
WHERE costs.part_number = certified.part_number
  AND costs.unit_cost_cents = certified.unit_cost_cents;

ALTER TABLE sku_costs
  ALTER COLUMN currency SET DEFAULT 'UNVERIFIED',
  ALTER COLUMN currency SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sku_costs_currency_certified'
  ) THEN
    ALTER TABLE sku_costs
      ADD CONSTRAINT sku_costs_currency_certified
      CHECK (currency IN ('USD', 'UNVERIFIED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sku_costs_usd_requires_evidence'
  ) THEN
    ALTER TABLE sku_costs
      ADD CONSTRAINT sku_costs_usd_requires_evidence
      CHECK (
        currency = 'UNVERIFIED'
        OR (
          currency = 'USD'
          AND currency_certified_at IS NOT NULL
          AND currency_certification_source IS NOT NULL
        )
      );
  END IF;
END
$$;
