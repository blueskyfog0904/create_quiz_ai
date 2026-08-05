begin;

select plan(8);

select has_function(
  'public',
  'get_market_home_popular_items',
  array['text', 'timestamp with time zone', 'integer'],
  'market home ranking function exists'
);

select function_privs_are(
  'public',
  'get_market_home_popular_items',
  array['text', 'timestamp with time zone', 'integer'],
  'anon',
  array[]::text[],
  'anon cannot execute market home ranking'
);

select function_privs_are(
  'public',
  'get_market_home_popular_items',
  array['text', 'timestamp with time zone', 'integer'],
  'authenticated',
  array[]::text[],
  'authenticated cannot execute market home ranking'
);

select function_privs_are(
  'public',
  'get_market_home_popular_items',
  array['text', 'timestamp with time zone', 'integer'],
  'service_role',
  array['EXECUTE'],
  'service role can execute market home ranking'
);

select ok(
  pg_get_functiondef(
    'public.get_market_home_popular_items(text, timestamptz, integer)'::regprocedure
  ) ~* 'count\(DISTINCT events.user_id\)',
  'ranking counts distinct URL-issuance users'
);

select ok(
  pg_get_functiondef(
    'public.get_market_home_popular_items(text, timestamptz, integer)'::regprocedure
  ) ~* 'items.workspace_subject = p_workspace_subject'
  and pg_get_functiondef(
    'public.get_market_home_popular_items(text, timestamptz, integer)'::regprocedure
  ) ~* 'menus.is_visible = true',
  'ranking is subject and visible-menu scoped'
);

select ok(
  pg_get_functiondef(
    'public.get_market_home_popular_items(text, timestamptz, integer)'::regprocedure
  ) ~* 'download_issuer_user_count DESC.*published_at DESC NULLS LAST.*items.id ASC',
  'ranking has deterministic tie breaks'
);

select has_index(
  'public',
  'market_download_events',
  'idx_market_download_events_home_ranking',
  'ranking covering index exists'
);

select * from finish();
rollback;
