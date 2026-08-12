revoke execute on function public.is_admin() from anon, public;
revoke execute on function public.get_period_summary(uuid) from anon, public;
revoke execute on function public.log_activity(text, text, uuid, jsonb) from anon, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.set_updated_at() from anon, authenticated, public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_period_summary(uuid) to authenticated;
grant execute on function public.log_activity(text, text, uuid, jsonb) to authenticated;