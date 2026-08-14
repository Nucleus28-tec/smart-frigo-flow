create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Permitir geração de demonstrativos em contexto automático (cron), sem auth.uid()
CREATE OR REPLACE FUNCTION public.generate_period_statements(_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_receita numeric := 0;
  v_custo numeric := 0;
  v_despesa numeric := 0;
  v_ac numeric := 0;
  v_anc numeric := 0;
  v_pc numeric := 0;
  v_pnc numeric := 0;
  v_pl numeric := 0;
  v_lucro_bruto numeric;
  v_resultado numeric;
  v_dre jsonb;
  v_bp jsonb;
  v_fc jsonb;
begin
  if v_user is null then
    select id into v_user from public.profiles
     where role = 'admin' and is_active = true
     order by created_at limit 1;
  end if;
  if v_user is null then
    raise exception 'Nenhum administrador ativo para registrar a geração.';
  end if;

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
  from public.ledger_entries
  where period_id = _period_id;

  v_lucro_bruto := v_receita - v_custo;
  v_resultado := v_lucro_bruto - v_despesa;

  v_dre := jsonb_build_object(
    'titulo', 'Demonstração do Resultado do Exercício',
    'linhas', jsonb_build_array(
      jsonb_build_object('label', 'Receita bruta', 'value', v_receita, 'kind', 'item'),
      jsonb_build_object('label', 'Custo dos produtos vendidos', 'value', -v_custo, 'kind', 'item'),
      jsonb_build_object('label', 'Lucro bruto', 'value', v_lucro_bruto, 'kind', 'subtotal'),
      jsonb_build_object('label', 'Despesas operacionais', 'value', -v_despesa, 'kind', 'item'),
      jsonb_build_object('label', 'Resultado líquido', 'value', v_resultado, 'kind', 'total')
    )
  );

  v_bp := jsonb_build_object(
    'titulo', 'Balanço Patrimonial',
    'linhas', jsonb_build_array(
      jsonb_build_object('label', 'Ativo circulante', 'value', v_ac, 'kind', 'item'),
      jsonb_build_object('label', 'Ativo não circulante', 'value', v_anc, 'kind', 'item'),
      jsonb_build_object('label', 'Total do ativo', 'value', v_ac + v_anc, 'kind', 'total'),
      jsonb_build_object('label', 'Passivo circulante', 'value', v_pc, 'kind', 'item'),
      jsonb_build_object('label', 'Passivo não circulante', 'value', v_pnc, 'kind', 'item'),
      jsonb_build_object('label', 'Patrimônio líquido', 'value', v_pl, 'kind', 'item'),
      jsonb_build_object('label', 'Total do passivo + PL', 'value', v_pc + v_pnc + v_pl, 'kind', 'total')
    )
  );

  v_fc := jsonb_build_object(
    'titulo', 'Fluxo de Caixa',
    'linhas', jsonb_build_array(
      jsonb_build_object('label', 'Resultado líquido do período', 'value', v_resultado, 'kind', 'item'),
      jsonb_build_object('label', 'Recebimentos (receitas)', 'value', v_receita, 'kind', 'item'),
      jsonb_build_object('label', 'Pagamentos (custos e despesas)', 'value', -(v_custo + v_despesa), 'kind', 'item'),
      jsonb_build_object('label', 'Posição de caixa (ativo circulante)', 'value', v_ac, 'kind', 'total')
    )
  );

  insert into public.financial_statements (period_id, statement_type, content, generated_by, generated_at)
  values
    (_period_id, 'dre', v_dre, v_user, now()),
    (_period_id, 'balanco_patrimonial', v_bp, v_user, now()),
    (_period_id, 'fluxo_de_caixa', v_fc, v_user, now())
  on conflict (period_id, statement_type)
  do update set content = excluded.content, generated_by = excluded.generated_by, generated_at = now();

  return jsonb_build_object('dre', v_dre, 'balanco_patrimonial', v_bp, 'fluxo_de_caixa', v_fc);
end;
$function$;

-- Rotina noturna: recalcula períodos com arquivos processados após o último recálculo
CREATE OR REPLACE FUNCTION public.nightly_refresh_periods()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_since timestamptz;
  v_changes int;
  v_preserved int;
  v_result jsonb := '[]'::jsonb;
begin
  for r in
    select p.id, p.label, p.last_recalculated_at
    from public.accounting_periods p
    where p.status <> 'fechado'
      and exists (
        select 1 from public.imported_files f
        where f.period_id = p.id
          and f.processing_status = 'processado'
          and f.updated_at > coalesce(p.last_recalculated_at, 'epoch'::timestamptz)
      )
  loop
    v_since := coalesce(r.last_recalculated_at, 'epoch'::timestamptz);

    select count(*), count(*) filter (where manual_edit_preserved)
      into v_changes, v_preserved
      from public.recalculation_logs
     where period_id = r.id and created_at > v_since;

    perform public.recalculate_period_indicators_internal(r.id);
    perform public.generate_period_statements(r.id);

    v_result := v_result || jsonb_build_object(
      'period_id', r.id,
      'label', r.label,
      'changes', v_changes,
      'manual_preserved', v_preserved
    );
  end loop;

  return jsonb_build_object('refreshed', jsonb_array_length(v_result), 'periods', v_result);
end;
$function$;

REVOKE ALL ON FUNCTION public.nightly_refresh_periods() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nightly_refresh_periods() TO service_role;