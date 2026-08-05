-- Atomically replaces one subject slice while preserving the opposite subject.
create or replace function public.update_main_ad_carousel_subject(
  p_subject text,
  p_subject_config jsonb
)
returns table (
  before_config jsonb,
  after_config jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_config jsonb;
  normalized_english jsonb;
  normalized_korean jsonb;
  preserved_items jsonb;
begin
  if p_subject is null or p_subject not in ('english', 'korean') then
    raise exception 'Unsupported main ad subject';
  end if;

  if p_subject_config is null
    or jsonb_typeof(p_subject_config) <> 'object'
    or p_subject_config -> 'version' <> '1'::jsonb
    or jsonb_typeof(p_subject_config -> 'items') <> 'array' then
    raise exception 'Invalid main ad subject config';
  end if;

  insert into public.system_settings (key, value, description)
  values (
    'main_ad_carousel',
    '{"version":2,"items":{"english":[],"korean":[]}}'::jsonb,
    'Solvook preview main advertisement carousel'
  )
  on conflict (key) do nothing;

  select value
  into stored_config
  from public.system_settings
  where key = 'main_ad_carousel'
  for update;

  if stored_config -> 'version' = '1'::jsonb
    and jsonb_typeof(stored_config -> 'items') = 'array' then
    normalized_english := stored_config -> 'items';
    normalized_korean := '[]'::jsonb;
  elsif stored_config -> 'version' = '2'::jsonb
    and jsonb_typeof(stored_config -> 'items') = 'object'
    and jsonb_typeof(stored_config #> '{items,english}') = 'array'
    and jsonb_typeof(stored_config #> '{items,korean}') = 'array' then
    normalized_english := stored_config #> '{items,english}';
    normalized_korean := stored_config #> '{items,korean}';
  else
    raise exception 'Invalid stored main ad carousel config';
  end if;

  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(item) <> 'object' then item
      when jsonb_typeof(item -> 'durationSeconds') = 'number'
        and (item ->> 'durationSeconds')::numeric = trunc((item ->> 'durationSeconds')::numeric)
        and (item ->> 'durationSeconds')::numeric between 1 and 60 then item
      else item || '{"durationSeconds":5}'::jsonb
    end
    order by ordinal
  ), '[]'::jsonb)
  into normalized_english
  from jsonb_array_elements(normalized_english) with ordinality as entries(item, ordinal);

  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(item) <> 'object' then item
      when jsonb_typeof(item -> 'durationSeconds') = 'number'
        and (item ->> 'durationSeconds')::numeric = trunc((item ->> 'durationSeconds')::numeric)
        and (item ->> 'durationSeconds')::numeric between 1 and 60 then item
      else item || '{"durationSeconds":5}'::jsonb
    end
    order by ordinal
  ), '[]'::jsonb)
  into normalized_korean
  from jsonb_array_elements(normalized_korean) with ordinality as entries(item, ordinal);

  if exists (
    select 1
    from jsonb_array_elements(p_subject_config -> 'items') as entries(item)
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item -> 'id') is distinct from 'string'
      or item ->> 'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid main ad item id';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_subject_config -> 'items') as entries(item)
    group by lower(item ->> 'id')
    having count(*) > 1
  ) then
    raise exception 'Duplicate main ad item id';
  end if;

  preserved_items := case
    when p_subject = 'english' then normalized_korean
    else normalized_english
  end;

  if exists (
    select 1
    from jsonb_array_elements(p_subject_config -> 'items') as incoming(item)
    join jsonb_array_elements(preserved_items) as preserved(item)
      on lower(incoming.item ->> 'id') = lower(preserved.item ->> 'id')
  ) then
    raise exception 'Duplicate cross-subject main ad item id';
  end if;

  before_config := jsonb_build_object(
    'version', 2,
    'items', jsonb_build_object(
      'english', normalized_english,
      'korean', normalized_korean
    )
  );

  after_config := jsonb_set(
    before_config,
    array['items', p_subject],
    p_subject_config -> 'items',
    false
  );

  update public.system_settings
  set
    value = after_config,
    description = 'Solvook preview main advertisement carousel',
    updated_at = timezone('utc'::text, now())
  where key = 'main_ad_carousel';

  return next;
end;
$$;

revoke execute on function public.update_main_ad_carousel_subject(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_main_ad_carousel_subject(text, jsonb)
  to service_role;
