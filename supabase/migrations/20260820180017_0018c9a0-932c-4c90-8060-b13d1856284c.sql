
create or replace function public.indicator_components(_period_id uuid)
returns table(
  component_key text,
  basis text,
  reduced_code text,
  account_name text,
  hierarchical_code text,
  nature text,
  value numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with b as (select * from public.period_account_balances(_period_id)),
  c as (
    -- movimento do período (sem encerramento)
    select 'receita'::text k, 'movimento'::text bs, b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           (b.credit_mov - b.debit_mov) v
      from b where b.nature = 'receita'
    union all
    select 'custo', 'movimento', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           (b.debit_mov - b.credit_mov) from b where b.nature = 'custo'
    union all
    select 'despesa', 'movimento', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           (b.debit_mov - b.credit_mov) from b where b.nature = 'despesa'
    -- saldos (normalizados: devedoras positivas no ativo, credoras positivas no passivo/PL)
    union all
    select 'ativo_circulante', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           b.closing_balance from b where b.nature = 'ativo_circulante'
    union all
    select 'ativo_nao_circulante', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           b.closing_balance from b where b.nature = 'ativo_nao_circulante'
    union all
    select 'caixa', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           b.closing_balance from b
      where b.nature = 'ativo_circulante'
        and (public.txt_norm(b.account_name) like '%caixa%'
          or public.txt_norm(b.account_name) like '%banco%'
          or public.txt_norm(b.account_name) like '%aplica%')
    union all
    select 'estoques', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           b.closing_balance from b
      where b.nature = 'ativo_circulante' and public.txt_norm(b.account_name) like '%estoque%'
    union all
    select 'clientes', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           b.closing_balance from b
      where b.nature = 'ativo_circulante'
        and (public.txt_norm(b.account_name) like '%client%'
          or public.txt_norm(b.account_name) like '%duplicatas a receber%'
          or public.txt_norm(b.account_name) like '%contas a receber%')
    union all
    select 'passivo_circulante', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           -b.closing_balance from b where b.nature = 'passivo_circulante'
    union all
    select 'passivo_nao_circulante', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           -b.closing_balance from b where b.nature = 'passivo_nao_circulante'
    union all
    select 'fornecedores', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           -b.closing_balance from b
      where b.nature = 'passivo_circulante'
        and (public.txt_norm(b.account_name) like '%fornecedor%'
          or public.txt_norm(b.account_name) like '%contas a pagar%')
    union all
    select 'patrimonio_liquido', 'saldo', b.reduced_code, b.account_name, b.hierarchical_code, b.nature,
           -b.closing_balance from b where b.nature = 'patrimonio_liquido'
  )
  select k, bs, reduced_code, account_name, hierarchical_code, nature, v
  from c
  where v <> 0
$$;

grant execute on function public.indicator_components(uuid) to authenticated, service_role;

create or replace function public.indicator_formulas()
returns jsonb
language sql
immutable
as $$
select '{
  "receita_total":       {"label":"Receita total","formula":"Σ movimento das contas de receita","kind":"currency","components":["receita"]},
  "custo_total":         {"label":"Custo total","formula":"Σ movimento das contas de custo","kind":"currency","components":["custo"]},
  "despesa_total":       {"label":"Despesa total","formula":"Σ movimento das contas de despesa","kind":"currency","components":["despesa"]},
  "margem_bruta":        {"label":"Margem bruta","formula":"(Receita − Custo) ÷ Receita × 100","kind":"percent","components":["receita","custo"]},
  "ebitda":              {"label":"EBITDA","formula":"Receita − Custo − Despesa","kind":"currency","components":["receita","custo","despesa"]},
  "resultado_liquido":   {"label":"Resultado líquido","formula":"Receita − Custo − Despesa","kind":"currency","components":["receita","custo","despesa"]},
  "margem_liquida":      {"label":"Margem líquida","formula":"Resultado líquido ÷ Receita × 100","kind":"percent","components":["receita","custo","despesa"]},
  "margem_ebitda":       {"label":"Margem EBITDA","formula":"EBITDA ÷ Receita × 100","kind":"percent","components":["receita","custo","despesa"]},
  "posicao_caixa":       {"label":"Posição de caixa","formula":"Σ saldo das contas de caixa, bancos e aplicações","kind":"currency","components":["caixa"]},
  "ativo_total":         {"label":"Ativo total","formula":"Ativo circulante + Ativo não circulante","kind":"currency","components":["ativo_circulante","ativo_nao_circulante"]},
  "capital_giro":        {"label":"Capital de giro","formula":"Ativo circulante − Passivo circulante","kind":"currency","components":["ativo_circulante","passivo_circulante"]},
  "liquidez_corrente":   {"label":"Liquidez corrente","formula":"Ativo circulante ÷ Passivo circulante","kind":"ratio","components":["ativo_circulante","passivo_circulante"]},
  "liquidez_seca":       {"label":"Liquidez seca","formula":"(Ativo circulante − Estoques) ÷ Passivo circulante","kind":"ratio","components":["ativo_circulante","estoques","passivo_circulante"]},
  "liquidez_imediata":   {"label":"Liquidez imediata","formula":"Caixa e equivalentes ÷ Passivo circulante","kind":"ratio","components":["caixa","passivo_circulante"]},
  "endividamento_geral": {"label":"Endividamento geral","formula":"(Passivo circulante + Passivo não circulante) ÷ Ativo total × 100","kind":"percent","components":["passivo_circulante","passivo_nao_circulante","ativo_circulante","ativo_nao_circulante"]},
  "endividamento_pl":    {"label":"Endividamento sobre PL","formula":"(Passivo circulante + Passivo não circulante) ÷ Patrimônio líquido","kind":"ratio","components":["passivo_circulante","passivo_nao_circulante","patrimonio_liquido"]},
  "giro_ativo":          {"label":"Giro do ativo","formula":"Receita ÷ Ativo total","kind":"ratio","components":["receita","ativo_circulante","ativo_nao_circulante"]},
  "giro_estoque":        {"label":"Giro do estoque","formula":"Custo ÷ Estoques","kind":"ratio","components":["custo","estoques"]},
  "pmr":                 {"label":"Prazo médio de recebimento","formula":"Clientes ÷ Receita × 30 (dias)","kind":"days","components":["clientes","receita"]},
  "pmp":                 {"label":"Prazo médio de pagamento","formula":"Fornecedores ÷ Custo × 30 (dias)","kind":"days","components":["fornecedores","custo"]}
}'::jsonb
$$;

