-- Restrict financial RPCs to service_role only.
-- Prior migrations granted EXECUTE to authenticated clients, which can bypass
-- app-layer owner checks and invoice allowlists.

REVOKE ALL ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_reconcile_late_fees(date, uuid[], boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.rent_correct_single_invoice(
  uuid, numeric, numeric, numeric, date, boolean
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_correct_single_invoice(
  uuid, numeric, numeric, numeric, date, boolean
) TO service_role;

REVOKE ALL ON FUNCTION public.rent_apply_prospective_change(
  uuid, numeric, date, date
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_apply_prospective_change(
  uuid, numeric, date, date
) TO service_role;

REVOKE ALL ON FUNCTION public.rent_waive_late_fee(uuid, date)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_waive_late_fee(uuid, date)
  TO service_role;

REVOKE ALL ON FUNCTION public.rent_create_invoice_if_period_available(
  uuid, date, date, date, text, numeric
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_create_invoice_if_period_available(
  uuid, date, date, date, text, numeric
) TO service_role;

REVOKE ALL ON FUNCTION public.rent_record_and_apply_payment_fifo(
  uuid, uuid, uuid, timestamptz, numeric, text, text, text, uuid
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rent_record_and_apply_payment_fifo(
  uuid, uuid, uuid, timestamptz, numeric, text, text, text, uuid
) TO service_role;
