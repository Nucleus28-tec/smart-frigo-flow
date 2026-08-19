alter table public.journal_legs
  add column if not exists status text not null default 'ativo',
  add column if not exists origin text not null default 'importado',
  add column if not exists entry_group uuid,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_legs_period_status_date on public.journal_legs (period_id, status, entry_date);
create index if not exists idx_legs_entry_group on public.journal_legs (entry_group);

-- ============ leituras passam a filtrar status ============

create or replace function public.journal_account_statement(_period_id uuid, _reduced_code text, _limit integer default 500, _offset integer default 0)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'account', (select to_jsonb(a) from public.ledger_accounts a where a.reduced_code = _reduced_code),
    'opening_balance', coalesce((select o.opening_balance from public.journal_account_openings o
        where o.period_id = _period_id and o.account_reduced_code = _reduced_code), 0),
    'total_debit', coalesce((select sum(debit) from public.journal_legs
        where period_id = _period_id and account_reduced_code = _reduced_code and status = 'ativo'), 0),
    'total_credit', coalesce((select sum(credit) from public.journal_legs
        where period_id = _period_id and account_reduced_code = _reduced_code and status = 'ativo'), 0),
    'count', coalesce((select count(*) from public.journal_legs
        where period_id = _period_id and account_reduced_code = _reduced_code and status = 'ativo'), 0),
    'legs', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select l.id, l.doc_number, l.entry_date, l.historico, l.debit, l.credit,
               l.running_balance, l.counterpart_reduced_code,
               c.name as counterpart_name, c.hierarchical_code as counterpart_code
        from public.journal_legs l
        left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
        where l.period_id = _period_id and l.account_reduced_code = _reduced_code and l.status = 'ativo'
        order by l.entry_date nulls last, l.line_no
        limit _limit offset _offset
      ) x), '[]'::jsonb)
  );
$function$;

create or replace function public.journal_document(_period_id uuid, _doc_number text)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'doc_number', _doc_number,
    'total_debit', coalesce((select sum(debit) from public.journal_legs where period_id = _period_id and doc_number = _doc_number and status = 'ativo'), 0),
    'total_credit', coalesce((select sum(credit) from public.journal_legs where period_id = _period_id and doc_number = _doc_number and status = 'ativo'), 0),
    'legs', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select l.id, l.entry_date, l.historico, l.debit, l.credit,
               l.account_reduced_code, a.name as account_name, a.hierarchical_code as account_code,
               l.counterpart_reduced_code, c.name as counterpart_name
        from public.journal_legs l
        left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
        left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
        where l.period_id = _period_id and l.doc_number = _doc_number and l.status = 'ativo'
        order by l.debit desc
      ) x), '[]'::jsonb)
  );
$function$;

create or replace function public.journal_top_counterparts(_period_id uuid, _reduced_code text, _limit integer default 10)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select l.counterpart_reduced_code as rc, c.name as nome,
           count(*) as ocorrencias,
           sum(l.debit) as debito, sum(l.credit) as credito
    from public.journal_legs l
    left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
    where l.period_id = _period_id and l.account_reduced_code = _reduced_code
      and l.counterpart_reduced_code is not null and l.status = 'ativo'
    group by l.counterpart_reduced_code, c.name
  ), tot as (select coalesce(sum(ocorrencias),0)::numeric as t from base)
  select jsonb_build_object(
    'conta', _reduced_code,
    'total_lancamentos', (select t from tot),
    'contrapartidas', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select b.rc as codigo_reduzido, b.nome, b.ocorrencias, b.debito, b.credito,
             case when (select t from tot) > 0
                  then round(100 * b.ocorrencias / (select t from tot), 1) else 0 end as percentual
      from base b order by b.ocorrencias desc limit greatest(1, least(_limit, 50))) x), '[]'::jsonb)
  );
$function$;

create or replace function public.journal_search(_period_id uuid, _query text, _limit integer default 50, _offset integer default 0)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  q text := public.txt_norm(coalesce(_query, ''));
  qval numeric;
  lim integer := greatest(1, least(coalesce(_limit, 50), 200));
  off integer := greatest(0, coalesce(_offset, 0));
  total bigint;
  rows jsonb;
