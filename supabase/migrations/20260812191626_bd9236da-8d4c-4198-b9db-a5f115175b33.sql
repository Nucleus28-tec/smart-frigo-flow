create or replace function public.sync_accounts_for_period(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_created int := 0; v_linked int := 0;
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;

  with novas as (
    select distinct btrim(e.source_account_name) as source_name
    from public.ledger_entries e
    where e.period_id = _period_id
      and btrim(e.source_account_name) <> ''
      and not exists (
        select 1 from public.chart_of_accounts c
        where c.source_name = btrim(e.source_account_name)
      )
  ), ins as (
    insert into public.chart_of_accounts (source_name)
    select source_name from novas
    returning 1
  )
  select count(*) into v_created from ins;

  with upd as (
    update public.ledger_entries e
    set account_id = c.id,
        nature = case when e.is_manually_edited then e.nature else coalesce(c.nature, e.nature) end
    from public.chart_of_accounts c
    where e.period_id = _period_id
      and c.source_name = btrim(e.source_account_name)
      and (
        e.account_id is distinct from c.id
        or e.nature is distinct from (case when e.is_manually_edited then e.nature else coalesce(c.nature, e.nature) end)
      )
    returning 1
  )
  select count(*) into v_linked from upd;

  return jsonb_build_object('created', v_created, 'linked', v_linked);
end;
$$;

revoke all on function public.sync_accounts_for_period(uuid) from public;
grant execute on function public.sync_accounts_for_period(uuid) to authenticated, service_role;