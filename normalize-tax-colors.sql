-- Keep yellow customer (1) and dark green bank (7).
-- Every other painted tax color becomes lime HHS (3). Blank (0) stays blank.

UPDATE "RENT_properties"
SET "tax_color_state" = 3
WHERE "tax_color_state" IS NOT NULL
  AND "tax_color_state" NOT IN (0, 1, 3, 7);