begin
  if length(q) < 2 then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'query', _query);
  end if;

  begin
    qval := replace(replace(regexp_replace(_query, '[^0-9,.\-]', '', 'g'), '.', ''), ',', '.')::numeric;
  exception when others then
    qval := null;
  end;

  with hits as (
    select l.id, l.entry_date, l.doc_number, l.debit, l.credit, l.line_no, l.historico,
           l.account_reduced_code, l.counterpart_reduced_code,
           a.name as account_name, c.name as counterpart_name
    from public.journal_legs l
    left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
    left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
    where l.period_id = _period_id and l.status = 'ativo'
      and (
        public.txt_norm(l.doc_number) like '%' || q || '%'
        or public.txt_norm(l.historico) like '%' || q || '%'
        or public.txt_norm(l.account_reduced_code) like '%' || q || '%'
        or public.txt_norm(l.counterpart_reduced_code) like '%' || q || '%'
        or public.txt_norm(a.name) like '%' || q || '%'
        or public.txt_norm(c.name) like '%' || q || '%'
        or (qval is not null and (l.debit = qval or l.credit = qval))
      )
  ),
  counted as (select count(*) as n from hits),
  page as (
    select h.id, h.entry_date, h.doc_number, h.debit, h.credit,
           greatest(h.debit, h.credit) as valor, h.historico,
           case when h.debit > 0 then h.account_reduced_code else h.counterpart_reduced_code end as debit_code,
           case when h.debit > 0 then coalesce(h.account_name, h.account_reduced_code) else coalesce(h.counterpart_name, h.counterpart_reduced_code) end as debit_name,
           case when h.debit > 0 then h.counterpart_reduced_code else h.account_reduced_code end as credit_code,
           case when h.debit > 0 then coalesce(h.counterpart_name, h.counterpart_reduced_code) else coalesce(h.account_name, h.account_reduced_code) end as credit_name
    from hits h
    order by h.entry_date desc nulls last, h.doc_number desc nulls last, h.line_no
    limit lim offset off
  )
  select (select n from counted), coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'::jsonb)
  into total, rows;

  return jsonb_build_object('total', total, 'rows', rows, 'query', _query);
end;
$function$;

create or replace function public.reconcile_journal_vs_trial_balance(_period_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with mov as (
    select a.reduced_code, a.name, a.hierarchical_code,
           sum(l.debit) as deb, sum(l.credit) as cred
    from public.journal_legs l
    join public.ledger_accounts a on a.id = l.account_id
    where l.period_id = _period_id and l.status = 'ativo'
    group by a.reduced_code, a.name, a.hierarchical_code
  ), tb as (
    select code, name, debito, credito
    from public.trial_balance_lines
    where period_id = _period_id and is_analytic
  ), j as (
    select coalesce(m.reduced_code, '-') as reduced_code,
           coalesce(m.name, t.name) as name,
           coalesce(m.hierarchical_code, t.code) as code,
           coalesce(m.deb,0) as razao_debito,
           coalesce(m.cred,0) as razao_credito,
           t.debito as balancete_debito,
           t.credito as balancete_credito,
           case when m.reduced_code is null then 'so_balancete'
                when t.code is null then 'so_razao'
                when round(coalesce(m.deb,0),2) <> round(t.debito,2)
                  or round(coalesce(m.cred,0),2) <> round(t.credito,2) then 'divergente'
                else 'ok' end as status
    from mov m
    full outer join tb t on t.code = m.hierarchical_code
  )
  select jsonb_build_object(
    'total', (select count(*) from j),
    'ok', (select count(*) from j where status = 'ok'),
    'divergente', (select count(*) from j where status = 'divergente'),
    'so_razao', (select count(*) from j where status = 'so_razao'),
    'so_balancete', (select count(*) from j where status = 'so_balancete'),
    'linhas', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from j where status <> 'ok' order by status, code nulls last limit 500
      ) x), '[]'::jsonb)
  );
$function$;

