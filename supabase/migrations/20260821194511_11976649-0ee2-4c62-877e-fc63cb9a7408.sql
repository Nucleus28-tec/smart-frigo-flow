-- 1) Marcação de ocultos em journal_legs (status 'oculto' já sai de todos os cálculos, que filtram status='ativo')
alter table public.journal_legs
  add column if not exists excluded_reason text,
  add column if not exists excluded_by uuid references public.profiles(id),
  add column if not exists excluded_at timestamptz;

create index if not exists idx_journal_legs_status_period on public.journal_legs(period_id, status);

-- 2) Comentários por lançamento
create table if not exists public.journal_leg_comments (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.journal_legs(id) on delete cascade,
  period_id uuid references public.accounting_periods(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_journal_leg_comments_leg on public.journal_leg_comments(leg_id, created_at desc);

grant select, insert, update, delete on public.journal_leg_comments to authenticated;
grant all on public.journal_leg_comments to service_role;
alter table public.journal_leg_comments enable row level security;

drop policy if exists "comments_select" on public.journal_leg_comments;
create policy "comments_select" on public.journal_leg_comments
  for select to authenticated using (true);
drop policy if exists "comments_insert" on public.journal_leg_comments;
create policy "comments_insert" on public.journal_leg_comments
  for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "comments_update" on public.journal_leg_comments;
create policy "comments_update" on public.journal_leg_comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "comments_delete" on public.journal_leg_comments;
create policy "comments_delete" on public.journal_leg_comments
  for delete to authenticated using (author_id = auth.uid() or public.is_admin());

-- 3) Ocultar / reexibir um lançamento (as duas pernas)
create or replace function public.set_journal_leg_excluded(_leg_id uuid, _excluded boolean, _motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_leg record; v_status text; v_count int; v_new text;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select * into v_leg from public.journal_legs where id = _leg_id;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  if v_leg.status = 'cancelado' then raise exception 'Lançamento cancelado não pode ser ocultado.'; end if;

  select status into v_status from public.accounting_periods where id = v_leg.period_id;
  if v_status = 'fechado' then raise exception 'Período fechado: não é possível alterar lançamentos.'; end if;

  v_new := case when _excluded then 'oculto' else 'ativo' end;

  with upd as (
    update public.journal_legs l
       set status = v_new,
           excluded_reason = case when _excluded then nullif(btrim(coalesce(_motivo,'')),'') else null end,
           excluded_by = case when _excluded then auth.uid() else null end,
           excluded_at = case when _excluded then now() else null end,
           updated_at = now()
     where l.period_id = v_leg.period_id
       and l.status in ('ativo','oculto')
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
     case when _excluded then 'lancamento_oculto' else 'lancamento_reexibido' end,
     jsonb_build_object('doc', v_leg.doc_number, 'data', v_leg.entry_date,
                        'valor', greatest(v_leg.debit, v_leg.credit),
                        'historico', v_leg.historico)::text,
     coalesce(nullif(btrim(coalesce(_motivo,'')),''), v_new),
     'demonstrativos', auth.uid());

  perform public.log_activity(
    case when _excluded then 'journal_leg_hidden' else 'journal_leg_unhidden' end,
    'journal_legs', _leg_id,
    jsonb_build_object('motivo', _motivo, 'legs', v_count));

  perform public.recalculate_period_indicators_internal(v_leg.period_id);

  return jsonb_build_object('updated', v_count, 'status', v_new);
end $function$;

-- 4) Lançamentos que compõem uma linha do demonstrativo
create or replace function public.journal_line_legs(
  _period_id uuid,
  _codes text[] default null,
  _from date default null,
  _to date default null,
  _query text default null,
  _include_hidden boolean default true,
  _limit integer default 200,
  _offset integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','extensions'
as $function$
declare
  q text := public.txt_norm(coalesce(_query, ''));
  lim integer := greatest(1, least(coalesce(_limit, 200), 500));
  off integer := greatest(0, coalesce(_offset, 0));
  total bigint; soma numeric; ocultos bigint; soma_oculta numeric; rows jsonb;
begin
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
                            'soma_oculta', soma_oculta, 'rows', rows);
end $function$;

-- 5) Resumo dos ocultos do período (aviso nos demonstrativos)
create or replace function public.period_hidden_summary(_period_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'count', count(*),
    'total', coalesce(sum(greatest(l.debit, l.credit)), 0)
  )
  from public.journal_legs l
  where l.period_id = _period_id and l.status = 'oculto' and l.debit > 0
$function$;

grant execute on function public.set_journal_leg_excluded(uuid, boolean, text) to authenticated;
grant execute on function public.journal_line_legs(uuid, text[], date, date, text, boolean, integer, integer) to authenticated;
grant execute on function public.period_hidden_summary(uuid) to authenticated;