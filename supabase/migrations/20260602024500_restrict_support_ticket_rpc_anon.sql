revoke all on function public.create_support_ticket(uuid, text, text) from anon;
revoke all on function public.update_own_pending_support_ticket(uuid, uuid, text, text) from anon;
revoke all on function public.soft_delete_own_support_ticket(uuid) from anon;

revoke all on function public.create_support_ticket(uuid, text, text) from public;
revoke all on function public.update_own_pending_support_ticket(uuid, uuid, text, text) from public;
revoke all on function public.soft_delete_own_support_ticket(uuid) from public;

grant execute on function public.create_support_ticket(uuid, text, text) to authenticated;
grant execute on function public.update_own_pending_support_ticket(uuid, uuid, text, text) to authenticated;
grant execute on function public.soft_delete_own_support_ticket(uuid) to authenticated;
