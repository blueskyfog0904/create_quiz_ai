drop policy if exists "Admins can manage pricing plans" on public.pricing_plans;

create policy "Admins can manage pricing plans"
on public.pricing_plans
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can view all profiles" on public.profiles;

create policy "Admins can view all profiles"
on public.profiles
for select
to authenticated
using (public.is_admin());
