create table if not exists public.period_excluded_accounts (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  reduced_code text not null,
  motivo text,
  excluded_by uuid references public.profiles(id),
  excluded_at timestamptz not null default now(),
  unique (period_id, reduced_code)
);

grant select on public.period_excluded_accounts to authenticated;
grant all on public.period_excluded_accounts to service_role;
alter table public.period_excluded_accounts enable row level security;

drop policy if exists "auth read excluded accounts" on public.period_excluded_accounts;
create policy "auth read excluded accounts" on public.period_excluded_accounts
  for select to authenticated using (true);
drop policy if exists "admin manage excluded accounts" on public.period_excluded_accounts;
create policy "admin manage excluded accounts" on public.period_excluded_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create index if not exists idx_period_excluded_accounts_period on public.period_excluded_accounts(period_id);

create or replace function public.period_account_balances(_period_id uuid)
 returns table(reduced_code text, account_name text, hierarchical_code text, nature text, opening_balance numeric, debit_mov numeric, credit_mov numeric, debit_all numeric, credit_all numeric, closing_balance numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with excl as (
    select x.reduced_code from public.period_excluded_accounts x where x.period_id = _period_id
    union
    select a.reduced_code from public.ledger_accounts a where a.is_active = false
  ),
  mov as (
    select
      l.account_reduced_code as code,
      sum(l.debit) filter (where not l.is_closing) as deb_mov,
      sum(l.credit) filter (where not l.is_closing) as cred_mov,
      sum(l.debit) as deb_all,
      sum(l.credit) as cred_all
    from public.journal_legs l
    where l.period_id = _period_id and l.status = 'ativo'
    group by l.account_reduced_code
  ),
  base as (
    select
      coalesce(a.reduced_code, m.code, o.account_reduced_code) as code,
      coalesce(a.name, o.account_name, m.code) as nome,
      a.hierarchical_code as hier,
      a.nature as nat,
      coalesce(o.opening_balance, 0) as abertura,
      coalesce(m.deb_mov, 0) as deb_mov,
      coalesce(m.cred_mov, 0) as cred_mov,
      coalesce(m.deb_all, 0) as deb_all,
      coalesce(m.cred_all, 0) as cred_all
    from public.ledger_accounts a
    full outer join mov m on m.code = a.reduced_code
    left join public.journal_account_openings o
      on o.period_id = _period_id and o.account_reduced_code = coalesce(a.reduced_code, m.code)
  )
  select
    code, nome, hier, nat,
    abertura, deb_mov, cred_mov, deb_all, cred_all,
    abertura + deb_all - cred_all
  from base
  where (abertura <> 0 or deb_all <> 0 or cred_all <> 0)
    and code not in (select reduced_code from excl)
$function$;

create or replace function public.set_account_excluded(_period_id uuid, _reduced_codes text[], _excluded boolean, _motivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_status text; v_new text; v_count int;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if _period_id is null or _reduced_codes is null or array_length(_reduced_codes,1) is null then
    return jsonb_build_object('updated', 0);
  end if;

  select status into v_status from public.accounting_periods where id = _period_id;
  if v_status is null then raise exception 'Período não encontrado.'; end if;
  if v_status = 'fechado' then raise exception 'Período fechado: não é possível alterar lançamentos.'; end if;

  v_new := case when _excluded then 'oculto' else 'ativo' end;

  with upd as (
    update public.journal_legs l
       set status = v_new,
           excluded_reason = case when _excluded then nullif(btrim(coalesce(_motivo,'')),'') else null end,
           excluded_by = case when _excluded then auth.uid() else null end,
           excluded_at = case when _excluded then now() else null end,
           updated_at = now()
     where l.period_id = _period_id
       and l.status in ('ativo','oculto')
       and l.status <> v_new
       and l.account_reduced_code = any(_reduced_codes)
    returning 1
  )
  select count(*) into v_count from upd;

  if _excluded then
    insert into public.period_excluded_accounts (period_id, reduced_code, motivo, excluded_by)
    select _period_id, c, nullif(btrim(coalesce(_motivo,'')),''), auth.uid()
    from unnest(_reduced_codes) as c
    on conflict (period_id, reduced_code) do update
      set motivo = excluded.motivo, excluded_by = excluded.excluded_by, excluded_at = now();
  else
    delete from public.period_excluded_accounts
     where period_id = _period_id and reduced_code = any(_reduced_codes);
  end if;

  insert into public.ledger_account_audit
    (period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  select _period_id, 'journal_legs', c,
         (select name from public.ledger_accounts where reduced_code = c),
         case when _excluded then 'conta_oculta' else 'conta_reexibida' end,
         null,
         coalesce(nullif(btrim(coalesce(_motivo,'')),''), v_new),
         'demonstrativos', auth.uid()
  from unnest(_reduced_codes) as c;

  perform public.log_activity(
    case when _excluded then 'account_hidden' else 'account_unhidden' end,
    'journal_legs', null,
    jsonb_build_object('period_id', _period_id, 'contas', _reduced_codes,
                       'motivo', _motivo, 'legs', v_count));

  perform public.recalculate_period_indicators_internal(_period_id);

  return jsonb_build_object('updated', v_count, 'status', v_new);
end $function$;

create or replace function public.period_hidden_summary(_period_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'count', (select count(*) from public.journal_legs l
               where l.period_id = _period_id and l.status = 'oculto' and l.debit > 0),
    'total', (select coalesce(sum(greatest(l.debit, l.credit)), 0) from public.journal_legs l
               where l.period_id = _period_id and l.status = 'oculto' and l.debit > 0),
    'accounts', (select count(*) from public.period_excluded_accounts x where x.period_id = _period_id),
    'opening_total', (select coalesce(sum(o.opening_balance), 0)
                        from public.period_excluded_accounts x
                        join public.journal_account_openings o
                          on o.period_id = x.period_id and o.account_reduced_code = x.reduced_code
                       where x.period_id = _period_id)
  )
$function$;

create or replace function public.period_hidden_accounts(_period_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(t order by t.reduced_code), '[]'::jsonb)
  from (
    select
      x.reduced_code,
      coalesce(a.name, o.account_name, x.reduced_code) as account_name,
      a.hierarchical_code,
      a.nature,
      x.motivo,
      x.excluded_at,
      coalesce(p.full_name, '—') as excluded_by_name,
      coalesce(o.opening_balance, 0) as opening_balance,
      (select count(*) from public.journal_legs l
        where l.period_id = _period_id and l.account_reduced_code = x.reduced_code
          and l.status = 'oculto') as hidden_legs
    from public.period_excluded_accounts x
    left join public.ledger_accounts a on a.reduced_code = x.reduced_code
    left join public.journal_account_openings o
      on o.period_id = x.period_id and o.account_reduced_code = x.reduced_code
    left join public.profiles p on p.id = x.excluded_by
    where x.period_id = _period_id
  ) t
$function$;

insert into public.period_excluded_accounts (period_id, reduced_code, motivo)
select distinct l.period_id, l.account_reduced_code, 'migrado: conta com lançamentos ocultos'
from public.journal_legs l
where l.status = 'oculto'
  and not exists (
    select 1 from public.journal_legs a
     where a.period_id = l.period_id
       and a.account_reduced_code = l.account_reduced_code
       and a.status = 'ativo')
on conflict do nothing;