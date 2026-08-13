revoke execute on function public.merge_file_entries(uuid, jsonb) from anon, authenticated, public;
revoke execute on function public.recalculate_period_indicators_internal(uuid) from anon, authenticated, public;
grant execute on function public.merge_file_entries(uuid, jsonb) to service_role;
grant execute on function public.recalculate_period_indicators_internal(uuid) to service_role;