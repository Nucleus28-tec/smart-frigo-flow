create or replace function public.delete_imported_file(_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _file record;
  _period_status text;
  _legs int := 0;
  _entries int := 0;
  _tb int := 0;
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
      'trial_balance_lines', _tb
    )
  );

  return jsonb_build_object(
    'ok', true,
    'period_id', _file.period_id,
    'storage_path', _file.storage_path,
    'original_name', _file.original_name,
    'journal_legs', _legs,
    'ledger_entries', _entries,
    'trial_balance_lines', _tb
  );
end;
$$;

create or replace function public.purge_period_journal(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _status text;
  _label text;
  _legs int := 0;
  _entries int := 0;
  _tb int := 0;
  _openings int := 0;
begin
  if not is_admin() then
    raise exception 'Apenas administradores podem limpar o movimento do período.';
  end if;

  select p.status, p.label into _status, _label
  from public.accounting_periods p where p.id = _period_id;

  if _label is null then
    raise exception 'Período não encontrado.';
  end if;

  if _status = 'fechado' then
    raise exception 'Período fechado: reabra o período antes de limpar o movimento.';
  end if;

  if exists (select 1 from public.accounting_closings c
             where c.period_id = _period_id and c.status = 'fechado') then
    raise exception 'Existe fechamento contábil ativo para % — reabra antes de limpar.', _label;
  end if;

  delete from public.journal_legs where period_id = _period_id;
  get diagnostics _legs = row_count;

  delete from public.ledger_entries where period_id = _period_id;
  get diagnostics _entries = row_count;

  delete from public.trial_balance_lines where period_id = _period_id;
  get diagnostics _tb = row_count;

  delete from public.journal_account_openings where period_id = _period_id;
  get diagnostics _openings = row_count;

  perform public.recalculate_period_indicators_internal(_period_id);

  perform public.log_activity(
    'limpou movimento do período',
    'accounting_periods',
    _period_id,
    jsonb_build_object(
      'label', _label,
      'journal_legs', _legs,
      'ledger_entries', _entries,
      'trial_balance_lines', _tb,
      'aberturas', _openings
    )
  );

  return jsonb_build_object(
    'ok', true,
    'label', _label,
    'journal_legs', _legs,
    'ledger_entries', _entries,
    'trial_balance_lines', _tb,
    'aberturas', _openings
  );
end;
$$;

revoke all on function public.delete_imported_file(uuid) from public;
revoke all on function public.purge_period_journal(uuid) from public;
grant execute on function public.delete_imported_file(uuid) to authenticated, service_role;
grant execute on function public.purge_period_journal(uuid) to authenticated, service_role;