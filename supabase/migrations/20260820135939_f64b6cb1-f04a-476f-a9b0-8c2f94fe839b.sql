CREATE OR REPLACE FUNCTION public.close_period_partial(_period_id uuid, _result_code text DEFAULT NULL::text, _profit_code text DEFAULT NULL::text, _mode text DEFAULT 'gerar'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             (array_agg(l.account_id) filter (where l.account_id is not null))[1] as account_id,
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