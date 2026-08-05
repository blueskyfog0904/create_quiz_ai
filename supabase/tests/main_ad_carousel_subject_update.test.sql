begin;

select plan(11);

select has_function(
  'public',
  'update_main_ad_carousel_subject',
  array['text', 'jsonb'],
  'atomic main ad subject update function exists'
);

select function_privs_are(
  'public',
  'update_main_ad_carousel_subject',
  array['text', 'jsonb'],
  'public',
  array[]::text[],
  'public cannot update main ads'
);

select function_privs_are(
  'public',
  'update_main_ad_carousel_subject',
  array['text', 'jsonb'],
  'anon',
  array[]::text[],
  'anon cannot update main ads'
);

select function_privs_are(
  'public',
  'update_main_ad_carousel_subject',
  array['text', 'jsonb'],
  'authenticated',
  array[]::text[],
  'authenticated cannot update main ads'
);

select function_privs_are(
  'public',
  'update_main_ad_carousel_subject',
  array['text', 'jsonb'],
  'service_role',
  array['EXECUTE'],
  'service role can update main ads'
);

insert into public.system_settings (key, value)
values (
  'main_ad_carousel',
  '{"version":2,"items":{"english":[{"id":"11111111-1111-1111-8111-111111111111"}],"korean":[{"id":"22222222-2222-1222-8222-222222222222"}]}}'
)
on conflict (key) do update set value = excluded.value;

select throws_ok(
  $$select * from public.update_main_ad_carousel_subject(
    'korean',
    '{"version":1,"items":[{"id":"11111111-1111-1111-8111-111111111111"}]}'::jsonb
  )$$,
  'Duplicate cross-subject main ad item id',
  'a subject cannot reuse an item id from the preserved subject'
);

select is(
  (select value #>> '{items,korean,0,id}'
   from public.system_settings
   where key = 'main_ad_carousel'),
  '22222222-2222-1222-8222-222222222222',
  'a rejected cross-subject duplicate leaves the row unchanged'
);

select throws_ok(
  $$select * from public.update_main_ad_carousel_subject(
    'korean',
    '{"version":1,"items":[{"id":"33333333-3333-1333-8333-333333333333"},{"id":"33333333-3333-1333-8333-333333333333"}]}'::jsonb
  )$$,
  'Duplicate main ad item id',
  'a subject cannot contain duplicate item ids'
);

select throws_ok(
  $$select * from public.update_main_ad_carousel_subject(
    'korean',
    '{"version":1,"items":[{"id":"not-a-uuid"}]}'::jsonb
  )$$,
  'Invalid main ad item id',
  'a subject item must contain a valid UUID'
);

select is(
  (select before_config #>> '{items,english,0,id}'
   from public.update_main_ad_carousel_subject(
     'korean',
     '{"version":1,"items":[{"id":"44444444-4444-1444-8444-444444444444"}]}'::jsonb
   )),
  '11111111-1111-1111-8111-111111111111',
  'updating Korean returns the preserved English snapshot'
);

select is(
  (select value #>> '{items,korean,0,id}'
   from public.system_settings
   where key = 'main_ad_carousel'),
  '44444444-4444-1444-8444-444444444444',
  'updating Korean replaces only the Korean slice'
);

select * from finish();
rollback;
