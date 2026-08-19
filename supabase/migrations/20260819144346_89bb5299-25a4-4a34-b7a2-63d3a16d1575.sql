create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function public.txt_norm(_t text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(_t, '')))
$$;

create index if not exists journal_legs_historico_trgm
  on public.journal_legs using gin (public.txt_norm(historico) extensions.gin_trgm_ops);
create index if not exists journal_legs_doc_trgm
  on public.journal_legs using gin (public.txt_norm(doc_number) extensions.gin_trgm_ops);
create index if not exists journal_legs_period_date
  on public.journal_legs (period_id, entry_date desc);
create index if not exists ledger_accounts_name_trgm
  on public.ledger_accounts using gin (public.txt_norm(name) extensions.gin_trgm_ops);
create index if not exists ledger_accounts_code_trgm
  on public.ledger_accounts using gin (public.txt_norm(reduced_code) extensions.gin_trgm_ops);

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

  create temp table if not exists _js_hits (id uuid primary key) on commit drop;
  truncate _js_hits;

  insert into _js_hits (id)
  select l.id
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
    );

  select count(*) into total from _js_hits;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into rows from (
    select l.id,
           l.entry_date,
           l.doc_number,
           l.debit,
           l.credit,
           greatest(l.debit, l.credit) as valor,
           l.historico,
           case when l.debit > 0 then l.account_reduced_code else l.counterpart_reduced_code end as debit_code,
           case when l.debit > 0 then coalesce(a.name, l.account_reduced_code) else coalesce(c.name, l.counterpart_reduced_code) end as debit_name,
           case when l.debit > 0 then l.counterpart_reduced_code else l.account_reduced_code end as credit_code,
           case when l.debit > 0 then coalesce(c.name, l.counterpart_reduced_code) else coalesce(a.name, l.account_reduced_code) end as credit_name
    from _js_hits h
    join public.journal_legs l on l.id = h.id
    left join public.ledger_accounts a on a.reduced_code = l.account_reduced_code
    left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
    order by l.entry_date desc nulls last, l.doc_number desc nulls last, l.line_no
    limit greatest(1, least(coalesce(_limit, 50), 200))
    offset greatest(0, coalesce(_offset, 0))
  ) x;

  return jsonb_build_object('total', total, 'rows', rows, 'query', _query);
end;
$$;

revoke all on function public.journal_search(uuid, text, integer, integer) from public;
grant execute on function public.journal_search(uuid, text, integer, integer) to authenticated, service_role;
grant execute on function public.txt_norm(text) to authenticated, anon, service_role;