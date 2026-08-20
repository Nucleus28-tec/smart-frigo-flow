-- ============ tabela de fechamentos ============
create table if not exists public.accounting_closings (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int,
  period_id uuid references public.accounting_periods(id) on delete cascade,
  kind text not null check (kind in ('mensal','anual')),
  status text not null default 'fechado' check (status in ('fechado','cancelado')),
  entry_group uuid,
  result_code text,
  profit_code text,
  mode text not null default 'gerar' check (mode in ('gerar','travar')),
  result_value numeric not null default 0,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now(),
  reopened_by uuid references public.profiles(id),
  reopened_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists accounting_closings_open_month
  on public.accounting_closings(year, month) where status = 'fechado' and kind = 'mensal';
create unique index if not exists accounting_closings_open_year
  on public.accounting_closings(year) where status = 'fechado' and kind = 'anual';

grant select on public.accounting_closings to authenticated;
grant all on public.accounting_closings to service_role;
alter table public.accounting_closings enable row level security;

drop policy if exists "closings_select" on public.accounting_closings;
create policy "closings_select" on public.accounting_closings
  for select to authenticated using (true);

insert into public.app_settings (key, value)
values ('closing.result_account', '023511'), ('closing.profit_account', '023413')
on conflict (key) do nothing;

-- ============ resumo por grupo contábil ============
create or replace function public.closing_summary(_period_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare _rows jsonb;
begin
  with base as (
    select coalesce(nullif(split_part(a.hierarchical_code, '.', 1), ''), left(l.account_reduced_code, 2)) as grp,
           coalesce(o.opening_balance, 0) as opening,
           l.debit, l.credit
    from public.journal_legs l
    left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
    left join public.journal_account_openings o
      on o.period_id = l.period_id and o.account_reduced_code = l.account_reduced_code
    where l.period_id = _period_id and l.status = 'ativo'
  ),
  op as (
    select coalesce(nullif(split_part(a.hierarchical_code, '.', 1), ''), left(o.account_reduced_code, 2)) as grp,
           sum(o.opening_balance) as saldo_anterior
    from public.journal_account_openings o
    left join public.ledger_accounts a on a.reduced_code = o.account_reduced_code
    where o.period_id = _period_id
    group by 1
  ),
  mv as (
    select grp, sum(debit) as debito, sum(credit) as credito
    from base group by 1
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.grp), '[]'::jsonb) into _rows
  from (
    select coalesce(mv.grp, op.grp) as grp,
           coalesce((select a.name from public.ledger_accounts a
                      where a.hierarchical_code = coalesce(mv.grp, op.grp) limit 1),
                    'GRUPO ' || coalesce(mv.grp, op.grp)) as name,
           coalesce(op.saldo_anterior, 0) as saldo_anterior,
           coalesce(mv.debito, 0) as debito,
           coalesce(mv.credito, 0) as credito,
           coalesce(mv.debito, 0) - coalesce(mv.credito, 0) as saldo_periodo,
           coalesce(op.saldo_anterior, 0) + coalesce(mv.debito, 0) - coalesce(mv.credito, 0) as saldo_atual
    from mv full join op on op.grp = mv.grp
  ) x;

  return jsonb_build_object('period_id', _period_id, 'rows', _rows);
end $$;

-- ============ quadro do ano ============
create or replace function public.closing_year_grid(_year int)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  _result_code text;
  _months jsonb;
  _annual jsonb;
  _closed_months int;
  _period_count int;
begin
  select value into _result_code from public.app_settings where key = 'closing.result_account';

  select coalesce(jsonb_agg(to_jsonb(m) order by m.month), '[]'::jsonb) into _months
  from (
    select g.month,
           p.id as period_id,
           p.label,
           coalesce(p.status, 'inexistente') as status,
           c.id as closing_id,
           c.closed_at,
           c.mode,
           c.result_value,
           pr.full_name as closed_by_name,
           exists (
             select 1 from public.journal_legs l
             where l.period_id = p.id and l.status = 'ativo'
               and l.origin <> 'fechamento'
               and l.account_reduced_code = coalesce(_result_code, '023511')
           ) as has_external_closing
    from generate_series(1, 12) as g(month)
    left join public.accounting_periods p
      on extract(year from p.reference_month) = _year
     and extract(month from p.reference_month) = g.month
    left join public.accounting_closings c
      on c.year = _year and c.month = g.month and c.kind = 'mensal' and c.status = 'fechado'
    left join public.profiles pr on pr.id = c.closed_by
  ) m;

  select count(*) filter (where p.status = 'fechado'), count(*)
    into _closed_months, _period_count
  from public.accounting_periods p
  where extract(year from p.reference_month) = _year;

  select to_jsonb(c) into _annual
  from (
    select c.id, c.closed_at, c.result_value, pr.full_name as closed_by_name
    from public.accounting_closings c
    left join public.profiles pr on pr.id = c.closed_by
    where c.year = _year and c.kind = 'anual' and c.status = 'fechado'
    limit 1
  ) c;

  return jsonb_build_object(
    'year', _year,
    'months', _months,
    'annual', _annual,
    'closed_months', coalesce(_closed_months, 0),
    'period_count', coalesce(_period_count, 0),
    'result_code', coalesce(_result_code, '023511'),
    'profit_code', coalesce((select value from public.app_settings where key = 'closing.profit_account'), '023413'),
    'is_admin', public.is_admin()
  );
end $$;

-- ============ fechamento parcial do mês ============
create or replace function public.close_period_partial(
  _period_id uuid,
  _result_code text default null,
  _profit_code text default null,
  _mode text default 'gerar'
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
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
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select * into v_period from public.accounting_periods where id = _period_id;
  if not found then raise exception 'Período não encontrado.'; end if;
  if v_period.status = 'fechado' then raise exception 'Este período já está fechado.'; end if;

  v_year := extract(year from v_period.reference_month);
  v_month := extract(month from v_period.reference_month);
  v_last := (date_trunc('month', v_period.reference_month) + interval '1 month - 1 day')::date;

  if exists (
    select 1 from public.accounting_periods p
    where extract(year from p.reference_month) = v_year
      and extract(month from p.reference_month) < v_month
      and p.status <> 'fechado'
  ) then
    raise exception 'Feche primeiro os meses anteriores de % (ordem obrigatória).', v_year;
  end if;

  if exists (select 1 from public.accounting_closings where year = v_year and kind = 'anual' and status = 'fechado') then
    raise exception 'O exercício % já está fechado. Cancele o fechamento anual antes.', v_year;
  end if;

  v_result := coalesce(nullif(btrim(coalesce(_result_code,'')),''),
                       (select value from public.app_settings where key = 'closing.result_account'), '023511');
  v_profit := coalesce(nullif(btrim(coalesce(_profit_code,'')),''),
                       (select value from public.app_settings where key = 'closing.profit_account'), '023413');

  if _mode = 'gerar' then
    select id into v_res_id from public.ledger_accounts where reduced_code = v_result;
    if v_res_id is null then raise exception 'Conta de resultado % não existe no plano do razão.', v_result; end if;
    select id into v_profit_id from public.ledger_accounts where reduced_code = v_profit;
    if v_profit_id is null then raise exception 'Conta de lucro/prejuízo % não existe no plano do razão.', v_profit; end if;

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
end $$;

-- ============ cancelamento do mês ============
create or replace function public.reopen_period(_period_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_period record; v_year int; v_month int; v_closing record; v_cancelled int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select * into v_period from public.accounting_periods where id = _period_id;
  if not found then raise exception 'Período não encontrado.'; end if;

  v_year := extract(year from v_period.reference_month);
  v_month := extract(month from v_period.reference_month);

  if exists (select 1 from public.accounting_closings where year = v_year and kind = 'anual' and status = 'fechado') then
    raise exception 'Cancele primeiro o fechamento do exercício %.', v_year;
  end if;

  if exists (
    select 1 from public.accounting_periods p
    where extract(year from p.reference_month) = v_year
      and extract(month from p.reference_month) > v_month
      and p.status = 'fechado'
  ) then
    raise exception 'Reabra primeiro os meses posteriores de % (ordem obrigatória).', v_year;
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
end $$;

-- ============ fechamento do exercício ============
create or replace function public.close_fiscal_year(_year int)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_result text; v_profit text;
  v_dec record; v_group uuid := gen_random_uuid();
  v_saldo numeric; v_line int; v_doc text; v_last date;
  v_res_id uuid; v_profit_id uuid;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  if (select count(*) from public.accounting_periods p
       where extract(year from p.reference_month) = _year and p.status = 'fechado') < 12 then
    raise exception 'O exercício % só pode ser fechado com os 12 meses fechados.', _year;
  end if;

  if exists (select 1 from public.accounting_closings where year = _year and kind = 'anual' and status = 'fechado') then
    raise exception 'O exercício % já está fechado.', _year;
  end if;

  v_result := coalesce((select value from public.app_settings where key = 'closing.result_account'), '023511');
  v_profit := coalesce((select value from public.app_settings where key = 'closing.profit_account'), '023413');

  select * into v_dec from public.accounting_periods p
   where extract(year from p.reference_month) = _year and extract(month from p.reference_month) = 12;
  if not found then raise exception 'Dezembro de % não está cadastrado.', _year; end if;

  select id into v_res_id from public.ledger_accounts where reduced_code = v_result;
  select id into v_profit_id from public.ledger_accounts where reduced_code = v_profit;
  if v_res_id is null or v_profit_id is null then
    raise exception 'Contas de encerramento não encontradas no plano do razão.';
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
end $$;

-- ============ cancelamento do exercício ============
create or replace function public.reopen_fiscal_year(_year int)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_closing record; v_cancelled int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select * into v_closing from public.accounting_closings
   where year = _year and kind = 'anual' and status = 'fechado' limit 1;
  if not found then raise exception 'O exercício % não está fechado.', _year; end if;

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
end $$;

-- ============ balancete analítico ou sintético ============
create or replace function public.trial_balance_report(
  _period_id uuid,
  _codes text[] default null,
  _from date default null,
  _to date default null,
  _mode text default 'analitico'
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
DECLARE
  _result jsonb;
BEGIN
  WITH mov AS (
    SELECT l.account_reduced_code AS code,
           sum(l.debit) AS debito,
           sum(l.credit) AS credito
    FROM public.journal_legs l
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND (_codes IS NULL OR array_length(_codes, 1) IS NULL OR l.account_reduced_code = ANY(_codes))
      AND (_from IS NULL OR l.entry_date >= _from)
      AND (_to IS NULL OR l.entry_date <= _to)
    GROUP BY 1
  ),
  prev AS (
    SELECT l.account_reduced_code AS code, sum(l.debit - l.credit) AS delta
    FROM public.journal_legs l
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND _from IS NOT NULL
      AND l.entry_date IS NOT NULL
      AND l.entry_date < _from
    GROUP BY 1
  ),
  analytic AS (
    SELECT m.code,
           coalesce(a.name, o.account_name, m.code) AS name,
           a.hierarchical_code,
           a.nature,
           coalesce(a.is_analytic, true) AS is_analytic,
           coalesce(a.level, 0) AS level,
           coalesce(o.opening_balance, 0) + coalesce(p.delta, 0) AS saldo_anterior,
           m.debito,
           m.credito,
           coalesce(o.opening_balance, 0) + coalesce(p.delta, 0) + m.debito - m.credito AS saldo_atual
    FROM mov m
    LEFT JOIN public.ledger_accounts a ON a.reduced_code = lpad(m.code, 6, '0')
    LEFT JOIN public.journal_account_openings o
      ON o.period_id = _period_id AND o.account_reduced_code = m.code
    LEFT JOIN prev p ON p.code = m.code
  ),
  synthetic AS (
    SELECT grp AS code,
           coalesce((SELECT a.name FROM public.ledger_accounts a
                      WHERE a.hierarchical_code = grp LIMIT 1), 'GRUPO ' || grp) AS name,
           grp AS hierarchical_code,
           NULL::text AS nature,
           false AS is_analytic,
           1 AS level,
           sum(saldo_anterior) AS saldo_anterior,
           sum(debito) AS debito,
           sum(credito) AS credito,
           sum(saldo_atual) AS saldo_atual
    FROM (
      SELECT coalesce(nullif(split_part(hierarchical_code, '.', 1), ''), left(code, 2)) AS grp, *
      FROM analytic
    ) s
    GROUP BY grp
  )
  SELECT jsonb_build_object(
    'period_id', _period_id,
    'from', _from,
    'to', _to,
    'mode', coalesce(_mode, 'analitico'),
    'totals', jsonb_build_object(
      'debito', coalesce((SELECT sum(debito) FROM mov), 0),
      'credito', coalesce((SELECT sum(credito) FROM mov), 0)
    ),
    'rows', coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.hierarchical_code NULLS LAST, x.code), '[]'::jsonb)
  )
  INTO _result
  FROM (
    SELECT * FROM analytic WHERE coalesce(_mode, 'analitico') <> 'sintetico'
    UNION ALL
    SELECT * FROM synthetic WHERE coalesce(_mode, 'analitico') = 'sintetico'
  ) x;

  RETURN _result;
END $$;