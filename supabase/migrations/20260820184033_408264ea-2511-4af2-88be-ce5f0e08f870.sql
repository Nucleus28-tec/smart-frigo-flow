-- 1. contas-pai faltantes
insert into public.ledger_accounts (reduced_code, hierarchical_code, name, level, parent_code, is_analytic, nature, link_status, is_active)
select 'S' || replace(trim(both '.' from p.hier), '.', ''), p.hier,
       'Grupo ' || trim(both '.' from p.hier),
       public.hier_level(p.hier), public.hier_parent(p.hier), false,
       public.nature_from_hierarchical(p.hier), 'confirmado', true
from (
  select distinct a.parent_code as hier
  from public.ledger_accounts a
  where a.parent_code is not null
    and not exists (select 1 from public.ledger_accounts p where p.hierarchical_code = a.parent_code)
) p
on conflict (reduced_code) do nothing;

-- 2. quem ainda ficou órfão perde o vínculo (não some da lista)
update public.ledger_accounts a
   set parent_code = null
 where a.parent_code is not null
   and not exists (select 1 from public.ledger_accounts p where p.hierarchical_code = a.parent_code);

-- 3. unicidade do código hierárquico
create unique index if not exists ledger_accounts_hier_uidx
  on public.ledger_accounts (hierarchical_code) where hierarchical_code is not null;

-- 4. sintética nunca recebe lançamento; inativa não recebe lançamento novo manual
create or replace function public.enforce_analytic_posting()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_acc public.ledger_accounts;
begin
  if coalesce(new.status, 'ativo') <> 'ativo' then return new; end if;
  select * into v_acc from public.ledger_accounts where reduced_code = new.account_reduced_code;
  if not found then return new; end if;
  if not v_acc.is_analytic then
    raise exception 'Conta % (%) é sintética — selecione uma conta analítica filha.',
      coalesce(v_acc.hierarchical_code, v_acc.reduced_code), v_acc.name;
  end if;
  if not v_acc.is_active and coalesce(new.origin, '') in ('manual', 'ajuste') then
    raise exception 'Conta % (%) está desativada — reative-a ou escolha outra conta.',
      v_acc.reduced_code, v_acc.name;
  end if;
  return new;
end $$;

drop trigger if exists trg_journal_legs_analytic on public.journal_legs;
create trigger trg_journal_legs_analytic
  before insert or update of account_reduced_code, status on public.journal_legs
  for each row execute function public.enforce_analytic_posting();

-- 5. sugestões da IA para o plano de contas
create table if not exists public.chart_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.ledger_accounts(id) on delete cascade,
  reduced_code text not null,
  account_name text not null default '',
  kind text not null,
  current_value text,
  suggested_value text not null,
  suggested_parent text,
  suggested_nature text,
  suggested_is_analytic boolean,
  reasoning text not null default '',
  confidence numeric not null default 0.5,
  proposal_hash text not null unique,
  status text not null default 'pendente',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.chart_ai_suggestions to authenticated;
grant all on public.chart_ai_suggestions to service_role;
alter table public.chart_ai_suggestions enable row level security;

drop policy if exists chart_ai_suggestions_select on public.chart_ai_suggestions;
create policy chart_ai_suggestions_select on public.chart_ai_suggestions
  for select to authenticated using (true);
drop policy if exists chart_ai_suggestions_insert on public.chart_ai_suggestions;
create policy chart_ai_suggestions_insert on public.chart_ai_suggestions
  for insert to authenticated with check (public.is_admin());
drop policy if exists chart_ai_suggestions_update on public.chart_ai_suggestions;
create policy chart_ai_suggestions_update on public.chart_ai_suggestions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists chart_ai_suggestions_delete on public.chart_ai_suggestions;
create policy chart_ai_suggestions_delete on public.chart_ai_suggestions
  for delete to authenticated using (public.is_admin());

create index if not exists chart_ai_suggestions_status_idx on public.chart_ai_suggestions (status, created_at desc);