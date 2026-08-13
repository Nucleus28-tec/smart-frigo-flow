create or replace function public.recalculate_period_indicators(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_receita numeric := 0;
  v_custo numeric := 0;
  v_despesa numeric := 0;
  v_caixa numeric := 0;
  v_margem numeric := 0;
  v_ebitda numeric := 0;
  v_liquido numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;

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

  v_ebitda := v_receita - v_custo - v_despesa;
  v_liquido := v_ebitda;
  if v_receita <> 0 then
    v_margem := ((v_receita - v_custo) / v_receita) * 100;
  end if;

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
    'receita_total', v_receita,
    'custo_total', v_custo,
    'margem_bruta', v_margem,
    'ebitda', v_ebitda,
    'resultado_liquido', v_liquido,
    'posicao_caixa', v_caixa
  );
end;
$$;