-- Tax bills stored by calendar year so the May roll-forward keeps each year's amount.
-- Shape: {"2026": {"owed": 700, "paid": 200}, "2025": {"paid": 400}}
-- Land uses tax_by_year. A mobile home's separate bill uses trailer_tax_by_year.

ALTER TABLE "RENT_properties"
  ADD COLUMN IF NOT EXISTS "tax_by_year" JSONB,
  ADD COLUMN IF NOT EXISTS "trailer_tax_by_year" JSONB;

COMMENT ON COLUMN "RENT_properties"."tax_by_year" IS 'Land tax bill and amount paid, keyed by calendar year';
COMMENT ON COLUMN "RENT_properties"."trailer_tax_by_year" IS 'Mobile home tax bill and amount paid, keyed by calendar year';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'RENT_properties'
  AND column_name IN ('tax_by_year', 'trailer_tax_by_year')
ORDER BY column_name;
