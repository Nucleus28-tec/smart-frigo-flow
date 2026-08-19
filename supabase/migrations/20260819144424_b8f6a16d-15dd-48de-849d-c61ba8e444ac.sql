create or replace function public.journal_search(
  _period_id uuid,
  _query text,
  _limit integer default 50,
  _offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
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
    select l.id,
           l.entry_date,
           l.doc_number,
           l.debit,
           l.credit,
           l.line_no,
           l.historico,
           l.account_reduced_code,
           l.counterpart_reduced_code,
           a.name as account_name,
           c.name as counterpart_name
    from public.journal_legs l
    left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
    left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
    where l.period_id = _period_id
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
    select h.id,
           h.entry_date,
           h.doc_number,
           h.debit,
           h.credit,
           greatest(h.debit, h.credit) as valor,
           h.historico,
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
$$;

revoke all on function public.journal_search(uuid, text, integer, integer) from public;
grant execute on function public.journal_search(uuid, text, integer, integer) to authenticated, service_role;