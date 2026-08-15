-- ============ 1. Plano de contas unificado (de-para) ============
CREATE TABLE public.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reduced_code text NOT NULL UNIQUE,
  hierarchical_code text,
  name text NOT NULL,
  level int,
  parent_code text,
  is_analytic boolean NOT NULL DEFAULT true,
  nature text,
  link_status text NOT NULL DEFAULT 'pendente',
  confidence numeric,
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_accounts TO authenticated;
GRANT ALL ON public.ledger_accounts TO service_role;
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY la_select ON public.ledger_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY la_insert ON public.ledger_accounts FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY la_update ON public.ledger_accounts FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY la_delete ON public.ledger_accounts FOR DELETE TO authenticated USING (public.is_admin());
CREATE TRIGGER trg_ledger_accounts_updated_at BEFORE UPDATE ON public.ledger_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_ledger_accounts_hier ON public.ledger_accounts (hierarchical_code);

-- ============ 2. Espelho do balancete ============
CREATE TABLE public.trial_balance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.imported_files(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  level int NOT NULL DEFAULT 1,
  is_analytic boolean NOT NULL DEFAULT false,
  saldo_anterior numeric NOT NULL DEFAULT 0,
  debito numeric NOT NULL DEFAULT 0,
  credito numeric NOT NULL DEFAULT 0,
  saldo_atual numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trial_balance_lines TO authenticated;
GRANT ALL ON public.trial_balance_lines TO service_role;
ALTER TABLE public.trial_balance_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tbl_select ON public.trial_balance_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY tbl_insert ON public.trial_balance_lines FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY tbl_update ON public.trial_balance_lines FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY tbl_delete ON public.trial_balance_lines FOR DELETE TO authenticated USING (public.is_admin());
CREATE TRIGGER trg_tbl_updated_at BEFORE UPDATE ON public.trial_balance_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ 3. Pernas de lançamento do razão ============
CREATE TABLE public.journal_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.imported_files(id) ON DELETE CASCADE,
  account_reduced_code text NOT NULL,
  account_id uuid REFERENCES public.ledger_accounts(id) ON DELETE SET NULL,
  counterpart_reduced_code text,
  doc_number text,
  entry_date date,
  historico text,
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  running_balance numeric,
  line_no int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_legs TO authenticated;
GRANT ALL ON public.journal_legs TO service_role;
ALTER TABLE public.journal_legs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jl_select ON public.journal_legs FOR SELECT TO authenticated USING (true);
CREATE POLICY jl_insert ON public.journal_legs FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY jl_update ON public.journal_legs FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY jl_delete ON public.journal_legs FOR DELETE TO authenticated USING (public.is_admin());
CREATE INDEX idx_jl_period_account ON public.journal_legs (period_id, account_reduced_code);
CREATE INDEX idx_jl_period_doc ON public.journal_legs (period_id, doc_number);
CREATE INDEX idx_jl_file ON public.journal_legs (file_id);
CREATE INDEX idx_jl_account_id ON public.journal_legs (account_id);

-- ============ 4. Saldos anteriores por conta/período (vindos do razão) ============
CREATE TABLE public.journal_account_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  account_reduced_code text NOT NULL,
  account_name text NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, account_reduced_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_account_openings TO authenticated;
GRANT ALL ON public.journal_account_openings TO service_role;
ALTER TABLE public.journal_account_openings ENABLE ROW LEVEL SECURITY;
CREATE POLICY jao_select ON public.journal_account_openings FOR SELECT TO authenticated USING (true);
CREATE POLICY jao_insert ON public.journal_account_openings FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY jao_update ON public.journal_account_openings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY jao_delete ON public.journal_account_openings FOR DELETE TO authenticated USING (public.is_admin());

-- ============ 5. Normalização de nome ============
CREATE OR REPLACE FUNCTION public.norm_account_name(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  select regexp_replace(
           upper(translate(coalesce(_name,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^A-Z0-9]', '', 'g')
$$;

-- ============ 6. Natureza a partir do código hierárquico ============
CREATE OR REPLACE FUNCTION public.nature_from_code(_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  select case
    when _code like '1.01%' then 'ativo_circulante'
    when _code like '1.02%' then 'ativo_nao_circulante'
    when _code like '1%'    then 'ativo_circulante'
    when _code like '2.01%' then 'passivo_circulante'
    when _code like '2.02%' then 'passivo_nao_circulante'
    when _code like '2.03%' then 'patrimonio_liquido'
    when _code like '2%'    then 'passivo_circulante'
    when _code like '3.01%' then 'custo'
    when _code like '3%'    then 'despesa'
    when _code like '4%'    then 'receita'
    else null end
$$;

-- ============ 7. Carga do espelho do balancete ============
CREATE OR REPLACE FUNCTION public.import_trial_balance_lines(_file_id uuid, _lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_period uuid; v_count int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  select period_id into v_period from public.imported_files where id = _file_id;
  if v_period is null then raise exception 'Arquivo não encontrado.'; end if;

  insert into public.trial_balance_lines
    (period_id, file_id, code, name, level, is_analytic, saldo_anterior, debito, credito, saldo_atual)
  select v_period, _file_id,
         btrim(el.value->>'code'),
         btrim(el.value->>'name'),
         coalesce((el.value->>'level')::int, 1),
         coalesce((el.value->>'is_analytic')::boolean, false),
         coalesce((el.value->>'saldo_anterior')::numeric, 0),
         coalesce((el.value->>'debito')::numeric, 0),
         coalesce((el.value->>'credito')::numeric, 0),
         coalesce((el.value->>'saldo_atual')::numeric, 0)
  from jsonb_array_elements(_lines) as el(value)
  where btrim(coalesce(el.value->>'code','')) <> ''
  on conflict (period_id, code) do update
    set name = excluded.name, level = excluded.level, is_analytic = excluded.is_analytic,
        saldo_anterior = excluded.saldo_anterior, debito = excluded.debito,
        credito = excluded.credito, saldo_atual = excluded.saldo_atual,
        file_id = excluded.file_id, updated_at = now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('lines', v_count);
end $$;

-- ============ 8. Carga do razão (em blocos) ============
CREATE OR REPLACE FUNCTION public.import_journal_legs(_file_id uuid, _legs jsonb, _reset boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_period uuid; v_inserted int := 0; v_accounts int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  select period_id into v_period from public.imported_files where id = _file_id;
  if v_period is null then raise exception 'Arquivo não encontrado.'; end if;

  if _reset then
    delete from public.journal_legs where file_id = _file_id;
    delete from public.journal_account_openings where period_id = v_period;
  end if;

  -- contas novas do razão
  with novas as (
    select distinct btrim(el.value->>'account_reduced_code') as rc,
           btrim(el.value->>'account_name') as nm
    from jsonb_array_elements(_legs) as el(value)
    where btrim(coalesce(el.value->>'account_reduced_code','')) <> ''
  ), ins as (
    insert into public.ledger_accounts (reduced_code, name)
    select rc, coalesce(nullif(nm,''), rc) from novas
    on conflict (reduced_code) do nothing
    returning 1
  )
  select count(*) into v_accounts from ins;

  -- saldos anteriores
  insert into public.journal_account_openings (period_id, account_reduced_code, account_name, opening_balance)
  select v_period, btrim(el.value->>'account_reduced_code'),
         coalesce(nullif(btrim(el.value->>'account_name'),''), btrim(el.value->>'account_reduced_code')),
         coalesce((el.value->>'opening_balance')::numeric, 0)
  from jsonb_array_elements(_legs) as el(value)
  where btrim(coalesce(el.value->>'account_reduced_code','')) <> ''
    and (el.value->>'opening_balance') is not null
  on conflict (period_id, account_reduced_code) do update
    set opening_balance = excluded.opening_balance, account_name = excluded.account_name;

  -- pernas
  with ins as (
    insert into public.journal_legs
      (period_id, file_id, account_reduced_code, account_id, counterpart_reduced_code,
       doc_number, entry_date, historico, debit, credit, running_balance, line_no)
    select v_period, _file_id,
           btrim(el.value->>'account_reduced_code'),
           a.id,
           nullif(btrim(coalesce(el.value->>'counterpart_reduced_code','')), ''),
           nullif(btrim(coalesce(el.value->>'doc_number','')), ''),
           nullif(el.value->>'entry_date','')::date,
           nullif(btrim(coalesce(el.value->>'historico','')), ''),
           coalesce((el.value->>'debit')::numeric, 0),
           coalesce((el.value->>'credit')::numeric, 0),
           nullif(el.value->>'running_balance','')::numeric,
           (el.value->>'line_no')::int
    from jsonb_array_elements(_legs) as el(value)
    left join public.ledger_accounts a on a.reduced_code = btrim(el.value->>'account_reduced_code')
    where btrim(coalesce(el.value->>'account_reduced_code','')) <> ''
      and (coalesce((el.value->>'debit')::numeric,0) <> 0 or coalesce((el.value->>'credit')::numeric,0) <> 0)
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'new_accounts', v_accounts);
end $$;

-- ============ 9. Casamento reduzido -> hierárquico ============
CREATE OR REPLACE FUNCTION public.link_reduced_accounts(_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_by_value int := 0; v_by_name int := 0; v_pending int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  -- movimento do razão por conta no período
  create temp table _mov on commit drop as
  select l.account_reduced_code as rc,
         max(a.name) as nm,
         sum(l.debit) as deb,
         sum(l.credit) as cred
  from public.journal_legs l
  join public.ledger_accounts a on a.id = l.account_id
  where l.period_id = _period_id
  group by l.account_reduced_code;

  -- contas analíticas do balancete ainda não usadas
  create temp table _tb on commit drop as
  select t.code, t.name, t.debito, t.credito
  from public.trial_balance_lines t
  where t.period_id = _period_id and t.is_analytic;

  -- 1) casamento por nome normalizado (único dos dois lados)
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on public.norm_account_name(t.name) = public.norm_account_name(m.nm)
  ), ok as (
    select rc, code from cand where per_rc = 1 and per_code = 1
  ), upd as (
    update public.ledger_accounts a
       set hierarchical_code = ok.code,
           nature = coalesce(a.nature, public.nature_from_code(ok.code)),
           link_status = 'confirmado',
           confidence = 1,
           level = array_length(string_to_array(ok.code, '.'), 1),
           parent_code = nullif(regexp_replace(ok.code, '\.[^.]+$', ''), ok.code)
      from ok
     where a.reduced_code = ok.rc
       and (a.hierarchical_code is distinct from ok.code)
       and a.link_status <> 'confirmado_manual'
    returning 1
  )
  select count(*) into v_by_name from upd;

  -- 2) casamento por confronto de débito/crédito (valores únicos e não nulos)
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on round(t.debito,2) = round(m.deb,2) and round(t.credito,2) = round(m.cred,2)
    where (m.deb <> 0 or m.cred <> 0)
      and not exists (
        select 1 from public.ledger_accounts a
        where a.reduced_code = m.rc and a.hierarchical_code is not null)
      and not exists (
        select 1 from public.ledger_accounts a2 where a2.hierarchical_code = t.code)
  ), ok as (
    select rc, code from cand where per_rc = 1 and per_code = 1
  ), upd as (
    update public.ledger_accounts a
       set hierarchical_code = ok.code,
           nature = coalesce(a.nature, public.nature_from_code(ok.code)),
           link_status = 'sugerido',
           confidence = 0.8,
           level = array_length(string_to_array(ok.code, '.'), 1),
           parent_code = nullif(regexp_replace(ok.code, '\.[^.]+$', ''), ok.code)
      from ok
     where a.reduced_code = ok.rc
    returning 1
  )
  select count(*) into v_by_value from upd;

  select count(*) into v_pending
  from public.ledger_accounts a
  where exists (select 1 from _mov m where m.rc = a.reduced_code)
    and (a.hierarchical_code is null or a.nature is null);

  return jsonb_build_object('by_name', v_by_name, 'by_value', v_by_value, 'pending', v_pending);
end $$;

-- ============ 10. Conferência razão x balancete ============
CREATE OR REPLACE FUNCTION public.reconcile_journal_vs_trial_balance(_period_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  with mov as (
    select a.reduced_code, a.name, a.hierarchical_code,
           sum(l.debit) as deb, sum(l.credit) as cred
    from public.journal_legs l
    join public.ledger_accounts a on a.id = l.account_id
    where l.period_id = _period_id
    group by a.reduced_code, a.name, a.hierarchical_code
  ), tb as (
    select code, name, debito, credito
    from public.trial_balance_lines
    where period_id = _period_id and is_analytic
  ), j as (
    select coalesce(m.reduced_code, '-') as reduced_code,
           coalesce(m.name, t.name) as name,
           coalesce(m.hierarchical_code, t.code) as code,
           coalesce(m.deb,0) as razao_debito,
           coalesce(m.cred,0) as razao_credito,
           t.debito as balancete_debito,
           t.credito as balancete_credito,
           case when m.reduced_code is null then 'so_balancete'
                when t.code is null then 'so_razao'
                when round(coalesce(m.deb,0),2) <> round(t.debito,2)
                  or round(coalesce(m.cred,0),2) <> round(t.credito,2) then 'divergente'
                else 'ok' end as status
    from mov m
    full outer join tb t on t.code = m.hierarchical_code
  )
  select jsonb_build_object(
    'total', (select count(*) from j),
    'ok', (select count(*) from j where status = 'ok'),
    'divergente', (select count(*) from j where status = 'divergente'),
    'so_razao', (select count(*) from j where status = 'so_razao'),
    'so_balancete', (select count(*) from j where status = 'so_balancete'),
    'linhas', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from j where status <> 'ok' order by status, code nulls last limit 500
      ) x), '[]'::jsonb)
  );
$$;

-- ============ 11. Extrato de uma conta do razão ============
CREATE OR REPLACE FUNCTION public.journal_account_statement(_period_id uuid, _reduced_code text, _limit int DEFAULT 500, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select jsonb_build_object(
    'account', (select to_jsonb(a) from public.ledger_accounts a where a.reduced_code = _reduced_code),
    'opening_balance', coalesce((select o.opening_balance from public.journal_account_openings o
        where o.period_id = _period_id and o.account_reduced_code = _reduced_code), 0),
    'total_debit', coalesce((select sum(debit) from public.journal_legs
        where period_id = _period_id and account_reduced_code = _reduced_code), 0),
    'total_credit', coalesce((select sum(credit) from public.journal_legs
        where period_id = _period_id and account_reduced_code = _reduced_code), 0),
    'count', coalesce((select count(*) from public.journal_legs
        where period_id = _period_id and account_reduced_code = _reduced_code), 0),
    'legs', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select l.id, l.doc_number, l.entry_date, l.historico, l.debit, l.credit,
               l.running_balance, l.counterpart_reduced_code,
               c.name as counterpart_name, c.hierarchical_code as counterpart_code
        from public.journal_legs l
        left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
        where l.period_id = _period_id and l.account_reduced_code = _reduced_code
        order by l.entry_date nulls last, l.line_no
        limit _limit offset _offset
      ) x), '[]'::jsonb)
  );
$$;

-- ============ 12. Lançamento completo (todas as pernas) ============
CREATE OR REPLACE FUNCTION public.journal_document(_period_id uuid, _doc_number text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select jsonb_build_object(
    'doc_number', _doc_number,
    'total_debit', coalesce((select sum(debit) from public.journal_legs where period_id = _period_id and doc_number = _doc_number), 0),
    'total_credit', coalesce((select sum(credit) from public.journal_legs where period_id = _period_id and doc_number = _doc_number), 0),
    'legs', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select l.id, l.entry_date, l.historico, l.debit, l.credit,
               l.account_reduced_code, a.name as account_name, a.hierarchical_code as account_code,
               l.counterpart_reduced_code, c.name as counterpart_name
        from public.journal_legs l
        left join public.ledger_accounts a on a.id = l.account_id
        left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
        where l.period_id = _period_id and l.doc_number = _doc_number
        order by l.debit desc
      ) x), '[]'::jsonb)
  );
