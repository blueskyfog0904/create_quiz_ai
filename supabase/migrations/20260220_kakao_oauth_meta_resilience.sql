-- Improve Kakao OAuth profile metadata mapping robustness in handle_new_user
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_provider text;
  v_kakao_id text;
  v_kakao_email text;
  v_birthdate text;
  v_birthdate_value date;
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

  v_birthdate := nullif(btrim(new.raw_user_meta_data ->> 'birthdate'), '');
  if v_birthdate is not null and v_birthdate ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_birthdate_value := v_birthdate::date;
    exception when others then
      v_birthdate_value := null;
    end;
  end if;

  insert into public.profiles (
    id,
    email,
    name,
    avatar_url,
    phone,
    birthdate,
    organization,
    gender,
    address,
    kakao_id,
    kakao_email,
    provider,
    role
  )
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    v_birthdate_value,
    nullif(btrim(new.raw_user_meta_data ->> 'organization'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'gender'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'address'), ''),
    v_kakao_id,
    v_kakao_email,
    v_provider,
    new.raw_user_meta_data ->> 'role'
  );

  return new;
end;
$$ language plpgsql security definer;

create index if not exists idx_profiles_provider_kakao_id
  on public.profiles (provider, kakao_id);