create or replace function public.journal_pending_report(_period_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with mov as (
    select a.reduced_code, a.name, a.hierarchical_code, a.nature,
           sum(l.debit) as deb, sum(l.credit) as cred
    from public.journal_legs l
    join public.ledger_accounts a on a.id = l.account_id
    where l.period_id = _period_id and l.status = 'ativo'
    group by a.reduced_code, a.name, a.hierarchical_code, a.nature
  ), tb as (
    select code, name, debito, credito
    from public.trial_balance_lines
    where period_id = _period_id and is_analytic
  ), cand as (
    select m.rc, count(t.code) as candidatos from (
      select reduced_code as rc, name from mov where hierarchical_code is null
    ) m
    left join tb t on public.norm_account_base(t.name) = public.norm_account_base(m.name)
    group by m.rc
  ), rows as (
    select m.reduced_code, m.name, null::text as code,
           case when coalesce(c.candidatos,0) = 0 then 'sem_candidato'
                when c.candidatos > 1 then 'varios_candidatos'
                else 'candidato_ambiguo' end as causa,
           case when coalesce(c.candidatos,0) = 0
                then 'Conta nova no razão, ausente no balancete deste período.'
                else c.candidatos || ' conta(s) do balancete têm nome equivalente.' end as detalhe,
           'Vincular manualmente em Razão › Vínculos.' as acao,
           0::numeric as delta
    from mov m left join cand c on c.rc = m.reduced_code
    where m.hierarchical_code is null

    union all
    select m.reduced_code, m.name, m.hierarchical_code, 'sem_natureza',
           'Natureza indefinida para o código ' || m.hierarchical_code || '.',
           'Definir a natureza contábil da conta.', 0
    from mov m
    where m.hierarchical_code is not null and m.nature is null

    union all
    select m.reduced_code, m.name, m.hierarchical_code, 'diferenca_valor',
           'Razão D ' || round(m.deb,2) || ' / C ' || round(m.cred,2) ||
           ' × Balancete D ' || round(t.debito,2) || ' / C ' || round(t.credito,2) || '.',
           'Conferir lançamentos da conta no período.',
           round((m.deb - t.debito) + (m.cred - t.credito), 2)
    from mov m join tb t on t.code = m.hierarchical_code
    where round(m.deb,2) <> round(t.debito,2) or round(m.cred,2) <> round(t.credito,2)

    union all
    select null, t.name, t.code, 'so_balancete',
           'Conta do balancete sem movimento correspondente no razão.',
           'Verificar se o razão foi importado por completo.', 0
    from tb t
    where not exists (select 1 from mov m where m.hierarchical_code = t.code)
      and (t.debito <> 0 or t.credito <> 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'por_causa', coalesce((select jsonb_object_agg(causa, n) from (
        select causa, count(*) as n from rows group by causa) g), '{}'::jsonb),
    'linhas', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from rows order by causa, coalesce(code, reduced_code) limit 1000) x), '[]'::jsonb)
  );
$function$;

create or replace function public.recalculate_period_indicators_internal(_period_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_caixa numeric := 0; v_margem numeric := 0; v_ebitda numeric := 0; v_liquido numeric := 0;
  v_has_journal boolean;
begin
  select exists (select 1 from public.journal_legs where period_id = _period_id and status = 'ativo') into v_has_journal;

  if v_has_journal then
    select
      coalesce(sum(l.credit - l.debit) filter (where a.nature = 'receita'), 0),
      coalesce(sum(l.debit - l.credit) filter (where a.nature = 'custo'), 0),
      coalesce(sum(l.debit - l.credit) filter (where a.nature = 'despesa'), 0)
    into v_receita, v_custo, v_despesa
    from public.journal_legs l
    join public.ledger_accounts a on a.id = l.account_id
    where l.period_id = _period_id and l.status = 'ativo';

    select coalesce(sum(coalesce(o.opening_balance,0) + coalesce(m.deb,0) - coalesce(m.cred,0)), 0)
      into v_caixa
    from public.ledger_accounts a
    left join public.journal_account_openings o
      on o.period_id = _period_id and o.account_reduced_code = a.reduced_code
    left join (
      select account_reduced_code, sum(debit) deb, sum(credit) cred
      from public.journal_legs where period_id = _period_id and status = 'ativo'
      group by account_reduced_code
    ) m on m.account_reduced_code = a.reduced_code
    where a.nature = 'ativo_circulante'
      and (a.name ilike '%caixa%' or a.name ilike '%banco%' or a.name ilike '%aplica%');
  else
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
  end if;

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
    'source', case when v_has_journal then 'razao' else 'balancete' end,
    'receita_total', v_receita, 'custo_total', v_custo, 'margem_bruta', v_margem,
    'ebitda', v_ebitda, 'resultado_liquido', v_liquido, 'posicao_caixa', v_caixa
  );
end $function$;