$$;

-- ============ 13. Aplicar vínculo manualmente ============
CREATE OR REPLACE FUNCTION public.set_account_link(_reduced_code text, _hierarchical_code text, _nature text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  update public.ledger_accounts
     set hierarchical_code = coalesce(nullif(_hierarchical_code,''), hierarchical_code),
         nature = coalesce(nullif(_nature,''), nature, public.nature_from_code(_hierarchical_code)),
         link_status = 'confirmado_manual',
         confidence = 1,
         level = array_length(string_to_array(coalesce(nullif(_hierarchical_code,''), hierarchical_code), '.'), 1),
         updated_by = auth.uid()
   where reduced_code = _reduced_code;
  if not found then raise exception 'Conta não encontrada.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============ 14. Indicadores e demonstrativos preferindo o razão ============
CREATE OR REPLACE FUNCTION public.recalculate_period_indicators_internal(_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_caixa numeric := 0; v_margem numeric := 0; v_ebitda numeric := 0; v_liquido numeric := 0;
  v_has_journal boolean;
begin
  select exists (select 1 from public.journal_legs where period_id = _period_id) into v_has_journal;

  if v_has_journal then
    select
      coalesce(sum(l.credit - l.debit) filter (where a.nature = 'receita'), 0),
      coalesce(sum(l.debit - l.credit) filter (where a.nature = 'custo'), 0),
      coalesce(sum(l.debit - l.credit) filter (where a.nature = 'despesa'), 0)
    into v_receita, v_custo, v_despesa
    from public.journal_legs l
    join public.ledger_accounts a on a.id = l.account_id
    where l.period_id = _period_id;

    select coalesce(sum(coalesce(o.opening_balance,0) + coalesce(m.deb,0) - coalesce(m.cred,0)), 0)
      into v_caixa
    from public.ledger_accounts a
    left join public.journal_account_openings o
      on o.period_id = _period_id and o.account_reduced_code = a.reduced_code
    left join (
      select account_reduced_code, sum(debit) deb, sum(credit) cred
      from public.journal_legs where period_id = _period_id
      group by account_reduced_code
    ) m on m.account_reduced_code = a.reduced_code
    where a.nature = 'ativo_circulante'
      and (a.name ilike '%caixa%' or a.name ilike '%banco%' or a.name ilike '%aplica%');
  else
    select
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'receita'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'custo'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'despesa'), 0),
      coalesce(sum(coalesce(e.reviewed_value, e.raw_value)) filter (
        where e.nature = 'ativo_circulante'
          and (e.source_account_name ilike '%caixa%' or e.source_account_name ilike '%banco%' or e.source_account_name ilike '%aplica%')
      ), 0)
    into v_receita, v_custo, v_despesa, v_caixa
    from public.ledger_entries e
    where e.period_id = _period_id;
  end if;

  v_ebitda := v_receita - v_custo - v_despesa;
  v_liquido := v_ebitda;
  if v_receita <> 0 then v_margem := ((v_receita - v_custo) / v_receita) * 100; end if;

  insert into public.dashboard_indicators (period_id, indicator_key, indicator_value, calculated_at)
  values
    (_period_id, 'receita_total', v_receita, now()),
    (_period_id, 'custo_total', v_custo, now()),
    (_period_id, 'margem_bruta', v_margem, now()),
    (_period_id, 'ebitda', v_ebitda, now()),
    (_period_id, 'resultado_liquido', v_liquido, now()),
    (_period_id, 'posicao_caixa', v_caixa, now())
  on conflict (period_id, indicator_key)
  do update set indicator_value = excluded.indicator_value, calculated_at = now();

  update public.accounting_periods set last_recalculated_at = now() where id = _period_id;

  return jsonb_build_object(
    'source', case when v_has_journal then 'razao' else 'balancete' end,
    'receita_total', v_receita, 'custo_total', v_custo, 'margem_bruta', v_margem,
    'ebitda', v_ebitda, 'resultado_liquido', v_liquido, 'posicao_caixa', v_caixa
  );
