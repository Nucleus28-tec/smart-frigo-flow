create or replace function public.recalculate_period_indicators_internal(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_caixa numeric := 0; v_margem numeric := 0; v_ebitda numeric := 0; v_liquido numeric := 0;
begin
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
    'receita_total', v_receita, 'custo_total', v_custo, 'margem_bruta', v_margem,
    'ebitda', v_ebitda, 'resultado_liquido', v_liquido, 'posicao_caixa', v_caixa
  );
end;
$function$;

create or replace function public.recalculate_period_indicators(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;
  return public.recalculate_period_indicators_internal(_period_id);
end;
$function$;

create or replace function public.merge_file_entries(_file_id uuid, _entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_period uuid;
  v_is_first boolean;
  v_inserted int := 0; v_updated int := 0; v_removed int := 0; v_preserved int := 0;
  v_new_id uuid;
  r record;
begin
  select period_id into v_period from public.imported_files where id = _file_id;
  if v_period is null then raise exception 'Arquivo não encontrado.'; end if;

  select not exists (select 1 from public.ledger_entries where file_id = _file_id) into v_is_first;

  create temp table _incoming on commit drop as
  select
    btrim(el.value->>'source_account_name') as source_account_name,
    (el.value->>'raw_value')::numeric as raw_value,
    nullif(el.value->>'entry_date','')::date as entry_date,
    row_number() over (
      partition by btrim(el.value->>'source_account_name') order by el.ord
    ) as occ
  from jsonb_array_elements(_entries) with ordinality as el(value, ord);

  create temp table _existing on commit drop as
  select e.id, btrim(e.source_account_name) as source_account_name,
         e.raw_value, e.reviewed_value, e.is_manually_edited, e.entry_date,
         row_number() over (partition by btrim(e.source_account_name) order by e.created_at, e.id) as occ
  from public.ledger_entries e
  where e.file_id = _file_id;

  -- Lançamentos que desapareceram do arquivo
  for r in
    select ex.* from _existing ex
    left join _incoming inc
      on inc.source_account_name = ex.source_account_name and inc.occ = ex.occ
    where inc.source_account_name is null
  loop
    if not v_is_first then
      insert into public.recalculation_logs (period_id, file_id, entry_id, field_changed, old_value, new_value, manual_edit_preserved)
      values (v_period, _file_id, null, 'lancamento_removido', r.source_account_name || ' = ' || r.raw_value::text, null, false);
    end if;
    delete from public.ledger_entries where id = r.id;
    v_removed := v_removed + 1;
  end loop;

  -- Atualizações de valor bruto (preservando edições manuais)
  for r in
    select ex.id, ex.source_account_name, ex.raw_value as old_raw, ex.is_manually_edited,
           ex.reviewed_value, inc.raw_value as new_raw, inc.entry_date
    from _existing ex
    join _incoming inc
      on inc.source_account_name = ex.source_account_name and inc.occ = ex.occ
  loop
    if r.old_raw is distinct from r.new_raw then
      update public.ledger_entries
         set raw_value = r.new_raw, entry_date = coalesce(r.entry_date, entry_date)
       where id = r.id;
      insert into public.recalculation_logs (period_id, file_id, entry_id, field_changed, old_value, new_value, manual_edit_preserved)
      values (v_period, _file_id, r.id, 'raw_value', r.old_raw::text, r.new_raw::text,
              r.is_manually_edited and r.reviewed_value is not null);
      v_updated := v_updated + 1;
      if r.is_manually_edited and r.reviewed_value is not null then
        v_preserved := v_preserved + 1;
      end if;
    else
      update public.ledger_entries
         set entry_date = coalesce(r.entry_date, entry_date)
       where id = r.id;
    end if;
  end loop;

  -- Novos lançamentos
  for r in
    select inc.* from _incoming inc
    left join _existing ex
      on inc.source_account_name = ex.source_account_name and inc.occ = ex.occ
    where ex.id is null
  loop
    insert into public.ledger_entries (period_id, file_id, source_account_name, raw_value, entry_date)
    values (v_period, _file_id, r.source_account_name, r.raw_value, r.entry_date)
    returning id into v_new_id;
    if not v_is_first then
      insert into public.recalculation_logs (period_id, file_id, entry_id, field_changed, old_value, new_value, manual_edit_preserved)
      values (v_period, _file_id, v_new_id, 'novo_lancamento', null, r.raw_value::text, false);
    end if;
    v_inserted := v_inserted + 1;
  end loop;

  perform public.recalculate_period_indicators_internal(v_period);

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'removed', v_removed,
    'manual_preserved', v_preserved, 'first_import', v_is_first,
    'total', (select count(*) from public.ledger_entries where file_id = _file_id)
  );
end;
$function$;