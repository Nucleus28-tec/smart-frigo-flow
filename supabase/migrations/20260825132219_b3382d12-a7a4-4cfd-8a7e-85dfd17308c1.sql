CREATE OR REPLACE FUNCTION public.journal_line_legs(_period_id uuid, _codes text[] DEFAULT NULL::text[], _from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _query text DEFAULT NULL::text, _include_hidden boolean DEFAULT true, _limit integer DEFAULT 200, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  q text := public.txt_norm(coalesce(_query, ''));
  lim integer := greatest(1, least(coalesce(_limit, 200), 500));
  off integer := greatest(0, coalesce(_offset, 0));
  total bigint; soma numeric; ocultos bigint; soma_oculta numeric; rows jsonb;
  abertura numeric := 0; mov_anterior numeric := 0;
  mov_ativo numeric := 0; mov_todos numeric := 0;
  saldo_inicial numeric := 0;
begin
  -- Saldos da(s) conta(s) aberta(s) no painel: abertura do periodo + movimento
  -- anterior a data inicial (saldo inicial) e movimento do intervalo (saldo final).
  select coalesce(sum(o.opening_balance), 0) into abertura
  from public.journal_account_openings o
  where o.period_id = _period_id
    and (_codes is null or array_length(_codes,1) is null
         or o.account_reduced_code = any(_codes));

  select coalesce(sum(case when _from is not null and l.entry_date < _from
                          then l.debit - l.credit else 0 end), 0),
         coalesce(sum(case when (_from is null or l.entry_date >= _from)
                            and (_to is null or l.entry_date <= _to)
                            and l.status = 'ativo'
                          then l.debit - l.credit else 0 end), 0),
         coalesce(sum(case when (_from is null or l.entry_date >= _from)
                            and (_to is null or l.entry_date <= _to)
                          then l.debit - l.credit else 0 end), 0)
  into mov_anterior, mov_ativo, mov_todos
  from public.journal_legs l
  where l.period_id = _period_id
    and l.status in ('ativo','oculto')
    and (_codes is null or array_length(_codes,1) is null
         or l.account_reduced_code = any(_codes));

  saldo_inicial := abertura + mov_anterior;

  with base as (
    select l.id, l.entry_group, l.status, l.origin, l.doc_number, l.entry_date, l.historico,
           l.excluded_reason, l.excluded_at,
           greatest(l.debit, l.credit) as valor,
           case when l.debit > 0 then l.account_reduced_code else l.counterpart_reduced_code end as debit_code,
           case when l.debit > 0 then l.counterpart_reduced_code else l.account_reduced_code end as credit_code,
           l.account_reduced_code as leg_code,
           l.debit, l.credit, l.line_no,
           (select count(*) from public.journal_leg_comments c where c.leg_id = l.id) as comments
    from public.journal_legs l
    where l.period_id = _period_id
      and l.debit > 0
      and l.status in ('ativo','oculto')
      and (_include_hidden or l.status = 'ativo')
      and (_codes is null or array_length(_codes,1) is null
           or l.account_reduced_code = any(_codes)
           or l.counterpart_reduced_code = any(_codes))
      and (_from is null or l.entry_date >= _from)
      and (_to is null or l.entry_date <= _to)
  ), enriched as (
    select b.*,
           coalesce(d.name, od.account_name, b.debit_code) as debit_name,
           coalesce(c.name, oc.account_name, b.credit_code) as credit_name
    from base b
    left join public.ledger_accounts d on d.reduced_code = b.debit_code
    left join public.ledger_accounts c on c.reduced_code = b.credit_code
    left join public.journal_account_openings od
      on od.period_id = _period_id and od.account_reduced_code = b.debit_code
    left join public.journal_account_openings oc
      on oc.period_id = _period_id and oc.account_reduced_code = b.credit_code
  ), filtered as (
    select * from enriched e
    where length(q) < 2
       or public.txt_norm(e.doc_number) like '%'||q||'%'
       or public.txt_norm(e.historico) like '%'||q||'%'
       or public.txt_norm(e.debit_code) like '%'||q||'%'
       or public.txt_norm(e.credit_code) like '%'||q||'%'
       or public.txt_norm(e.debit_name) like '%'||q||'%'
       or public.txt_norm(e.credit_name) like '%'||q||'%'
  ), agg as (
    select count(*) as n,
           coalesce(sum(case when status='ativo' then valor else 0 end),0) as s,
           count(*) filter (where status='oculto') as h,
           coalesce(sum(case when status='oculto' then valor else 0 end),0) as hs
    from filtered
  ), page as (
    select id, entry_group, status, origin, doc_number, entry_date, historico,
           valor, debit_code, debit_name, credit_code, credit_name,
           excluded_reason, excluded_at, comments
    from filtered
    order by entry_date desc nulls last, doc_number desc nulls last, line_no
    limit lim offset off
  )
  select (select n from agg), (select s from agg), (select h from agg), (select hs from agg),
         coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'::jsonb)
  into total, soma, ocultos, soma_oculta, rows;

  return jsonb_build_object('total', total, 'soma', soma, 'ocultos', ocultos,
                            'soma_oculta', soma_oculta,
                            'saldo_inicial', saldo_inicial,
                            'saldo_final', saldo_inicial + mov_ativo,
                            'saldo_final_com_ocultos', saldo_inicial + mov_todos,
                            'rows', rows);
end $function$;