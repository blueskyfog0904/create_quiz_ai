-- Simplify profile mapping to keep only core signup fields and Kakao identifiers
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_provider text;
  v_kakao_id text;
  v_kakao_email text;
begin
  v_provider := coalesce(
    nullif(btrim(new.raw_app_meta_data ->> 'provider'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider'), ''),
    'email'
  );

  v_kakao_id := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_uid'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'sub'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'sub'), '')
  );

  v_kakao_email := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_email'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'email'), ''),
    nullif(btrim(new.email), '')
  );

  insert into public.profiles (
    id,
    email,
    name,
    phone,
    avatar_url,
    kakao_id,
    kakao_email,
    provider
  )
  values (
    new.id,
    new.email,
    nullif(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          new.raw_user_meta_data ->> 'nickname',
          new.raw_app_meta_data ->> 'name'
        )
      ),
      ''
    ),
    nullif(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'phone',
          new.raw_user_meta_data ->> 'phone_number'
        )
      ),
      ''
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    v_kakao_id,
    v_kakao_email,
    v_provider
  );

  return new;
end;
$$ language plpgsql security definer;