grant execute on function public.indicator_formulas() to authenticated, anon, service_role;

create or replace function public.indicator_drilldown(_period_id uuid, _indicator_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_meta jsonb;
  v_keys text[];
  v_result jsonb;
begin
  v_meta := public.indicator_formulas() -> _indicator_key;
  if v_meta is null then
    raise exception 'Indicador desconhecido: %', _indicator_key;
  end if;

  select coalesce(array_agg(x), '{}') into v_keys
  from jsonb_array_elements_text(v_meta -> 'components') x;

  select jsonb_build_object(
    'indicator_key', _indicator_key,
    'label', v_meta ->> 'label',
    'formula', v_meta ->> 'formula',
    'kind', v_meta ->> 'kind',
    'source', case when exists (
        select 1 from public.journal_legs
        where period_id = _period_id and status = 'ativo'
      ) then 'razao' else 'balancete' end,
    'components', coalesce(
      (
        select jsonb_agg(comp order by comp ->> 'component_key')
        from (
          select jsonb_build_object(
            'component_key', c.component_key,
            'basis', min(c.basis),
            'total', sum(c.value),
            'accounts', jsonb_agg(
              jsonb_build_object(
                'reduced_code', c.reduced_code,
                'account_name', c.account_name,
                'hierarchical_code', c.hierarchical_code,
                'nature', c.nature,
                'value', c.value
              ) order by abs(c.value) desc
            )
          ) comp
          from public.indicator_components(_period_id) c
          where c.component_key = any(v_keys)
          group by c.component_key
        ) s
      ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

grant execute on function public.indicator_drilldown(uuid, text) to authenticated, service_role;

create or replace function public.recalculate_period_indicators_internal(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_caixa numeric := 0; v_margem numeric := 0; v_ebitda numeric := 0; v_liquido numeric := 0;
  v_ac numeric := 0; v_anc numeric := 0; v_pc numeric := 0; v_pnc numeric := 0;
  v_pl numeric := 0; v_estoques numeric := 0; v_clientes numeric := 0; v_fornec numeric := 0;
  v_ativo numeric := 0;
  v_has_journal boolean;
begin
  select exists (select 1 from public.journal_legs where period_id = _period_id and status = 'ativo')
    into v_has_journal;

  if v_has_journal then
    select
      coalesce(sum(value) filter (where component_key = 'receita'), 0),
      coalesce(sum(value) filter (where component_key = 'custo'), 0),
      coalesce(sum(value) filter (where component_key = 'despesa'), 0),
      coalesce(sum(value) filter (where component_key = 'caixa'), 0),
      coalesce(sum(value) filter (where component_key = 'ativo_circulante'), 0),
      coalesce(sum(value) filter (where component_key = 'ativo_nao_circulante'), 0),
      coalesce(sum(value) filter (where component_key = 'passivo_circulante'), 0),
      coalesce(sum(value) filter (where component_key = 'passivo_nao_circulante'), 0),
      coalesce(sum(value) filter (where component_key = 'patrimonio_liquido'), 0),
      coalesce(sum(value) filter (where component_key = 'estoques'), 0),
      coalesce(sum(value) filter (where component_key = 'clientes'), 0),
      coalesce(sum(value) filter (where component_key = 'fornecedores'), 0)
    into v_receita, v_custo, v_despesa, v_caixa, v_ac, v_anc, v_pc, v_pnc, v_pl,
         v_estoques, v_clientes, v_fornec
    from public.indicator_components(_period_id);
  else
    select
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'receita'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'custo'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'despesa'), 0),
      coalesce(sum(coalesce(e.reviewed_value, e.raw_value)) filter (
        where e.nature = 'ativo_circulante'
          and (e.source_account_name ilike '%caixa%' or e.source_account_name ilike '%banco%' or e.source_account_name ilike '%aplica%')
      ), 0),
      coalesce(sum(coalesce(e.reviewed_value, e.raw_value)) filter (where e.nature = 'ativo_circulante'), 0),
      coalesce(sum(coalesce(e.reviewed_value, e.raw_value)) filter (where e.nature = 'ativo_nao_circulante'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'passivo_circulante'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'passivo_nao_circulante'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'patrimonio_liquido'), 0)
    into v_receita, v_custo, v_despesa, v_caixa, v_ac, v_anc, v_pc, v_pnc, v_pl
    from public.ledger_entries e
    where e.period_id = _period_id;
  end if;

  v_ebitda := v_receita - v_custo - v_despesa;
  v_liquido := v_ebitda;
  v_ativo := v_ac + v_anc;
  if v_receita <> 0 then v_margem := ((v_receita - v_custo) / v_receita) * 100; end if;

  insert into public.dashboard_indicators (period_id, indicator_key, indicator_value, calculated_at)
  values
    (_period_id, 'receita_total', v_receita, now()),
    (_period_id, 'custo_total', v_custo, now()),
    (_period_id, 'despesa_total', v_despesa, now()),
    (_period_id, 'margem_bruta', v_margem, now()),
    (_period_id, 'ebitda', v_ebitda, now()),
    (_period_id, 'resultado_liquido', v_liquido, now()),
    (_period_id, 'posicao_caixa', v_caixa, now()),
    (_period_id, 'ativo_total', v_ativo, now()),
    (_period_id, 'capital_giro', v_ac - v_pc, now()),
    (_period_id, 'margem_liquida', case when v_receita <> 0 then (v_liquido / v_receita) * 100 else 0 end, now()),
    (_period_id, 'margem_ebitda', case when v_receita <> 0 then (v_ebitda / v_receita) * 100 else 0 end, now()),
    (_period_id, 'liquidez_corrente', case when v_pc <> 0 then v_ac / v_pc else 0 end, now()),
    (_period_id, 'liquidez_seca', case when v_pc <> 0 then (v_ac - v_estoques) / v_pc else 0 end, now()),
    (_period_id, 'liquidez_imediata', case when v_pc <> 0 then v_caixa / v_pc else 0 end, now()),
    (_period_id, 'endividamento_geral', case when v_ativo <> 0 then ((v_pc + v_pnc) / v_ativo) * 100 else 0 end, now()),
    (_period_id, 'endividamento_pl', case when v_pl <> 0 then (v_pc + v_pnc) / v_pl else 0 end, now()),
    (_period_id, 'giro_ativo', case when v_ativo <> 0 then v_receita / v_ativo else 0 end, now()),
    (_period_id, 'giro_estoque', case when v_estoques <> 0 then v_custo / v_estoques else 0 end, now()),
    (_period_id, 'pmr', case when v_receita <> 0 then (v_clientes / v_receita) * 30 else 0 end, now()),
    (_period_id, 'pmp', case when v_custo <> 0 then (v_fornec / v_custo) * 30 else 0 end, now())
  on conflict (period_id, indicator_key)
  do update set indicator_value = excluded.indicator_value, calculated_at = now();

  update public.accounting_periods set last_recalculated_at = now() where id = _period_id;

  return jsonb_build_object(
    'source', case when v_has_journal then 'razao' else 'balancete' end,
    'receita_total', v_receita, 'custo_total', v_custo, 'despesa_total', v_despesa,
    'margem_bruta', v_margem, 'ebitda', v_ebitda, 'resultado_liquido', v_liquido,
    'posicao_caixa', v_caixa, 'ativo_total', v_ativo
  );
end $$;
