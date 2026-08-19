
ALTER FUNCTION public.nature_from_hierarchical(text) SET search_path = public;
ALTER FUNCTION public.hier_level(text) SET search_path = public;
ALTER FUNCTION public.hier_parent(text) SET search_path = public;

REVOKE ALL ON FUNCTION public.chart_accounts_grid(uuid, text, text, text, boolean, boolean, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_ledger_account(uuid, text, text, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ledger_accounts_nature(uuid[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ledger_account_active(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chart_accounts_grid(uuid, text, text, text, boolean, boolean, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ledger_account(uuid, text, text, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ledger_accounts_nature(uuid[], text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ledger_account_active(uuid, boolean) TO authenticated, service_role;
