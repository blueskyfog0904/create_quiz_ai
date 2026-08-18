-- Existing payment/refund rows were audited after the additive migrations.
-- Validate the provider constraints separately to keep the DDL lock window small.

ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_provider_check;
ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_status_check;
ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_provider_environment_check;
ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_tax_snapshot_check;
ALTER TABLE public.payment_orders
  VALIDATE CONSTRAINT payment_orders_provider_snapshot_check;
ALTER TABLE public.refund_requests
  VALIDATE CONSTRAINT refund_requests_provider_check;
