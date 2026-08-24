-- 1) reset_period
create or replace function public.reset_period(_period_id uuid, _include_accounts boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _status text; _label text;
  _legs int := 0; _entries int := 0; _tb int := 0; _openings int := 0;
  _st int := 0; _ind int := 0; _hidden int := 0; _sug int := 0; _find int := 0; _acc int := 0;
begin
  if not is_admin() then
    raise exception 'Apenas administradores podem zerar o período.';
  end if;

  select p.status, p.label into _status, _label
  from public.accounting_periods p where p.id = _period_id;

  if _label is null then
    raise exception 'Período não encontrado.';
  end if;

  if _status = 'fechado' then
    raise exception 'Período fechado: reabra o período antes de zerar.';
  end if;

  if exists (select 1 from public.accounting_closings c
             where c.period_id = _period_id and c.status = 'fechado') then
    raise exception 'Existe fechamento contábil ativo para % — reabra antes de zerar.', _label;
  end if;

  delete from public.journal_leg_comments where period_id = _period_id;

  delete from public.journal_legs where period_id = _period_id;
  get diagnostics _legs = row_count;

  delete from public.ledger_entries where period_id = _period_id;
  get diagnostics _entries = row_count;

  delete from public.trial_balance_lines where period_id = _period_id;
  get diagnostics _tb = row_count;

  delete from public.journal_account_openings where period_id = _period_id;
  get diagnostics _openings = row_count;

  delete from public.financial_statements where period_id = _period_id;
  get diagnostics _st = row_count;

  delete from public.dashboard_indicators where period_id = _period_id;
  get diagnostics _ind = row_count;

  delete from public.period_excluded_accounts where period_id = _period_id;
  get diagnostics _hidden = row_count;

  delete from public.reclassification_suggestions where period_id = _period_id;
  get diagnostics _sug = row_count;

  delete from public.audit_findings where period_id = _period_id;
  get diagnostics _find = row_count;

  delete from public.imported_files where period_id = _period_id;

  if _include_accounts then
    delete from public.ledger_accounts a
    where not exists (select 1 from public.journal_legs l where l.account_id = a.id
                        or l.account_reduced_code = a.reduced_code)
      and not exists (select 1 from public.journal_account_openings o
                      where o.account_reduced_code = a.reduced_code);
    get diagnostics _acc = row_count;
  end if;

  perform public.recalculate_period_indicators_internal(_period_id);

  update public.accounting_periods
     set chain_stale = false, last_recalculated_at = now()
   where id = _period_id;

  perform public.log_activity(
    'zerou o período', 'accounting_periods', _period_id,
    jsonb_build_object('label', _label, 'journal_legs', _legs, 'ledger_entries', _entries,
      'trial_balance_lines', _tb, 'aberturas', _openings, 'demonstrativos', _st,
      'indicadores', _ind, 'contas_ocultas', _hidden, 'sugestoes', _sug,
      'apontamentos', _find, 'contas_removidas', _acc)
  );

  return jsonb_build_object('ok', true, 'label', _label, 'journal_legs', _legs,
    'ledger_entries', _entries, 'trial_balance_lines', _tb, 'aberturas', _openings,
    'demonstrativos', _st, 'indicadores', _ind, 'contas_ocultas', _hidden,
    'sugestoes', _sug, 'apontamentos', _find, 'contas_removidas', _acc);
end;
$function$;

revoke all on function public.reset_period(uuid, boolean) from public;
grant execute on function public.reset_period(uuid, boolean) to authenticated;

-- 2) delete_imported_file: limpa resíduos quando o período fica sem arquivos
create or replace function public.delete_imported_file(_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _file record;
  _period_status text;
  _legs int := 0;
  _entries int := 0;
  _tb int := 0;
  _openings int := 0;
  _st int := 0;
  _ind int := 0;
  _restante int := 0;
begin
  if not is_admin() then
    raise exception 'Apenas administradores podem excluir arquivos importados.';
  end if;

  select f.id, f.period_id, f.original_name, f.file_type, f.storage_path
    into _file
  from public.imported_files f
  where f.id = _file_id;

  if _file.id is null then
    raise exception 'Arquivo importado não encontrado.';
  end if;

  select p.status into _period_status
  from public.accounting_periods p where p.id = _file.period_id;

  if _period_status = 'fechado' then
    raise exception 'Período fechado: reabra o período antes de excluir o arquivo.';
  end if;

  delete from public.journal_legs where file_id = _file_id;
  get diagnostics _legs = row_count;

  delete from public.ledger_entries where file_id = _file_id;
  get diagnostics _entries = row_count;

  delete from public.trial_balance_lines where file_id = _file_id;
  get diagnostics _tb = row_count;

  delete from public.imported_files where id = _file_id;

  select count(*) into _restante
  from public.imported_files f where f.period_id = _file.period_id;

  if _restante = 0 then
    delete from public.journal_account_openings where period_id = _file.period_id;
    get diagnostics _openings = row_count;

    delete from public.financial_statements where period_id = _file.period_id;
    get diagnostics _st = row_count;

    delete from public.dashboard_indicators where period_id = _file.period_id;
    get diagnostics _ind = row_count;

    perform public.recalculate_period_indicators_internal(_file.period_id);

    update public.accounting_periods
       set chain_stale = false, last_recalculated_at = now()
     where id = _file.period_id;
  else
    update public.accounting_periods set chain_stale = true where id = _file.period_id;
  end if;

  perform public.log_activity(
    'excluiu arquivo importado',
    'imported_files',
    _file_id,
    jsonb_build_object(
      'original_name', _file.original_name,
      'file_type', _file.file_type,
      'period_id', _file.period_id,
      'journal_legs', _legs,
      'ledger_entries', _entries,
      'trial_balance_lines', _tb,
      'aberturas', _openings,
      'demonstrativos', _st,
      'indicadores', _ind
    )
  );

  return jsonb_build_object(
    'ok', true,
    'period_id', _file.period_id,
    'storage_path', _file.storage_path,
    'original_name', _file.original_name,
    'journal_legs', _legs,
    'ledger_entries', _entries,
    'trial_balance_lines', _tb,
    'aberturas', _openings,
    'demonstrativos', _st,
    'indicadores', _ind
  );
end;
$function$;

-- 3) period_health: conferência a partir das views
create or replace function public.period_health(_period_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _label text;
  _legs int; _files int; _openings int;
  _recon jsonb; _gaps jsonb; _anchor jsonb; _chain jsonb;
  _recon_n int; _gaps_n int; _anchor_n int; _chain_n int;
begin
  select p.label into _label from public.accounting_periods p where p.id = _period_id;
  if _label is null then
    raise exception 'Período não encontrado.';
  end if;

  select count(*) into _legs from public.journal_legs where period_id = _period_id and status <> 'cancelado';
  select count(*) into _files from public.imported_files where period_id = _period_id;
  select count(*) into _openings from public.journal_account_openings where period_id = _period_id;

  select coalesce(jsonb_agg(t), '[]'::jsonb), count(*) into _recon, _recon_n
  from (
    select conta, account_reduced_code, lado, saldo_esperado, saldo_gravado,
           round(saldo_gravado - saldo_esperado, 2) as diferenca
    from public.v_ledger_reconciliation
    where period_id = _period_id
      and abs(coalesce(saldo_gravado,0) - coalesce(saldo_esperado,0)) > 0.005
    order by abs(coalesce(saldo_gravado,0) - coalesce(saldo_esperado,0)) desc
    limit 50
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb), count(*) into _gaps, _gaps_n
  from (
    select conta, account_reduced_code, lado, linhas_perdidas, valor_perdido,
           primeiro_doc_apos_lacuna, ultimo_doc_apos_lacuna
    from public.v_ledger_import_gaps
    where period_id = _period_id
    order by abs(coalesce(valor_perdido,0)) desc
    limit 50
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb), count(*) into _anchor, _anchor_n
  from (
    select conta, account_reduced_code, nature, lado_esperado, lado_gravado, opening_balance
    from public.v_anchor_sign_check
    where period_id = _period_id
      and coalesce(lado_esperado,'') <> coalesce(lado_gravado,'')
    limit 50
  ) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb), count(*) into _chain, _chain_n
  from (
    select fecha_em, abre_em, conta, account_name, fechamento, abertura_seguinte, diferenca
    from public.v_chain_continuity
    where abs(coalesce(diferenca,0)) > 0.005
      and (fecha_em = _label or abre_em = _label)
    order by abs(coalesce(diferenca,0)) desc
    limit 50
  ) t;

  return jsonb_build_object(
    'period_id', _period_id,
    'label', _label,
    'legs', _legs,
    'files', _files,
    'openings', _openings,
    'reconciliation', jsonb_build_object('total', _recon_n, 'items', _recon),
    'gaps', jsonb_build_object('total', _gaps_n, 'items', _gaps),
    'anchors', jsonb_build_object('total', _anchor_n, 'items', _anchor),
    'chain', jsonb_build_object('total', _chain_n, 'items', _chain)
  );
end;
$function$;

revoke all on function public.period_health(uuid) from public;
grant execute on function public.period_health(uuid) to authenticated;