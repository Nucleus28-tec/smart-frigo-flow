drop function if exists public.trial_balance_report(uuid, text[], date, date);

revoke execute on function public.trial_balance_report(uuid, text[], date, date, text) from anon, public;
revoke execute on function public.closing_summary(uuid) from anon, public;
revoke execute on function public.closing_year_grid(int) from anon, public;
revoke execute on function public.close_period_partial(uuid, text, text, text) from anon, public;
revoke execute on function public.reopen_period(uuid) from anon, public;
revoke execute on function public.close_fiscal_year(int) from anon, public;
revoke execute on function public.reopen_fiscal_year(int) from anon, public;

grant execute on function public.trial_balance_report(uuid, text[], date, date, text) to authenticated, service_role;
grant execute on function public.closing_summary(uuid) to authenticated, service_role;
grant execute on function public.closing_year_grid(int) to authenticated, service_role;
grant execute on function public.close_period_partial(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.reopen_period(uuid) to authenticated, service_role;
grant execute on function public.close_fiscal_year(int) to authenticated, service_role;
grant execute on function public.reopen_fiscal_year(int) to authenticated, service_role;