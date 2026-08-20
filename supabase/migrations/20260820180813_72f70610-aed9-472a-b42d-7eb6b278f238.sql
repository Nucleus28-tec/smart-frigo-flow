-- Fase 5: ajustes de lançamento propostos pelo agente contábil.
-- Nunca edita o lançamento original: gera lançamento de ajuste rastreável + auditoria imutável.

create or replace function public.apply_journal_adjustment(
  _leg_id uuid,
  _new_account text default null,
  _new_value numeric default null,
  _justificativa text default null,
  _thread_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_leg record;
  v_status text;
  v_year int; v_month int;
  v_group uuid := gen_random_uuid();
  v_line int;
  v_old_value numeric;
  v_is_debit boolean;
  v_counter text;
  v_new_code text;
  v_delta numeric := 0;
  v_final_value numeric;
  v_doc text;
  v_hist text;
  v_created int := 0;
  v_changes jsonb := '[]'::jsonb;

  procedure_dummy int;
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores. Somente o Admin pode aplicar ajustes.';
  end if;

  select * into v_leg from public.journal_legs where id = _leg_id;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if v_leg.status <> 'ativo' then raise exception 'O lançamento está cancelado: não é possível ajustar.'; end if;

  select status into v_status from public.accounting_periods where id = v_leg.period_id;
  if v_status = 'fechado' then
    raise exception 'Período fechado: não é possível registrar ajustes. Cancele o fechamento antes.';
  end if;

  select extract(year from reference_month)::int, extract(month from reference_month)::int
    into v_year, v_month from public.accounting_periods where id = v_leg.period_id;

  if exists (
    select 1 from public.accounting_closings
     where year = v_year and status = 'fechado'
       and (kind = 'anual' or (kind = 'mensal' and month = v_month))
  ) then
    raise exception 'O fechamento contábil deste mês/exercício está ativo: cancele o fechamento antes de ajustar.';
  end if;

  v_is_debit := coalesce(v_leg.debit, 0) > 0;
  v_old_value := greatest(coalesce(v_leg.debit, 0), coalesce(v_leg.credit, 0));
  v_counter := coalesce(v_leg.counterpart_reduced_code, '');
  v_new_code := nullif(btrim(coalesce(_new_account, '')), '');
  v_final_value := coalesce(_new_value, v_old_value);

  if v_new_code is null and _new_value is null then
    raise exception 'Informe a nova conta e/ou o novo valor do ajuste.';
  end if;
  if _new_value is not null and _new_value <= 0 then
    raise exception 'O valor ajustado deve ser maior que zero.';
  end if;
  if v_new_code is not null then
    if not exists (select 1 from public.ledger_accounts where reduced_code = v_new_code) then
      raise exception 'A conta % não existe no plano de contas do razão.', v_new_code;
    end if;
    if v_new_code = v_leg.account_reduced_code then
      v_new_code := null;
    end if;
  end if;
  if v_new_code is null and v_final_value = v_old_value then
    raise exception 'O ajuste proposto é igual ao lançamento atual.';
  end if;

  v_doc := coalesce(nullif(btrim(coalesce(v_leg.doc_number, '')), ''), 'AJ') || '-AJ';
  v_hist := 'AJUSTE ' || coalesce(nullif(btrim(coalesce(_justificativa, '')), ''), 'ajuste contábil')
            || ' (ref. doc ' || coalesce(v_leg.doc_number, '-') || ')';
  select coalesce(max(line_no), 0) + 1 into v_line from public.journal_legs where period_id = v_leg.period_id;

  -- 1) correção de valor: lança a diferença contra a contrapartida original
  v_delta := v_final_value - v_old_value;
  if v_delta <> 0 and v_counter <> '' then
    insert into public.journal_legs
      (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
       historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
    values
      (v_leg.period_id, v_leg.account_reduced_code,
       (select id from public.ledger_accounts where reduced_code = v_leg.account_reduced_code),
       v_counter, v_doc, v_leg.entry_date, v_hist,
       case when (v_is_debit and v_delta > 0) or (not v_is_debit and v_delta < 0) then abs(v_delta) else 0 end,
       case when (v_is_debit and v_delta > 0) or (not v_is_debit and v_delta < 0) then 0 else abs(v_delta) end,
       v_line, 'ativo', 'ajuste', v_group, auth.uid(), auth.uid()),
      (v_leg.period_id, v_counter,
       (select id from public.ledger_accounts where reduced_code = v_counter),
       v_leg.account_reduced_code, v_doc, v_leg.entry_date, v_hist,
       case when (v_is_debit and v_delta > 0) or (not v_is_debit and v_delta < 0) then 0 else abs(v_delta) end,
       case when (v_is_debit and v_delta > 0) or (not v_is_debit and v_delta < 0) then abs(v_delta) else 0 end,
       v_line, 'ativo', 'ajuste', v_group, auth.uid(), auth.uid());
    v_created := v_created + 2;
    v_changes := v_changes || jsonb_build_object('tipo', 'valor', 'de', v_old_value, 'para', v_final_value);
  elsif v_delta <> 0 then
    raise exception 'O lançamento não tem contrapartida identificada: corrija o valor pelo gerenciador do razão.';
  end if;

  -- 2) reclassificação: transfere o valor final da conta original para a nova conta
  if v_new_code is not null then
    insert into public.journal_legs
      (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
       historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
    values
      (v_leg.period_id, v_new_code,
       (select id from public.ledger_accounts where reduced_code = v_new_code),
       v_leg.account_reduced_code, v_doc, v_leg.entry_date, v_hist,
       case when v_is_debit then v_final_value else 0 end,
       case when v_is_debit then 0 else v_final_value end,
       v_line, 'ativo', 'ajuste', v_group, auth.uid(), auth.uid()),
      (v_leg.period_id, v_leg.account_reduced_code,
       (select id from public.ledger_accounts where reduced_code = v_leg.account_reduced_code),
       v_new_code, v_doc, v_leg.entry_date, v_hist,
       case when v_is_debit then 0 else v_final_value end,
       case when v_is_debit then v_final_value else 0 end,
       v_line, 'ativo', 'ajuste', v_group, auth.uid(), auth.uid());
    v_created := v_created + 2;
    v_changes := v_changes || jsonb_build_object('tipo', 'conta', 'de', v_leg.account_reduced_code, 'para', v_new_code);
  end if;

  insert into public.ledger_account_audit
    (period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  values
    (v_leg.period_id, 'journal_legs', v_leg.account_reduced_code,
     (select name from public.ledger_accounts where reduced_code = v_leg.account_reduced_code),
     'lancamento_ajustado',
     jsonb_build_object('leg_id', _leg_id, 'conta', v_leg.account_reduced_code, 'valor', v_old_value,
                        'doc', v_leg.doc_number, 'data', v_leg.entry_date, 'historico', v_leg.historico)::text,
     jsonb_build_object('conta', coalesce(v_new_code, v_leg.account_reduced_code), 'valor', v_final_value,
                        'entry_group', v_group, 'mudancas', v_changes,
                        'justificativa', _justificativa, 'thread_id', _thread_id)::text,
     'agente_contador', auth.uid());

  perform public.recalculate_period_indicators_internal(v_leg.period_id);

  return jsonb_build_object(
    'ok', true,
    'entry_group', v_group,
    'legs_criadas', v_created,
    'de', jsonb_build_object('conta', v_leg.account_reduced_code, 'valor', v_old_value),
    'para', jsonb_build_object('conta', coalesce(v_new_code, v_leg.account_reduced_code), 'valor', v_final_value)
  );
end $function$;

revoke all on function public.apply_journal_adjustment(uuid, text, numeric, text, uuid) from public, anon;
grant execute on function public.apply_journal_adjustment(uuid, text, numeric, text, uuid) to authenticated, service_role;

-- Detalhe de um lançamento para o agente montar a proposta com evidência.
create or replace function public.journal_leg_detail(_leg_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_leg record; v_out jsonb;
begin
  select l.*, a.name as conta_nome, c.name as contrapartida_nome, p.label as periodo, p.status as periodo_status
    into v_leg
    from public.journal_legs l
    left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
    left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
    left join public.accounting_periods p on p.id = l.period_id
   where l.id = _leg_id;
  if not found then return jsonb_build_object('erro', 'Lançamento não encontrado.'); end if;

  v_out := jsonb_build_object(
    'leg_id', v_leg.id,
    'period_id', v_leg.period_id,
    'periodo', v_leg.periodo,
    'periodo_status', v_leg.periodo_status,
    'data', v_leg.entry_date,
    'doc', v_leg.doc_number,
    'historico', v_leg.historico,
    'conta', v_leg.account_reduced_code,
    'conta_nome', v_leg.conta_nome,
    'contrapartida', v_leg.counterpart_reduced_code,
    'contrapartida_nome', v_leg.contrapartida_nome,
    'debito', v_leg.debit,
    'credito', v_leg.credit,
    'valor', greatest(coalesce(v_leg.debit,0), coalesce(v_leg.credit,0)),
    'natureza_lancamento', case when coalesce(v_leg.debit,0) > 0 then 'debito' else 'credito' end,
    'status', v_leg.status,
    'origem', v_leg.origin
  );
  return v_out;
end $function$;

revoke all on function public.journal_leg_detail(uuid) from public, anon;
grant execute on function public.journal_leg_detail(uuid) to authenticated, service_role;