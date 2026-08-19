-- demonstrativos e casamento também ignoram cancelados
create or replace function public.generate_period_statements(_period_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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

  select exists (select 1 from public.journal_legs where period_id = _period_id and status = 'ativo') into v_has_journal;
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
        from public.journal_legs where period_id = _period_id and status = 'ativo' group by account_reduced_code
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
end $function$;

-- ================= grade do gerenciador =================
create or replace function public.journal_entries_grid(
  _period_id uuid,
  _query text default null,
  _from date default null,
  _to date default null,
  _account text default null,
  _include_cancelled boolean default false,
  _limit integer default 50,
  _offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  q text := public.txt_norm(coalesce(_query, ''));
  qval numeric;
  lim integer := greatest(1, least(coalesce(_limit, 50), 200));
  off integer := greatest(0, coalesce(_offset, 0));
  total bigint; soma numeric; rows jsonb;
begin
  begin
    qval := replace(replace(regexp_replace(coalesce(_query,''), '[^0-9,.\-]', '', 'g'), '.', ''), ',', '.')::numeric;
  exception when others then qval := null; end;

  create temp table _grid on commit drop as
  select l.id, l.entry_group, l.status, l.origin, l.doc_number, l.entry_date, l.historico,
         l.debit as valor,
         l.account_reduced_code as debit_code,
         coalesce(a.name, l.account_reduced_code) as debit_name,
         l.counterpart_reduced_code as credit_code,
         coalesce(c.name, l.counterpart_reduced_code) as credit_name,
         l.line_no
  from public.journal_legs l
  left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
  left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
  where l.period_id = _period_id
    and l.debit > 0
    and (_include_cancelled or l.status = 'ativo')
    and (_from is null or l.entry_date >= _from)
    and (_to is null or l.entry_date <= _to)
    and (
      _account is null or _account = ''
      or l.account_reduced_code = _account
      or l.counterpart_reduced_code = _account
    )
    and (
      length(q) < 2
      or public.txt_norm(l.doc_number) like '%' || q || '%'
      or public.txt_norm(l.historico) like '%' || q || '%'
      or public.txt_norm(l.account_reduced_code) like '%' || q || '%'
      or public.txt_norm(l.counterpart_reduced_code) like '%' || q || '%'
      or public.txt_norm(a.name) like '%' || q || '%'
      or public.txt_norm(c.name) like '%' || q || '%'
      or (qval is not null and l.debit = qval)
    );

  select count(*), coalesce(sum(valor), 0) into total, soma from _grid;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into rows
  from (
    select id, entry_group, status, origin, doc_number, entry_date, historico,
           valor, debit_code, debit_name, credit_code, credit_name
    from _grid
    order by entry_date desc nulls last, doc_number desc nulls last, line_no
    limit lim offset off
  ) x;

  return jsonb_build_object('total', total, 'soma', soma, 'rows', rows);
end $function$;

-- ================= criação / edição =================
create or replace function public.upsert_manual_journal_entry(
  _period_id uuid,
  _debit_code text,
  _credit_code text,
  _entry_date date,
  _doc_number text,
  _value numeric,
  _historico text,
  _leg_id uuid default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_group uuid;
  v_old jsonb;
  v_status text;
  v_ref date;
  v_debit_id uuid; v_credit_id uuid;
  v_line int;
  v_new_id uuid;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select status, reference_month into v_status, v_ref from public.accounting_periods where id = _period_id;
  if not found then raise exception 'Período não encontrado.'; end if;
  if v_status = 'fechado' then raise exception 'Período fechado: não é possível lançar.'; end if;

  if coalesce(btrim(_debit_code),'') = '' or coalesce(btrim(_credit_code),'') = '' then
    raise exception 'Informe a conta de débito e a conta de crédito.';
  end if;
  if btrim(_debit_code) = btrim(_credit_code) then
    raise exception 'A conta de débito e a de crédito devem ser diferentes.';
  end if;
  if coalesce(_value, 0) <= 0 then raise exception 'O valor deve ser maior que zero.'; end if;
  if _entry_date is null then raise exception 'Informe a data do lançamento.'; end if;
  if date_trunc('month', _entry_date) <> date_trunc('month', v_ref) then
    raise exception 'A data deve estar dentro do período selecionado.';
  end if;
  if coalesce(btrim(_historico),'') = '' then raise exception 'Informe o histórico.'; end if;

  select id into v_debit_id from public.ledger_accounts where reduced_code = btrim(_debit_code);
  if v_debit_id is null then raise exception 'Conta de débito % não existe no plano do razão.', _debit_code; end if;
  select id into v_credit_id from public.ledger_accounts where reduced_code = btrim(_credit_code);
  if v_credit_id is null then raise exception 'Conta de crédito % não existe no plano do razão.', _credit_code; end if;

  if _leg_id is not null then
    select coalesce(l.entry_group, gen_random_uuid()),
           to_jsonb(l) - 'id'
      into v_group, v_old
      from public.journal_legs l where l.id = _leg_id;
    if v_group is null then raise exception 'Lançamento não encontrado.'; end if;

    delete from public.journal_legs
     where period_id = _period_id
       and (
         (entry_group is not null and entry_group = v_group)
         or id = _leg_id
         or (entry_group is null and doc_number = (v_old->>'doc_number')
             and coalesce(counterpart_reduced_code,'') = (v_old->>'account_reduced_code')
             and coalesce(account_reduced_code,'') = coalesce(v_old->>'counterpart_reduced_code','')
             and greatest(debit, credit) = (v_old->>'debit')::numeric)
       );
  else
    v_group := gen_random_uuid();
  end if;

  select coalesce(max(line_no), 0) + 1 into v_line from public.journal_legs where period_id = _period_id;

  insert into public.journal_legs
    (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number,
     entry_date, historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
  values
    (_period_id, btrim(_debit_code), v_debit_id, btrim(_credit_code), nullif(btrim(coalesce(_doc_number,'')),''),
     _entry_date, btrim(_historico), _value, 0, v_line, 'ativo', 'manual', v_group, auth.uid(), auth.uid())
  returning id into v_new_id;

  insert into public.journal_legs
    (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number,
     entry_date, historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
  values
    (_period_id, btrim(_credit_code), v_credit_id, btrim(_debit_code), nullif(btrim(coalesce(_doc_number,'')),''),
     _entry_date, btrim(_historico), 0, _value, v_line, 'ativo', 'manual', v_group, auth.uid(), auth.uid());

  insert into public.ledger_account_audit
    (period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  values
    (_period_id, 'journal_legs', btrim(_debit_code),
     (select name from public.ledger_accounts where reduced_code = btrim(_debit_code)),
     case when _leg_id is null then 'lancamento_criado' else 'lancamento_editado' end,
     case when v_old is null then null else v_old::text end,
     jsonb_build_object('debito', btrim(_debit_code), 'credito', btrim(_credit_code),
                        'data', _entry_date, 'doc', _doc_number, 'valor', _value,
                        'historico', btrim(_historico))::text,
     'gerenciador_razao', auth.uid());

  perform public.recalculate_period_indicators_internal(_period_id);

  return jsonb_build_object('id', v_new_id, 'entry_group', v_group);
end $function$;

-- ================= cancelamento =================
create or replace function public.cancel_journal_entry(_leg_id uuid, _motivo text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_leg record; v_status text; v_count int;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select * into v_leg from public.journal_legs where id = _leg_id;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if v_leg.status = 'cancelado' then raise exception 'Lançamento já está cancelado.'; end if;

  select status into v_status from public.accounting_periods where id = v_leg.period_id;
  if v_status = 'fechado' then raise exception 'Período fechado: não é possível cancelar.'; end if;

  with upd as (
    update public.journal_legs l
       set status = 'cancelado', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now()
     where l.period_id = v_leg.period_id
       and l.status = 'ativo'
       and (
         (v_leg.entry_group is not null and l.entry_group = v_leg.entry_group)
         or l.id = _leg_id
         or (v_leg.entry_group is null
             and l.doc_number is not distinct from v_leg.doc_number
             and l.account_reduced_code = coalesce(v_leg.counterpart_reduced_code, '~')
             and coalesce(l.counterpart_reduced_code,'') = v_leg.account_reduced_code
             and greatest(l.debit, l.credit) = greatest(v_leg.debit, v_leg.credit))
       )
    returning 1
  )
  select count(*) into v_count from upd;

  insert into public.ledger_account_audit
    (period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  values
    (v_leg.period_id, 'journal_legs', v_leg.account_reduced_code,
     (select name from public.ledger_accounts where reduced_code = v_leg.account_reduced_code),
     'lancamento_cancelado',
     jsonb_build_object('doc', v_leg.doc_number, 'data', v_leg.entry_date,
                        'valor', greatest(v_leg.debit, v_leg.credit),
                        'historico', v_leg.historico)::text,
     coalesce(nullif(btrim(coalesce(_motivo,'')),''), 'cancelado'),
     'gerenciador_razao', auth.uid());

  perform public.recalculate_period_indicators_internal(v_leg.period_id);

  return jsonb_build_object('cancelled', v_count);
end $function$;

revoke execute on function public.journal_entries_grid(uuid, text, date, date, text, boolean, integer, integer) from anon;
revoke execute on function public.upsert_manual_journal_entry(uuid, text, text, date, text, numeric, text, uuid) from anon;
revoke execute on function public.cancel_journal_entry(uuid, text) from anon;