-- 1. helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'usuario' check (role in ('admin','usuario')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active = true);
$$;

create index idx_profiles_role on public.profiles (role);
create index idx_profiles_email on public.profiles (email);
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create policy "profiles_select" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles_insert" on public.profiles for insert to authenticated with check (public.is_admin());
create policy "profiles_update" on public.profiles for update to authenticated using (public.is_admin() or id = auth.uid()) with check (public.is_admin() or id = auth.uid());
create policy "profiles_delete" on public.profiles for delete to authenticated using (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select case when not exists (select 1 from public.profiles) then 'admin' else 'usuario' end into v_role;
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'role',''), v_role)
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 2. accounting_periods
create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  reference_month date not null,
  status text not null default 'aberto' check (status in ('aberto','em_revisao','fechado')),
  last_recalculated_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.accounting_periods to authenticated;
grant all on public.accounting_periods to service_role;
create index idx_periods_reference_month on public.accounting_periods (reference_month);
create index idx_periods_status on public.accounting_periods (status);
create index idx_periods_created_by on public.accounting_periods (created_by);
create trigger trg_periods_updated_at before update on public.accounting_periods for each row execute function public.set_updated_at();
alter table public.accounting_periods enable row level security;
create policy "periods_select" on public.accounting_periods for select to authenticated using (true);
create policy "periods_insert" on public.accounting_periods for insert to authenticated with check (public.is_admin());
create policy "periods_update" on public.accounting_periods for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "periods_delete" on public.accounting_periods for delete to authenticated using (public.is_admin());

-- 3. imported_files
create table public.imported_files (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_type text not null check (file_type in ('balancete','pedido_compra','nota_fiscal','romaneio_abate','contas_pagar','contas_receber','relatorio_vendas','extrato_sicoob')),
  original_name text not null,
  storage_path text not null,
  mime_type text not null,
  processing_status text not null default 'pendente' check (processing_status in ('pendente','processando','processado','erro')),
  processing_error text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.imported_files to authenticated;
grant all on public.imported_files to service_role;
create index idx_files_period on public.imported_files (period_id);
create index idx_files_status on public.imported_files (processing_status);
create index idx_files_type on public.imported_files (file_type);
create index idx_files_uploaded_by on public.imported_files (uploaded_by);
create trigger trg_files_updated_at before update on public.imported_files for each row execute function public.set_updated_at();
alter table public.imported_files enable row level security;
create policy "files_select" on public.imported_files for select to authenticated using (true);
create policy "files_insert" on public.imported_files for insert to authenticated with check (uploaded_by = auth.uid() or public.is_admin());
create policy "files_update" on public.imported_files for update to authenticated using (public.is_admin() or uploaded_by = auth.uid()) with check (public.is_admin() or uploaded_by = auth.uid());
create policy "files_delete" on public.imported_files for delete to authenticated using (public.is_admin());

-- 4. chart_of_accounts
create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  source_code text,
  source_name text not null,
  nature text check (nature in ('ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido','receita','custo','despesa')),
  is_confirmed boolean not null default false,
  confidence_score numeric,
  times_confirmed integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_coa_source unique (source_code, source_name)
);
grant select, insert, update, delete on public.chart_of_accounts to authenticated;
grant all on public.chart_of_accounts to service_role;
create index idx_coa_nature on public.chart_of_accounts (nature);
create index idx_coa_source_name on public.chart_of_accounts (source_name);
create index idx_coa_confirmed on public.chart_of_accounts (is_confirmed);
create trigger trg_coa_updated_at before update on public.chart_of_accounts for each row execute function public.set_updated_at();
alter table public.chart_of_accounts enable row level security;
create policy "coa_select" on public.chart_of_accounts for select to authenticated using (true);
create policy "coa_insert" on public.chart_of_accounts for insert to authenticated with check (public.is_admin());
create policy "coa_update" on public.chart_of_accounts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "coa_delete" on public.chart_of_accounts for delete to authenticated using (public.is_admin());

-- 5. ledger_entries
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_id uuid not null references public.imported_files(id) on delete cascade,
  account_id uuid references public.chart_of_accounts(id) on delete set null,
  source_account_name text not null,
  raw_value numeric(15,2) not null,
  reviewed_value numeric(15,2),
  nature text check (nature in ('ativo_circulante','ativo_nao_circulante','passivo_circulante','passivo_nao_circulante','patrimonio_liquido','receita','custo','despesa')),
  is_manually_edited boolean not null default false,
  entry_date date,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ledger_entries to authenticated;
grant all on public.ledger_entries to service_role;
create index idx_entries_period on public.ledger_entries (period_id);
create index idx_entries_file on public.ledger_entries (file_id);
create index idx_entries_account on public.ledger_entries (account_id);
create index idx_entries_nature on public.ledger_entries (nature);
create index idx_entries_edited on public.ledger_entries (is_manually_edited);
create trigger trg_entries_updated_at before update on public.ledger_entries for each row execute function public.set_updated_at();
alter table public.ledger_entries enable row level security;
create policy "entries_select" on public.ledger_entries for select to authenticated using (true);
create policy "entries_insert" on public.ledger_entries for insert to authenticated with check (public.is_admin());
create policy "entries_update" on public.ledger_entries for update to authenticated using (true) with check (true);
create policy "entries_delete" on public.ledger_entries for delete to authenticated using (public.is_admin());

