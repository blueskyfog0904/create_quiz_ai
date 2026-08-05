CREATE TABLE public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transmission_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  order_id text,
  payload_hash text NOT NULL,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'completed', 'ignored', 'failed')),
  provider_retry_count integer NOT NULL DEFAULT 0
    CHECK (provider_retry_count >= 0),
  last_error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX payment_webhook_events_pending_idx
  ON public.payment_webhook_events(processing_status, received_at)
  WHERE processing_status IN ('pending', 'failed');

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_webhook_events
  FROM anon, authenticated;
GRANT ALL ON TABLE public.payment_webhook_events
  TO service_role;
