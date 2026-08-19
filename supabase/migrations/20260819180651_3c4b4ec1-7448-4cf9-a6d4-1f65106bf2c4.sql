
CREATE OR REPLACE FUNCTION public.bulk_upsert_ledger_accounts(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  WITH src AS (
    SELECT
      r->>'code' AS code,
      CASE WHEN right(r->>'hier',1) = '.' THEN r->>'hier' ELSE (r->>'hier') || '.' END AS hier,
      r->>'name' AS nome,
      coalesce((r->>'analytic')::boolean, false) AS an
    FROM jsonb_array_elements(_rows) AS r
  ), ins AS (
    INSERT INTO public.ledger_accounts
      (reduced_code, hierarchical_code, name, level, parent_code, is_analytic, nature, link_status)
    SELECT
      src.code, src.hier, src.nome,
      public.hier_level(src.hier),
      public.hier_parent(src.hier),
      src.an,
      public.nature_from_hierarchical(src.hier),
      CASE WHEN public.nature_from_hierarchical(src.hier) IS NULL THEN 'pendente' ELSE 'confirmado' END
    FROM src
    ON CONFLICT (reduced_code) DO UPDATE SET
      hierarchical_code = excluded.hierarchical_code,
      name = excluded.name,
      level = excluded.level,
      parent_code = excluded.parent_code,
      is_analytic = excluded.is_analytic,
      nature = coalesce(public.ledger_accounts.nature, excluded.nature),
      link_status = excluded.link_status,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;
  RETURN jsonb_build_object('processed', _n);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_upsert_ledger_accounts(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_ledger_accounts(jsonb) TO service_role;
