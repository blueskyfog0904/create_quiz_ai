drop policy if exists "Admins can manage roles" on public.user_roles;
create policy "Admins can manage roles" on public.user_roles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
