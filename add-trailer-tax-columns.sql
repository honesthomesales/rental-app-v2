-- Separate tax bill for mobile homes (double wide / single wide).
-- Land keeps property_tax, tax_paid_amount_*, tax_owed, and Map_ID.
-- The home uses these columns plus the existing map_id_trailer tax ID.
-- Rates are monthly, same as property_tax (annual = monthly × 12).

ALTER TABLE "RENT_properties"
  ADD COLUMN IF NOT EXISTS "trailer_property_tax" NUMERIC,
  ADD COLUMN IF NOT EXISTS "trailer_tax_paid_amount_current" NUMERIC,
  ADD COLUMN IF NOT EXISTS "trailer_tax_paid_amount_previous" NUMERIC,
  ADD COLUMN IF NOT EXISTS "trailer_tax_owed" NUMERIC;

COMMENT ON COLUMN "RENT_properties"."trailer_property_tax" IS 'Mobile home monthly tax rate (annual due = this × 12)';
COMMENT ON COLUMN "RENT_properties"."trailer_tax_paid_amount_current" IS 'Mobile home tax paid for the current year';
COMMENT ON COLUMN "RENT_properties"."trailer_tax_paid_amount_previous" IS 'Mobile home tax paid for the prior year';
COMMENT ON COLUMN "RENT_properties"."trailer_tax_owed" IS 'Manually set mobile home tax owed (overrides calculated value if set)';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'RENT_properties'
  AND column_name IN (
    'trailer_property_tax',
    'trailer_tax_paid_amount_current',
    'trailer_tax_paid_amount_previous',
    'trailer_tax_owed'
  )
ORDER BY column_name;
