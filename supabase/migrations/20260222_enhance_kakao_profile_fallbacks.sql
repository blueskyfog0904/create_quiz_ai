-- Enhance Kakao OAuth metadata mapping with nested kakao_account fallbacks
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_provider text;
  v_kakao_id text;
  v_kakao_email text;
  v_profile_name text;
  v_phone text;
  v_avatar_url text;
begin
  v_provider := coalesce(
    nullif(btrim(new.raw_app_meta_data ->> 'provider'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider'), ''),
    'email'
  );

  v_kakao_id := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_id'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'sub'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_uid'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'sub'), '')
  );

  v_kakao_email := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_email'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'email'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' ->> 'email'), ''),
    nullif(btrim(new.email), '')
  );

  v_profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'nickname'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' -> 'profile' ->> 'nickname'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'name'), '')
  );

  v_phone := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone_number'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' ->> 'phone_number'), '')
  );

  v_avatar_url := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'picture'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' -> 'profile' ->> 'profile_image_url'), '')
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
    coalesce(new.email, v_kakao_email),
    v_profile_name,
    v_phone,
    v_avatar_url,
    v_kakao_id,
    v_kakao_email,
    v_provider
  );

  return new;
end;
$$ language plpgsql security definer;
