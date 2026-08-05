begin;

select plan(10);

select has_table(
  'public',
  'market_menu_groups',
  'market menu group table exists'
);

select has_column(
  'public',
  'market_menu_entries',
  'group_id',
  'market menu entries can reference a group'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_menu_groups'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%workspace_subject%'
      and pg_get_constraintdef(oid) like '%english%'
      and pg_get_constraintdef(oid) like '%korean%'
  ),
  'group workspace subject is constrained'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_menu_groups'::regclass
      and conname = 'market_menu_groups_workspace_group_key_unique'
      and contype = 'u'
  ),
  'group key is unique inside a subject'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_menu_entries'::regclass
      and conname = 'market_menu_entries_group_workspace_subject_fkey'
      and contype = 'f'
      and array_length(conkey, 1) = 2
  ),
  'entry-to-group relationship uses a composite subject-safe foreign key'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'market_menu_groups'
      and policyname = 'Public can read visible market menu groups'
      and cmd = 'SELECT'
      and roles @> array['anon', 'authenticated']::name[]
  ),
  'public readers have only the visible group policy'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'market_menu_groups'
      and policyname = 'Admins can manage market menu groups'
      and cmd = 'ALL'
      and qual like '%is_admin%'
      and with_check like '%is_admin%'
  ),
  'group writes require the admin policy'
);

insert into public.market_menu_groups (
  id,
  workspace_subject,
  group_key,
  title
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'english',
    'pgtap-english',
    'English pgTAP group'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'korean',
    'pgtap-korean',
    'Korean pgTAP group'
  );

insert into public.market_menu_entries (
  id,
  entry_key,
  slug,
  title,
  workspace_subject,
  subject_code,
  group_id
)
values (
  '33333333-3333-4333-8333-333333333333',
  'pgtap-market-menu-entry-20260730',
  'pgtap-market-menu-entry-20260730',
  'pgTAP market menu entry',
  'english',
  'english',
  '11111111-1111-4111-8111-111111111111'
);

select throws_ok(
  $$
    update public.market_menu_entries
    set group_id = '22222222-2222-4222-8222-222222222222'
    where id = '33333333-3333-4333-8333-333333333333'
  $$,
  '23503',
  null,
  'an English entry cannot reference a Korean group'
);

select is(
  (
    select group_id::text
    from public.market_menu_entries
    where id = '33333333-3333-4333-8333-333333333333'
  ),
  '11111111-1111-4111-8111-111111111111',
  'a rejected cross-subject assignment preserves the existing group'
);

select throws_ok(
  $$
    insert into public.market_menu_groups (
      workspace_subject,
      group_key,
      title
    )
    values ('math', 'pgtap-invalid', 'Invalid group')
  $$,
  '23514',
  null,
  'unsupported workspace subjects are rejected'
);

select * from finish();
rollback;
