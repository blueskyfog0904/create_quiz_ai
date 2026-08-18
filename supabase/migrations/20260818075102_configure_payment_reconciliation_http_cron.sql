CREATE OR REPLACE FUNCTION public.configure_payment_reconciliation_http_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, cron, pg_temp
AS $$
DECLARE
  v_origin text;
  v_cron_secret text;
  v_existing_job_id bigint;
  v_job_id bigint;
BEGIN
  SELECT TRIM(decrypted_secret)
    INTO v_origin
    FROM vault.decrypted_secrets
   WHERE name = 'payment_reconcile_origin';

  SELECT TRIM(decrypted_secret)
    INTO v_cron_secret
    FROM vault.decrypted_secrets
   WHERE name = 'payment_reconcile_cron_secret';

  IF v_origin IS NULL OR v_cron_secret IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_VAULT_SECRETS_MISSING';
  END IF;

  IF v_origin <> 'https://www.summersuninst.com' THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_ORIGIN_INVALID';
  END IF;

  IF LENGTH(v_cron_secret) < 32 THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_CRON_SECRET_INVALID';
  END IF;

  SELECT jobid
    INTO v_existing_job_id
    FROM cron.job
   WHERE jobname = 'payment-reconciliation-http-5m';

  IF v_existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_job_id);
  END IF;

  v_job_id := cron.schedule(
    'payment-reconciliation-http-5m',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := (
          SELECT TRIM(decrypted_secret)
            FROM vault.decrypted_secrets
           WHERE name = 'payment_reconcile_origin'
        ) || '/api/internal/payments/reconcile',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT TRIM(decrypted_secret)
              FROM vault.decrypted_secrets
             WHERE name = 'payment_reconcile_cron_secret'
          )
        ),
        body := jsonb_build_object('limit', 20),
        timeout_milliseconds := 55000
      );
    $cron$
  );

  RETURN v_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.configure_payment_reconciliation_http_cron()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
       SELECT 1
         FROM vault.decrypted_secrets
        WHERE name = 'payment_reconcile_origin'
     )
     AND EXISTS (
       SELECT 1
         FROM vault.decrypted_secrets
        WHERE name = 'payment_reconcile_cron_secret'
     ) THEN
    PERFORM public.configure_payment_reconciliation_http_cron();
  END IF;
END;
$$;
