-- Browser sessions may read their own credit and payment data, but all writes
-- must pass through authenticated server routes and the service-role boundary.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "System can insert credit sources" ON public.credit_sources;
DROP POLICY IF EXISTS "System can update credit sources" ON public.credit_sources;
DROP POLICY IF EXISTS "System can insert consumption" ON public.credit_consumption;
DROP POLICY IF EXISTS "System can insert transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "System can insert payments" ON public.payment_history;
DROP POLICY IF EXISTS "Users can insert own refund requests" ON public.refund_requests;

REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.credit_sources FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.credit_consumption FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.credit_transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_history FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.refund_requests FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.consume_credits(uuid, integer, text, uuid, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.consume_credits(uuid, integer, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_credits(uuid, integer, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)
  TO service_role;
