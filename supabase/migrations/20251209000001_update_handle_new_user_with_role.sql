-- Update handle_new_user function to include role field
create or replace function public.handle_new_user()
returns trigger as $$
begin
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
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'phone',
    (new.raw_user_meta_data->>'birthdate')::date,
    new.raw_user_meta_data->>'organization',
    new.raw_user_meta_data->>'gender',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'kakao_id',
    new.raw_user_meta_data->>'kakao_email',
    coalesce(new.raw_user_meta_data->>'provider', 'email'),
    new.raw_user_meta_data->>'role'
  );
  return new;
end;
$$ language plpgsql security definer;