end $$;

CREATE OR REPLACE FUNCTION public.generate_period_statements(_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_user uuid := auth.uid();
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_ac numeric := 0; v_anc numeric := 0; v_pc numeric := 0; v_pnc numeric := 0; v_pl numeric := 0;
  v_lucro_bruto numeric; v_resultado numeric;
  v_dre jsonb; v_bp jsonb; v_fc jsonb;
  v_has_journal boolean; v_source text;
begin
  if v_user is null then
    select id into v_user from public.profiles
     where role = 'admin' and is_active = true order by created_at limit 1;
  end if;
  if v_user is null then raise exception 'Nenhum administrador ativo para registrar a geração.'; end if;

  select exists (select 1 from public.journal_legs where period_id = _period_id) into v_has_journal;
  v_source := case when v_has_journal then 'razao' else 'balancete' end;

  if v_has_journal then
    with saldo as (
      select a.nature,
             coalesce(o.opening_balance,0) + coalesce(m.deb,0) - coalesce(m.cred,0) as saldo,
             coalesce(m.deb,0) as deb, coalesce(m.cred,0) as cred
      from public.ledger_accounts a
      left join public.journal_account_openings o
        on o.period_id = _period_id and o.account_reduced_code = a.reduced_code
      left join (
        select account_reduced_code, sum(debit) deb, sum(credit) cred
        from public.journal_legs where period_id = _period_id group by account_reduced_code
      ) m on m.account_reduced_code = a.reduced_code
      where coalesce(m.deb,0) <> 0 or coalesce(m.cred,0) <> 0 or coalesce(o.opening_balance,0) <> 0
    )
    select
      coalesce(sum(cred - deb) filter (where nature = 'receita'), 0),
      coalesce(sum(deb - cred) filter (where nature = 'custo'), 0),
      coalesce(sum(deb - cred) filter (where nature = 'despesa'), 0),
      coalesce(sum(saldo) filter (where nature = 'ativo_circulante'), 0),
      coalesce(sum(saldo) filter (where nature = 'ativo_nao_circulante'), 0),
      coalesce(sum(-saldo) filter (where nature = 'passivo_circulante'), 0),
      coalesce(sum(-saldo) filter (where nature = 'passivo_nao_circulante'), 0),
      coalesce(sum(-saldo) filter (where nature = 'patrimonio_liquido'), 0)
    into v_receita, v_custo, v_despesa, v_ac, v_anc, v_pc, v_pnc, v_pl
    from saldo;
  else
    select
      coalesce(sum(case when nature = 'receita' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'custo' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'despesa' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'ativo_circulante' then coalesce(reviewed_value, raw_value) end), 0),
      coalesce(sum(case when nature = 'ativo_nao_circulante' then coalesce(reviewed_value, raw_value) end), 0),
      coalesce(sum(case when nature = 'passivo_circulante' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'passivo_nao_circulante' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'patrimonio_liquido' then abs(coalesce(reviewed_value, raw_value)) end), 0)
    into v_receita, v_custo, v_despesa, v_ac, v_anc, v_pc, v_pnc, v_pl
    from public.ledger_entries where period_id = _period_id;
  end if;

  v_lucro_bruto := v_receita - v_custo;
  v_resultado := v_lucro_bruto - v_despesa;

  v_dre := jsonb_build_object('titulo', 'Demonstração do Resultado do Exercício', 'fonte', v_source,
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Receita bruta','value',v_receita,'kind','item'),
      jsonb_build_object('label','Custo dos produtos vendidos','value',-v_custo,'kind','item'),
      jsonb_build_object('label','Lucro bruto','value',v_lucro_bruto,'kind','subtotal'),
      jsonb_build_object('label','Despesas operacionais','value',-v_despesa,'kind','item'),
      jsonb_build_object('label','Resultado líquido','value',v_resultado,'kind','total')));

  v_bp := jsonb_build_object('titulo', 'Balanço Patrimonial', 'fonte', v_source,
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Ativo circulante','value',v_ac,'kind','item'),
      jsonb_build_object('label','Ativo não circulante','value',v_anc,'kind','item'),
      jsonb_build_object('label','Total do ativo','value',v_ac + v_anc,'kind','total'),
      jsonb_build_object('label','Passivo circulante','value',v_pc,'kind','item'),
      jsonb_build_object('label','Passivo não circulante','value',v_pnc,'kind','item'),
      jsonb_build_object('label','Patrimônio líquido','value',v_pl,'kind','item'),
      jsonb_build_object('label','Total do passivo + PL','value',v_pc + v_pnc + v_pl,'kind','total')));

  v_fc := jsonb_build_object('titulo', 'Fluxo de Caixa', 'fonte', v_source,
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Resultado líquido do período','value',v_resultado,'kind','item'),
      jsonb_build_object('label','Recebimentos (receitas)','value',v_receita,'kind','item'),
      jsonb_build_object('label','Pagamentos (custos e despesas)','value',-(v_custo + v_despesa),'kind','item'),
      jsonb_build_object('label','Posição de caixa (ativo circulante)','value',v_ac,'kind','total')));

  insert into public.financial_statements (period_id, statement_type, content, generated_by, generated_at)
  values (_period_id,'dre',v_dre,v_user,now()),
         (_period_id,'balanco_patrimonial',v_bp,v_user,now()),
         (_period_id,'fluxo_de_caixa',v_fc,v_user,now())
  on conflict (period_id, statement_type)
  do update set content = excluded.content, generated_by = excluded.generated_by, generated_at = now();

  return jsonb_build_object('fonte', v_source, 'dre', v_dre, 'balanco_patrimonial', v_bp, 'fluxo_de_caixa', v_fc);
end $$;