-- 6. reclassification_suggestions
create table public.reclassification_suggestions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  entry_id uuid references public.ledger_entries(id) on delete cascade,
  account_id uuid references public.chart_of_accounts(id) on delete cascade,
  current_nature text,
  suggested_nature text not null,
  reasoning text,
  confidence_score numeric,
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.reclassification_suggestions to authenticated;
grant all on public.reclassification_suggestions to service_role;
create index idx_suggestions_period on public.reclassification_suggestions (period_id);
create index idx_suggestions_status on public.reclassification_suggestions (status);
create index idx_suggestions_entry on public.reclassification_suggestions (entry_id);
create index idx_suggestions_account on public.reclassification_suggestions (account_id);
alter table public.reclassification_suggestions enable row level security;
create policy "suggestions_select" on public.reclassification_suggestions for select to authenticated using (true);
create policy "suggestions_insert" on public.reclassification_suggestions for insert to authenticated with check (public.is_admin());
create policy "suggestions_update" on public.reclassification_suggestions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "suggestions_delete" on public.reclassification_suggestions for delete to authenticated using (public.is_admin());

-- 7. audit_findings
create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  entry_id uuid references public.ledger_entries(id) on delete set null,
  finding_type text not null check (finding_type in ('conta_mal_classificada','lancamento_incorreto','valor_divergente','conta_sem_natureza','duplicidade')),
  description text not null,
  suggested_fix text,
  severity text not null default 'media' check (severity in ('baixa','media','alta')),
  status text not null default 'aberto' check (status in ('aberto','resolvido','ignorado')),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.audit_findings to authenticated;
grant all on public.audit_findings to service_role;
create index idx_findings_period on public.audit_findings (period_id);
create index idx_findings_status on public.audit_findings (status);
create index idx_findings_type on public.audit_findings (finding_type);
create index idx_findings_severity on public.audit_findings (severity);
alter table public.audit_findings enable row level security;
create policy "findings_select" on public.audit_findings for select to authenticated using (true);
create policy "findings_insert" on public.audit_findings for insert to authenticated with check (public.is_admin());
create policy "findings_update" on public.audit_findings for update to authenticated using (true) with check (true);
create policy "findings_delete" on public.audit_findings for delete to authenticated using (public.is_admin());

-- 8. financial_statements
create table public.financial_statements (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  statement_type text not null check (statement_type in ('dre','balanco_patrimonial','fluxo_de_caixa')),
  content jsonb not null,
  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default now(),
  constraint uniq_statement unique (period_id, statement_type)
);
grant select, insert, update, delete on public.financial_statements to authenticated;
grant all on public.financial_statements to service_role;
create index idx_statements_period on public.financial_statements (period_id);
create index idx_statements_type on public.financial_statements (statement_type);
alter table public.financial_statements enable row level security;
create policy "statements_select" on public.financial_statements for select to authenticated using (true);
create policy "statements_insert" on public.financial_statements for insert to authenticated with check (public.is_admin());
create policy "statements_update" on public.financial_statements for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "statements_delete" on public.financial_statements for delete to authenticated using (public.is_admin());

-- 9. dashboard_indicators
create table public.dashboard_indicators (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  indicator_key text not null check (indicator_key in ('margem_bruta','ebitda','resultado_liquido','posicao_caixa','receita_total','custo_total')),
  indicator_value numeric(15,4) not null,
  calculated_at timestamptz not null default now(),
  constraint uniq_indicator unique (period_id, indicator_key)
);
grant select, insert, update, delete on public.dashboard_indicators to authenticated;
grant all on public.dashboard_indicators to service_role;
create index idx_indicators_period on public.dashboard_indicators (period_id);
alter table public.dashboard_indicators enable row level security;
create policy "indicators_select" on public.dashboard_indicators for select to authenticated using (true);
create policy "indicators_insert" on public.dashboard_indicators for insert to authenticated with check (public.is_admin());
create policy "indicators_update" on public.dashboard_indicators for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "indicators_delete" on public.dashboard_indicators for delete to authenticated using (public.is_admin());

-- 10. recalculation_logs (imutavel)
create table public.recalculation_logs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_id uuid references public.imported_files(id) on delete set null,
  entry_id uuid references public.ledger_entries(id) on delete set null,
  field_changed text not null,
  old_value text,
  new_value text,
  manual_edit_preserved boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert on public.recalculation_logs to authenticated;
grant all on public.recalculation_logs to service_role;
create index idx_reclog_period on public.recalculation_logs (period_id);
create index idx_reclog_file on public.recalculation_logs (file_id);
create index idx_reclog_entry on public.recalculation_logs (entry_id);
alter table public.recalculation_logs enable row level security;
create policy "reclog_select" on public.recalculation_logs for select to authenticated using (true);
create policy "reclog_insert" on public.recalculation_logs for insert to authenticated with check (public.is_admin());

-- 11. activity_log (imutavel)
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.activity_log to authenticated;
grant all on public.activity_log to service_role;
create index idx_activity_actor on public.activity_log (actor_id);
create index idx_activity_created on public.activity_log (created_at);
create index idx_activity_entity on public.activity_log (entity_type, entity_id);
alter table public.activity_log enable row level security;
create policy "activity_select" on public.activity_log for select to authenticated using (public.is_admin());
create policy "activity_insert" on public.activity_log for insert to authenticated with check (actor_id = auth.uid() or public.is_admin());

-- 12. log_activity helper
create or replace function public.log_activity(_action text, _entity_type text, _entity_id uuid default null, _metadata jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), _action, _entity_type, _entity_id, _metadata)
  returning id into v_id;
  return v_id;
end; $$;

-- 13. get_period_summary
create or replace function public.get_period_summary(_period_id uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'pending_suggestions', (select count(*) from public.reclassification_suggestions where period_id = _period_id and status = 'pendente'),
    'open_findings', (select count(*) from public.audit_findings where period_id = _period_id and status = 'aberto'),
    'statements_generated', (select count(*) from public.financial_statements where period_id = _period_id),
    'entries_count', (select count(*) from public.ledger_entries where period_id = _period_id),
    'files_count', (select count(*) from public.imported_files where period_id = _period_id)
  );
$$;