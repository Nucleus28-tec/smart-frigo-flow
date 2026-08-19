revoke execute on function public.journal_entries_grid(uuid, text, date, date, text, boolean, integer, integer) from public, anon;
revoke execute on function public.upsert_manual_journal_entry(uuid, text, text, date, text, numeric, text, uuid) from public, anon;
revoke execute on function public.cancel_journal_entry(uuid, text) from public, anon;
grant execute on function public.journal_entries_grid(uuid, text, date, date, text, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.upsert_manual_journal_entry(uuid, text, text, date, text, numeric, text, uuid) to authenticated, service_role;
grant execute on function public.cancel_journal_entry(uuid, text) to authenticated, service_role;