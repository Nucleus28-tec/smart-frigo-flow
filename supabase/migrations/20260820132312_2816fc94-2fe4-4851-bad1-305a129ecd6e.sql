
create or replace function public.month_names_pt(_months int[])
returns text
language sql
immutable
set search_path = public
as $$
  select string_agg(m.nome, ', ' order by m.ord)
  from (
    select x as ord,
           (array['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho',
                  'Agosto','Setembro','Outubro','Novembro','Dezembro'])[x] as nome
    from unnest(_months) as x
    where x between 1 and 12
  ) m
$$;

create or replace function public.close_period_partial(_period_id uuid, _result_code text default null::text, _profit_code text default null::text, _mode text default 'gerar'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_period record;
  v_year int; v_month int; v_last date;
  v_result text; v_profit text;
  v_group uuid := gen_random_uuid();
  v_doc text;
  v_line int;
  v_debit_total numeric := 0;
  v_credit_total numeric := 0;
  v_result_value numeric := 0;
  v_rec record;
  v_count int := 0;
  v_res_id uuid; v_profit_id uuid;
  v_pend int[];
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores. Somente o Admin pode fechar períodos.'; end if;

  select * into v_period from public.accounting_periods where id = _period_id;
  if not found then raise exception 'Período não encontrado.'; end if;
  if v_period.status = 'fechado' then
    raise exception 'O período % já está fechado. Cancele o fechamento antes de fechá-lo novamente.', v_period.label;
  end if;

  v_year := extract(year from v_period.reference_month);
  v_month := extract(month from v_period.reference_month);
  v_last := (date_trunc('month', v_period.reference_month) + interval '1 month - 1 day')::date;

  if exists (select 1 from public.accounting_closings where year = v_year and kind = 'anual' and status = 'fechado') then
    raise exception 'O exercício % está fechado. Cancele primeiro o fechamento do exercício % para movimentar os meses.', v_year, v_year;
  end if;

  select array_agg(extract(month from p.reference_month)::int)
    into v_pend
    from public.accounting_periods p
   where extract(year from p.reference_month) = v_year
     and extract(month from p.reference_month) < v_month
     and p.status <> 'fechado';

  if v_pend is not null and array_length(v_pend, 1) > 0 then
    raise exception 'Ordem obrigatória: feche antes % de %. O mês % só pode ser fechado depois que todos os meses anteriores estiverem fechados.',
      public.month_names_pt(v_pend), v_year, public.month_names_pt(array[v_month]);
  end if;

  v_result := coalesce(nullif(btrim(coalesce(_result_code,'')),''),
                       (select value from public.app_settings where key = 'closing.result_account'), '023511');
  v_profit := coalesce(nullif(btrim(coalesce(_profit_code,'')),''),
                       (select value from public.app_settings where key = 'closing.profit_account'), '023413');

  if _mode = 'gerar' then
    select id into v_res_id from public.ledger_accounts where reduced_code = v_result;
    if v_res_id is null then raise exception 'Conta de resultado % não existe no plano do razão. Cadastre a conta ou ajuste o campo "Conta de resultado do exercício".', v_result; end if;
    select id into v_profit_id from public.ledger_accounts where reduced_code = v_profit;
    if v_profit_id is null then raise exception 'Conta de lucro/prejuízo % não existe no plano do razão. Cadastre a conta ou ajuste o campo "Conta de lucros/prejuízos".', v_profit; end if;

    v_doc := 'FCH' || to_char(v_period.reference_month, 'MMYYYY');
    select coalesce(max(line_no), 0) + 1 into v_line from public.journal_legs where period_id = _period_id;

    for v_rec in
      select l.account_reduced_code as code,
             max(l.account_id) as account_id,
             sum(l.debit - l.credit) as saldo
      from public.journal_legs l
      left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
      where l.period_id = _period_id
        and l.status = 'ativo'
        and l.origin <> 'fechamento'
        and l.account_reduced_code not in (v_result, v_profit)
        and coalesce(a.nature, public.nature_from_code(l.account_reduced_code)) in ('receita','custo','despesa')
      group by 1
      having abs(sum(l.debit - l.credit)) > 0.004
    loop
      insert into public.journal_legs
        (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
         historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
      values
        (_period_id, v_rec.code, v_rec.account_id, v_result, v_doc, v_last,
         'Encerramento parcial ' || to_char(v_period.reference_month, 'MM/YYYY'),
         case when v_rec.saldo < 0 then -v_rec.saldo else 0 end,
         case when v_rec.saldo > 0 then v_rec.saldo else 0 end,
         v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid());

      if v_rec.saldo > 0 then v_debit_total := v_debit_total + v_rec.saldo;
      else v_credit_total := v_credit_total + (-v_rec.saldo); end if;
      v_count := v_count + 1;
    end loop;

    if v_debit_total > 0 then
      insert into public.journal_legs
        (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
         historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
      values
        (_period_id, v_result, v_res_id, null, v_doc, v_last,
         'MULTI-DÉBITO Encerramento parcial ' || to_char(v_period.reference_month, 'MM/YYYY'),
         v_debit_total, 0, v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid());
    end if;

    if v_credit_total > 0 then
      insert into public.journal_legs
        (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
         historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
      values
        (_period_id, v_result, v_res_id, null, v_doc, v_last,
         'MULTI-CRÉDITO Encerramento parcial ' || to_char(v_period.reference_month, 'MM/YYYY'),
         0, v_credit_total, v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid());
    end if;

    v_result_value := v_credit_total - v_debit_total;

    if abs(v_result_value) > 0.004 then
      insert into public.journal_legs
        (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
         historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
      values
        (_period_id, v_result, v_res_id, v_profit, v_doc, v_last,
         'Resultado parcial ' || to_char(v_period.reference_month, 'MM/YYYY'),
         case when v_result_value > 0 then v_result_value else 0 end,
         case when v_result_value < 0 then -v_result_value else 0 end,
         v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid()),
        (_period_id, v_profit, v_profit_id, v_result, v_doc, v_last,
         'Resultado parcial ' || to_char(v_period.reference_month, 'MM/YYYY'),
         case when v_result_value < 0 then -v_result_value else 0 end,
         case when v_result_value > 0 then v_result_value else 0 end,
         v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid());
    end if;
  end if;

  update public.accounting_periods set status = 'fechado', updated_at = now() where id = _period_id;

  insert into public.accounting_closings
    (year, month, period_id, kind, status, entry_group, result_code, profit_code, mode, result_value, closed_by)
  values
    (v_year, v_month, _period_id, 'mensal', 'fechado',
     case when _mode = 'gerar' then v_group else null end,
     v_result, v_profit, _mode, v_result_value, auth.uid());

  perform public.recalculate_period_indicators_internal(_period_id);
  perform public.log_activity('fechou o período ' || v_period.label, 'accounting_periods', _period_id,
    jsonb_build_object('modo', _mode, 'contas_encerradas', v_count, 'resultado', v_result_value));

  return jsonb_build_object('accounts', v_count, 'result_value', v_result_value, 'mode', _mode);
end $function$;

create or replace function public.reopen_period(_period_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_period record; v_year int; v_month int; v_closing record; v_cancelled int := 0; v_post int[];
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores. Somente o Admin pode cancelar fechamentos.'; end if;

  select * into v_period from public.accounting_periods where id = _period_id;
  if not found then raise exception 'Período não encontrado.'; end if;

  v_year := extract(year from v_period.reference_month);
  v_month := extract(month from v_period.reference_month);

  if v_period.status <> 'fechado' then
    raise exception 'O período % não está fechado; não há fechamento a cancelar.', v_period.label;
  end if;

  if exists (select 1 from public.accounting_closings where year = _year_dummy_guard() and false) then null; end if;

  if exists (select 1 from public.accounting_closings where year = v_year and kind = 'anual' and status = 'fechado') then
    raise exception 'O exercício % está fechado. Cancele primeiro o fechamento do exercício % e depois reabra os meses, do mais recente para o mais antigo.', v_year, v_year;
  end if;

  select array_agg(extract(month from p.reference_month)::int)
    into v_post
    from public.accounting_periods p
   where extract(year from p.reference_month) = v_year
     and extract(month from p.reference_month) > v_month
     and p.status = 'fechado';

  if v_post is not null and array_length(v_post, 1) > 0 then
    raise exception 'Ordem obrigatória: reabra antes % de %. A reabertura acontece do mês mais recente para o mais antigo.',
      public.month_names_pt(v_post), v_year;
  end if;

  select * into v_closing from public.accounting_closings
   where period_id = _period_id and kind = 'mensal' and status = 'fechado'
   order by closed_at desc limit 1;

  if v_closing.entry_group is not null then
    with upd as (
      update public.journal_legs
         set status = 'cancelado', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now()
       where entry_group = v_closing.entry_group and status = 'ativo'
      returning 1
    ) select count(*) into v_cancelled from upd;
  end if;

  if v_closing.id is not null then
    update public.accounting_closings
       set status = 'cancelado', reopened_by = auth.uid(), reopened_at = now()
     where id = v_closing.id;
  end if;

  update public.accounting_periods set status = 'aberto', updated_at = now() where id = _period_id;

  perform public.recalculate_period_indicators_internal(_period_id);
  perform public.log_activity('cancelou o fechamento do período ' || v_period.label,
    'accounting_periods', _period_id, jsonb_build_object('lancamentos_cancelados', v_cancelled));

  return jsonb_build_object('cancelled_legs', v_cancelled);
end $function$;

create or replace function public.close_fiscal_year(_year integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_result text; v_profit text;
  v_dec record; v_group uuid := gen_random_uuid();
  v_saldo numeric; v_line int; v_doc text; v_last date;
  v_res_id uuid; v_profit_id uuid;
  v_missing int[]; v_open int[];
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores. Somente o Admin pode fechar o exercício.'; end if;

  if exists (select 1 from public.accounting_closings where year = _year and kind = 'anual' and status = 'fechado') then
    raise exception 'O exercício % já está fechado.', _year;
  end if;

  select array_agg(m) into v_missing
    from generate_series(1, 12) as m
   where not exists (
     select 1 from public.accounting_periods p
      where extract(year from p.reference_month) = _year
        and extract(month from p.reference_month) = m
   );

  select array_agg(extract(month from p.reference_month)::int) into v_open
    from public.accounting_periods p
   where extract(year from p.reference_month) = _year
     and p.status <> 'fechado';

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    raise exception 'O exercício % não pode ser fechado: falta cadastrar o período de %.', _year, public.month_names_pt(v_missing);
  end if;

  if v_open is not null and array_length(v_open, 1) > 0 then
    raise exception 'O exercício % não pode ser fechado: ainda estão abertos %. Feche os 12 meses, em ordem, antes do fechamento anual.',
      _year, public.month_names_pt(v_open);
  end if;

  v_result := coalesce((select value from public.app_settings where key = 'closing.result_account'), '023511');
  v_profit := coalesce((select value from public.app_settings where key = 'closing.profit_account'), '023413');

  select * into v_dec from public.accounting_periods p
   where extract(year from p.reference_month) = _year and extract(month from p.reference_month) = 12;
  if not found then raise exception 'Dezembro de % não está cadastrado.', _year; end if;

  select id into v_res_id from public.ledger_accounts where reduced_code = v_result;
  select id into v_profit_id from public.ledger_accounts where reduced_code = v_profit;
  if v_res_id is null or v_profit_id is null then
    raise exception 'Contas de encerramento (% e %) não encontradas no plano do razão.', v_result, v_profit;
  end if;

  select coalesce(sum(l.debit - l.credit), 0) into v_saldo
    from public.journal_legs l
    join public.accounting_periods p on p.id = l.period_id
   where extract(year from p.reference_month) = _year
     and l.status = 'ativo'
     and l.account_reduced_code = v_result;

  v_last := make_date(_year, 12, 31);
  v_doc := 'FCH' || _year::text;
  select coalesce(max(line_no), 0) + 1 into v_line from public.journal_legs where period_id = v_dec.id;

  if abs(v_saldo) > 0.004 then
    insert into public.journal_legs
      (period_id, account_reduced_code, account_id, counterpart_reduced_code, doc_number, entry_date,
       historico, debit, credit, line_no, status, origin, entry_group, created_by, updated_by)
    values
      (v_dec.id, v_result, v_res_id, v_profit, v_doc, v_last,
       'Encerramento do exercício ' || _year::text,
       case when v_saldo < 0 then -v_saldo else 0 end,
       case when v_saldo > 0 then v_saldo else 0 end,
       v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid()),
      (v_dec.id, v_profit, v_profit_id, v_result, v_doc, v_last,
       'Encerramento do exercício ' || _year::text,
       case when v_saldo > 0 then v_saldo else 0 end,
       case when v_saldo < 0 then -v_saldo else 0 end,
       v_line, 'ativo', 'fechamento', v_group, auth.uid(), auth.uid());
  end if;

  insert into public.accounting_closings
    (year, month, period_id, kind, status, entry_group, result_code, profit_code, mode, result_value, closed_by)
  values
    (_year, null, v_dec.id, 'anual', 'fechado', v_group, v_result, v_profit, 'gerar', -v_saldo, auth.uid());

  perform public.recalculate_period_indicators_internal(v_dec.id);
  perform public.log_activity('fechou o exercício ' || _year::text, 'accounting_periods', v_dec.id,
    jsonb_build_object('resultado', -v_saldo));

  return jsonb_build_object('result_value', -v_saldo);
end $function$;

create or replace function public.reopen_fiscal_year(_year integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_closing record; v_cancelled int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores. Somente o Admin pode cancelar o fechamento do exercício.'; end if;

  select * into v_closing from public.accounting_closings
   where year = _year and kind = 'anual' and status = 'fechado' limit 1;
  if not found then raise exception 'O exercício % não está fechado; não há fechamento anual a cancelar.', _year; end if;

  if v_closing.entry_group is not null then
    with upd as (
      update public.journal_legs
         set status = 'cancelado', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now()
       where entry_group = v_closing.entry_group and status = 'ativo'
      returning 1
    ) select count(*) into v_cancelled from upd;
  end if;

  update public.accounting_closings
     set status = 'cancelado', reopened_by = auth.uid(), reopened_at = now()
   where id = v_closing.id;

  if v_closing.period_id is not null then
    perform public.recalculate_period_indicators_internal(v_closing.period_id);
  end if;
  perform public.log_activity('cancelou o fechamento do exercício ' || _year::text,
    'accounting_periods', v_closing.period_id, jsonb_build_object('lancamentos_cancelados', v_cancelled));

  return jsonb_build_object('cancelled_legs', v_cancelled);
end $function$;

revoke execute on function public.month_names_pt(int[]) from anon;
grant execute on function public.month_names_pt(int[]) to authenticated, service_role;
