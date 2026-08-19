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
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
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

  with grid as (
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
      )
  ), agg as (
    select count(*) as n, coalesce(sum(valor), 0) as s from grid
  ), page as (
    select id, entry_group, status, origin, doc_number, entry_date, historico,
           valor, debit_code, debit_name, credit_code, credit_name
    from grid
    order by entry_date desc nulls last, doc_number desc nulls last, line_no
    limit lim offset off
  )
  select (select n from agg), (select s from agg),
         coalesce((select jsonb_agg(to_jsonb(p)) from page p), '[]'::jsonb)
  into total, soma, rows;

  return jsonb_build_object('total', total, 'soma', soma, 'rows', rows);
end $function$;

revoke all on function public.journal_entries_grid(uuid, text, date, date, text, boolean, integer, integer) from public, anon;
grant execute on function public.journal_entries_grid(uuid, text, date, date, text, boolean, integer, integer) to authenticated, service_role;