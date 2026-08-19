
ALTER TABLE public.ledger_accounts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.nature_from_hierarchical(_hier text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _hier IS NULL THEN NULL
    WHEN _hier LIKE '1.01%' THEN 'ativo_circulante'
    WHEN _hier LIKE '1.02%' THEN 'ativo_nao_circulante'
    WHEN _hier LIKE '2.01%' THEN 'passivo_circulante'
    WHEN _hier LIKE '2.02%' THEN 'passivo_nao_circulante'
    WHEN _hier LIKE '2.03%' THEN 'patrimonio_liquido'
    WHEN _hier LIKE '3.01%' THEN 'custo'
    WHEN _hier LIKE '3.02%' THEN 'despesa'
    WHEN _hier LIKE '3.03%' THEN 'despesa'
    WHEN _hier LIKE '4%'    THEN 'receita'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.hier_level(_hier text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _hier IS NULL OR _hier = '' THEN NULL
    ELSE array_length(string_to_array(trim(both '.' from _hier), '.'), 1) END
$$;

CREATE OR REPLACE FUNCTION public.hier_parent(_hier text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _hier IS NULL OR _hier = '' THEN NULL
    WHEN public.hier_level(_hier) <= 1 THEN NULL
    ELSE array_to_string(
      (string_to_array(trim(both '.' from _hier), '.'))[1:public.hier_level(_hier) - 1], '.') || '.'
  END
$$;

CREATE OR REPLACE FUNCTION public.chart_accounts_grid(
  _period_id uuid DEFAULT NULL,
  _query text DEFAULT NULL,
  _nature text DEFAULT NULL,
  _type text DEFAULT NULL,
  _only_pending boolean DEFAULT false,
  _only_active boolean DEFAULT false,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q text := nullif(trim(coalesce(_query, '')), '');
  _total bigint;
  _rows jsonb;
BEGIN
  WITH base AS (
    SELECT a.*
    FROM public.ledger_accounts a
    WHERE (_q IS NULL OR txt_norm(a.name) LIKE '%' || txt_norm(_q) || '%'
           OR a.reduced_code LIKE '%' || _q || '%'
           OR coalesce(a.hierarchical_code, '') LIKE '%' || _q || '%')
      AND (_nature IS NULL OR a.nature = _nature)
      AND (_type IS NULL OR (_type = 'analitica') = a.is_analytic)
      AND (NOT _only_pending OR a.nature IS NULL OR a.hierarchical_code IS NULL)
      AND (NOT _only_active OR a.is_active)
  )
  SELECT count(*) INTO _total FROM base;

  WITH base AS (
    SELECT a.*
    FROM public.ledger_accounts a
    WHERE (_q IS NULL OR txt_norm(a.name) LIKE '%' || txt_norm(_q) || '%'
           OR a.reduced_code LIKE '%' || _q || '%'
           OR coalesce(a.hierarchical_code, '') LIKE '%' || _q || '%')
      AND (_nature IS NULL OR a.nature = _nature)
      AND (_type IS NULL OR (_type = 'analitica') = a.is_analytic)
      AND (NOT _only_pending OR a.nature IS NULL OR a.hierarchical_code IS NULL)
      AND (NOT _only_active OR a.is_active)
    ORDER BY coalesce(a.hierarchical_code, 'zzz'), a.reduced_code
    LIMIT greatest(_limit, 1) OFFSET greatest(_offset, 0)
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO _rows
  FROM (
    SELECT b.id, b.reduced_code, b.hierarchical_code, b.name, b.level, b.parent_code,
           b.is_analytic, b.nature, b.link_status, b.is_active, b.updated_at,
           (SELECT count(*) FROM public.journal_legs jl
             WHERE jl.account_reduced_code = b.reduced_code
               AND (_period_id IS NULL OR jl.period_id = _period_id)) AS legs_count
    FROM base b
    ORDER BY coalesce(b.hierarchical_code, 'zzz'), b.reduced_code
  ) x;

  RETURN jsonb_build_object('total', _total, 'rows', _rows);
END $$;

CREATE OR REPLACE FUNCTION public.upsert_ledger_account(
  _id uuid,
  _reduced_code text,
  _hierarchical_code text,
  _name text,
  _is_analytic boolean,
  _nature text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hier text := nullif(trim(coalesce(_hierarchical_code, '')), '');
  _existing public.ledger_accounts;
  _row public.ledger_accounts;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Apenas o Admin pode alterar o plano de contas.'; END IF;
  IF nullif(trim(coalesce(_reduced_code, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o código reduzido.';
  END IF;
  IF nullif(trim(coalesce(_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a descrição da conta.';
  END IF;
  IF _hier IS NOT NULL AND right(_hier, 1) <> '.' THEN _hier := _hier || '.'; END IF;

  IF _id IS NOT NULL THEN
    SELECT * INTO _existing FROM public.ledger_accounts WHERE id = _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.'; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_accounts
              WHERE reduced_code = trim(_reduced_code) AND (_id IS NULL OR id <> _id)) THEN
    RAISE EXCEPTION 'Já existe uma conta com o código reduzido %.', trim(_reduced_code);
  END IF;

  INSERT INTO public.ledger_accounts AS la
    (id, reduced_code, hierarchical_code, name, level, parent_code, is_analytic, nature,
     link_status, is_active, updated_by)
  VALUES
    (coalesce(_id, gen_random_uuid()), trim(_reduced_code), _hier, trim(_name),
     public.hier_level(_hier), public.hier_parent(_hier), coalesce(_is_analytic, true),
     nullif(_nature, ''),
     CASE WHEN _hier IS NOT NULL AND nullif(_nature, '') IS NOT NULL THEN 'confirmado' ELSE 'pendente' END,
     true, auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    reduced_code = excluded.reduced_code,
    hierarchical_code = excluded.hierarchical_code,
    name = excluded.name,
    level = excluded.level,
    parent_code = excluded.parent_code,
    is_analytic = excluded.is_analytic,
    nature = excluded.nature,
    link_status = excluded.link_status,
    updated_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO _row;

  INSERT INTO public.ledger_account_audit
    (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  VALUES ('ledger_account', _row.reduced_code, _row.name,
          CASE WHEN _existing.id IS NULL THEN 'criacao' ELSE 'edicao' END,
          CASE WHEN _existing.id IS NULL THEN NULL
               ELSE coalesce(_existing.hierarchical_code, '—') || ' / ' || coalesce(_existing.nature, '—') END,
          coalesce(_row.hierarchical_code, '—') || ' / ' || coalesce(_row.nature, '—'),
          'manual', auth.uid());

  RETURN to_jsonb(_row);
END $$;

CREATE OR REPLACE FUNCTION public.set_ledger_accounts_nature(
  _ids uuid[],
  _nature text DEFAULT NULL,
  _parent_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _parent text := nullif(trim(coalesce(_parent_code, '')), '');
  _nat text := nullif(trim(coalesce(_nature, '')), '');
  _acc public.ledger_accounts;
  _new_hier text;
  _seq integer;
  _updated integer := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Apenas o Admin pode reclassificar contas.'; END IF;
  IF _nat IS NULL AND _parent IS NULL THEN RAISE EXCEPTION 'Informe a natureza ou o novo grupo.'; END IF;
  IF _parent IS NOT NULL AND right(_parent, 1) <> '.' THEN _parent := _parent || '.'; END IF;

  FOR _acc IN SELECT * FROM public.ledger_accounts WHERE id = ANY(_ids) LOOP
    _new_hier := _acc.hierarchical_code;
    IF _parent IS NOT NULL THEN
      SELECT coalesce(max((regexp_replace(split_part(trim(both '.' from hierarchical_code), '.',
               public.hier_level(hierarchical_code)), '[^0-9]', '', 'g'))::int), 0) + 1
        INTO _seq
        FROM public.ledger_accounts
       WHERE parent_code = _parent;
      _new_hier := _parent || lpad(_seq::text, 5, '0') || '.';
    END IF;

    UPDATE public.ledger_accounts SET
      hierarchical_code = _new_hier,
      level = public.hier_level(_new_hier),
      parent_code = public.hier_parent(_new_hier),
      nature = coalesce(_nat, nature),
      link_status = CASE WHEN _new_hier IS NOT NULL AND coalesce(_nat, nature) IS NOT NULL
                         THEN 'confirmado' ELSE link_status END,
      updated_by = auth.uid(),
      updated_at = now()
    WHERE id = _acc.id;

    INSERT INTO public.ledger_account_audit
      (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    VALUES ('ledger_account', _acc.reduced_code, _acc.name, 'reclassificacao',
            coalesce(_acc.hierarchical_code, '—') || ' / ' || coalesce(_acc.nature, '—'),
            coalesce(_new_hier, '—') || ' / ' || coalesce(_nat, _acc.nature, '—'),
            'manual', auth.uid());
    _updated := _updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', _updated);
END $$;

CREATE OR REPLACE FUNCTION public.set_ledger_account_active(_id uuid, _active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _acc public.ledger_accounts;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Apenas o Admin pode ativar ou desativar contas.'; END IF;
  UPDATE public.ledger_accounts SET is_active = _active, updated_by = auth.uid(), updated_at = now()
   WHERE id = _id RETURNING * INTO _acc;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.'; END IF;

  INSERT INTO public.ledger_account_audit
    (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  VALUES ('ledger_account', _acc.reduced_code, _acc.name, 'situacao',
          CASE WHEN _active THEN 'inativa' ELSE 'ativa' END,
          CASE WHEN _active THEN 'ativa' ELSE 'inativa' END, 'manual', auth.uid());

  RETURN jsonb_build_object('id', _acc.id, 'is_active', _acc.is_active);
END $$;
