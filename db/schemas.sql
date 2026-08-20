-- ============================================================
-- Rotta Financeiro (ERP Financeiro MVP) - db/schemas.sql
-- PostgreSQL / Supabase
-- ============================================================

-- ------------------------------------------------------------
-- 1. Function + trigger de updated_at (reutilizada em todas as tabelas)
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Helper is_admin() - lê o papel do usuário autenticado
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

-- ============================================================
-- 2. TABELAS (ordem de dependência)
-- ============================================================

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'usuario' check (role in ('admin','usuario')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_profiles_role on public.profiles (role);
create index idx_profiles_email on public.profiles (email);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles_insert" on public.profiles
  for insert to authenticated
  with check (public.is_admin());

create policy "profiles_update" on public.profiles
  for update to authenticated
  using (public.is_admin() or id = auth.uid())
  with check (public.is_admin() or id = auth.uid());

create policy "profiles_delete" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- accounting_periods
-- ------------------------------------------------------------
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

create index idx_periods_reference_month on public.accounting_periods (reference_month);
create index idx_periods_status on public.accounting_periods (status);
create index idx_periods_created_by on public.accounting_periods (created_by);

create trigger trg_periods_updated_at
  before update on public.accounting_periods
  for each row execute function public.set_updated_at();

alter table public.accounting_periods enable row level security;

create policy "periods_select" on public.accounting_periods
  for select to authenticated
  using (true);

create policy "periods_insert" on public.accounting_periods
  for insert to authenticated
  with check (public.is_admin());

create policy "periods_update" on public.accounting_periods
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "periods_delete" on public.accounting_periods
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- imported_files
-- ------------------------------------------------------------
create table public.imported_files (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_type text not null check (file_type in (
    'balancete','pedido_compra','nota_fiscal','romaneio_abate',
    'contas_pagar','contas_receber','relatorio_vendas','extrato_sicoob'
  )),
  original_name text not null,
  storage_path text not null,
  mime_type text not null,
  processing_status text not null default 'pendente' check (processing_status in ('pendente','processando','processado','erro')),
  processing_error text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_files_period on public.imported_files (period_id);
create index idx_files_status on public.imported_files (processing_status);
create index idx_files_type on public.imported_files (file_type);
create index idx_files_uploaded_by on public.imported_files (uploaded_by);

create trigger trg_files_updated_at
  before update on public.imported_files
  for each row execute function public.set_updated_at();

alter table public.imported_files enable row level security;

create policy "files_select" on public.imported_files
  for select to authenticated
  using (true);

create policy "files_insert" on public.imported_files
  for insert to authenticated
  with check (uploaded_by = auth.uid() or public.is_admin());

create policy "files_update" on public.imported_files
  for update to authenticated
  using (public.is_admin() or uploaded_by = auth.uid())
  with check (public.is_admin() or uploaded_by = auth.uid());

create policy "files_delete" on public.imported_files
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- chart_of_accounts
-- ------------------------------------------------------------
create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  source_code text,
  source_name text not null,
  nature text check (nature in (
    'ativo_circulante','ativo_nao_circulante','passivo_circulante',
    'passivo_nao_circulante','patrimonio_liquido','receita','custo','despesa'
  )),
  is_confirmed boolean not null default false,
  confidence_score numeric,
  times_confirmed integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_coa_source unique (source_code, source_name)
);

create index idx_coa_nature on public.chart_of_accounts (nature);
create index idx_coa_source_name on public.chart_of_accounts (source_name);
create index idx_coa_confirmed on public.chart_of_accounts (is_confirmed);

create trigger trg_coa_updated_at
  before update on public.chart_of_accounts
  for each row execute function public.set_updated_at();

alter table public.chart_of_accounts enable row level security;

create policy "coa_select" on public.chart_of_accounts
  for select to authenticated
  using (true);

create policy "coa_insert" on public.chart_of_accounts
  for insert to authenticated
  with check (public.is_admin());

create policy "coa_update" on public.chart_of_accounts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "coa_delete" on public.chart_of_accounts
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- ledger_entries
-- ------------------------------------------------------------
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_id uuid not null references public.imported_files(id) on delete cascade,
  account_id uuid references public.chart_of_accounts(id) on delete set null,
  source_account_name text not null,
  raw_value numeric(15,2) not null,
  reviewed_value numeric(15,2),
  nature text check (nature in (
    'ativo_circulante','ativo_nao_circulante','passivo_circulante',
    'passivo_nao_circulante','patrimonio_liquido','receita','custo','despesa'
  )),
  is_manually_edited boolean not null default false,
  entry_date date,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_entries_period on public.ledger_entries (period_id);
create index idx_entries_file on public.ledger_entries (file_id);
create index idx_entries_account on public.ledger_entries (account_id);
create index idx_entries_nature on public.ledger_entries (nature);
create index idx_entries_edited on public.ledger_entries (is_manually_edited);

create trigger trg_entries_updated_at
  before update on public.ledger_entries
  for each row execute function public.set_updated_at();

alter table public.ledger_entries enable row level security;

create policy "entries_select" on public.ledger_entries
  for select to authenticated
  using (true);

create policy "entries_insert" on public.ledger_entries
  for insert to authenticated
  with check (public.is_admin());

create policy "entries_update" on public.ledger_entries
  for update to authenticated
  using (true)
  with check (true);

create policy "entries_delete" on public.ledger_entries
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- reclassification_suggestions
-- ------------------------------------------------------------
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

create index idx_suggestions_period on public.reclassification_suggestions (period_id);
create index idx_suggestions_status on public.reclassification_suggestions (status);
create index idx_suggestions_entry on public.reclassification_suggestions (entry_id);
create index idx_suggestions_account on public.reclassification_suggestions (account_id);

alter table public.reclassification_suggestions enable row level security;

create policy "suggestions_select" on public.reclassification_suggestions
  for select to authenticated
  using (true);

create policy "suggestions_insert" on public.reclassification_suggestions
  for insert to authenticated
  with check (public.is_admin());

create policy "suggestions_update" on public.reclassification_suggestions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "suggestions_delete" on public.reclassification_suggestions
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- audit_findings
-- ------------------------------------------------------------
create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  entry_id uuid references public.ledger_entries(id) on delete set null,
  finding_type text not null check (finding_type in (
    'conta_mal_classificada','lancamento_incorreto','valor_divergente',
    'conta_sem_natureza','duplicidade'
  )),
  description text not null,
  suggested_fix text,
  severity text not null default 'media' check (severity in ('baixa','media','alta')),
  status text not null default 'aberto' check (status in ('aberto','resolvido','ignorado')),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_findings_period on public.audit_findings (period_id);
create index idx_findings_status on public.audit_findings (status);
create index idx_findings_type on public.audit_findings (finding_type);
create index idx_findings_severity on public.audit_findings (severity);

alter table public.audit_findings enable row level security;

create policy "findings_select" on public.audit_findings
  for select to authenticated
  using (true);

create policy "findings_insert" on public.audit_findings
  for insert to authenticated
  with check (public.is_admin());

create policy "findings_update" on public.audit_findings
  for update to authenticated
  using (true)
  with check (true);

create policy "findings_delete" on public.audit_findings
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- financial_statements
-- ------------------------------------------------------------
create table public.financial_statements (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  statement_type text not null check (statement_type in ('dre','balanco_patrimonial','fluxo_de_caixa')),
  content jsonb not null,
  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default now(),
  constraint uniq_statement unique (period_id, statement_type)
);

create index idx_statements_period on public.financial_statements (period_id);
create index idx_statements_type on public.financial_statements (statement_type);

alter table public.financial_statements enable row level security;

create policy "statements_select" on public.financial_statements
  for select to authenticated
  using (true);

create policy "statements_insert" on public.financial_statements
  for insert to authenticated
  with check (public.is_admin());

create policy "statements_update" on public.financial_statements
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "statements_delete" on public.financial_statements
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- dashboard_indicators
-- ------------------------------------------------------------
create table public.dashboard_indicators (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  indicator_key text not null check (indicator_key in (
    'margem_bruta','ebitda','resultado_liquido','posicao_caixa','receita_total','custo_total'
  )),
  indicator_value numeric(15,4) not null,
  calculated_at timestamptz not null default now(),
  constraint uniq_indicator unique (period_id, indicator_key)
);

create index idx_indicators_period on public.dashboard_indicators (period_id);

alter table public.dashboard_indicators enable row level security;

create policy "indicators_select" on public.dashboard_indicators
  for select to authenticated
  using (true);

create policy "indicators_insert" on public.dashboard_indicators
  for insert to authenticated
  with check (public.is_admin());

create policy "indicators_update" on public.dashboard_indicators
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "indicators_delete" on public.dashboard_indicators
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- recalculation_logs (imutável)
-- ------------------------------------------------------------
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

create index idx_reclog_period on public.recalculation_logs (period_id);
create index idx_reclog_file on public.recalculation_logs (file_id);
create index idx_reclog_entry on public.recalculation_logs (entry_id);

alter table public.recalculation_logs enable row level security;

create policy "reclog_select" on public.recalculation_logs
  for select to authenticated
  using (true);

create policy "reclog_insert" on public.recalculation_logs
  for insert to authenticated
  with check (public.is_admin());

-- Sem policies de UPDATE/DELETE: registro imutável.

-- ------------------------------------------------------------
-- activity_log (imutável)
-- ------------------------------------------------------------
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_actor on public.activity_log (actor_id);
create index idx_activity_created on public.activity_log (created_at);
create index idx_activity_entity on public.activity_log (entity_type, entity_id);

alter table public.activity_log enable row level security;

create policy "activity_select" on public.activity_log
  for select to authenticated
  using (public.is_admin());

create policy "activity_insert" on public.activity_log
  for insert to authenticated
  with check (actor_id = auth.uid() or public.is_admin());

-- Sem policies de UPDATE/DELETE: trilha imutável.

-- =====================================================================
-- Extensão: razão contábil, espelho do balancete, auditoria e agentes
-- =====================================================================

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  reduced_code text not null unique,
  hierarchical_code text,
  name text not null,
  level int,
  parent_code text,
  is_analytic boolean not null default true,
  nature text,
  link_status text not null default 'pendente',
  confidence numeric,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ledger_accounts_hier on public.ledger_accounts (hierarchical_code);
create index idx_ledger_accounts_nature on public.ledger_accounts (nature);

grant select, insert, update, delete on public.ledger_accounts to authenticated;
grant all on public.ledger_accounts to service_role;
alter table public.ledger_accounts enable row level security;
create policy "ledger_accounts_select" on public.ledger_accounts for select to authenticated using (true);
create policy "ledger_accounts_write" on public.ledger_accounts for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.journal_legs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_id uuid references public.imported_files(id) on delete set null,
  account_reduced_code text not null,
  account_id uuid references public.ledger_accounts(id) on delete set null,
  counterpart_reduced_code text,
  doc_number text,
  entry_date date,
  historico text,
  debit numeric not null default 0,
  credit numeric not null default 0,
  running_balance numeric,
  line_no int,
  created_at timestamptz not null default now()
);
create index idx_legs_period_account on public.journal_legs (period_id, account_reduced_code);
create index idx_legs_period_doc on public.journal_legs (period_id, doc_number);
create index idx_legs_file on public.journal_legs (file_id);

grant select, insert, update, delete on public.journal_legs to authenticated;
grant all on public.journal_legs to service_role;
alter table public.journal_legs enable row level security;
create policy "journal_legs_select" on public.journal_legs for select to authenticated using (true);
create policy "journal_legs_write" on public.journal_legs for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.journal_account_openings (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  account_reduced_code text not null,
  account_name text not null,
  opening_balance numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (period_id, account_reduced_code)
);

grant select, insert, update, delete on public.journal_account_openings to authenticated;
grant all on public.journal_account_openings to service_role;
alter table public.journal_account_openings enable row level security;
create policy "openings_select" on public.journal_account_openings for select to authenticated using (true);
create policy "openings_write" on public.journal_account_openings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Padronizacao dos codigos reduzidos (6 digitos) usados no razao.
-- O G2 exporta a contrapartida sem zeros a esquerda (23511) enquanto o plano
-- de contas usa 6 digitos (023511); sem isso o nome da conta de credito nao resolve.
create or replace function public.norm_reduced_code(_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when _code is null then null
    when btrim(_code) = '' then null
    when btrim(_code) ~ '^[0-9]{1,6}$' then lpad(btrim(_code), 6, '0')
    else btrim(_code)
  end
$$;

grant execute on function public.norm_reduced_code(text) to authenticated, anon, service_role;

create or replace function public.normalize_journal_codes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.account_reduced_code := public.norm_reduced_code(new.account_reduced_code);
  if to_jsonb(new) ? 'counterpart_reduced_code' then
    new.counterpart_reduced_code := public.norm_reduced_code(new.counterpart_reduced_code);
  end if;
  return new;
end
$$;

drop trigger if exists trg_normalize_journal_legs_codes on public.journal_legs;
create trigger trg_normalize_journal_legs_codes
before insert or update on public.journal_legs
for each row execute function public.normalize_journal_codes();

drop trigger if exists trg_normalize_openings_codes on public.journal_account_openings;
create trigger trg_normalize_openings_codes
before insert or update on public.journal_account_openings
for each row execute function public.normalize_journal_codes();



create table public.trial_balance_lines (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  file_id uuid references public.imported_files(id) on delete set null,
  code text not null,
  name text not null,
  level int not null default 1,
  is_analytic boolean not null default false,
  saldo_anterior numeric not null default 0,
  debito numeric not null default 0,
  credito numeric not null default 0,
  saldo_atual numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, code)
);

grant select, insert, update, delete on public.trial_balance_lines to authenticated;
grant all on public.trial_balance_lines to service_role;
alter table public.trial_balance_lines enable row level security;
create policy "tbl_select" on public.trial_balance_lines for select to authenticated using (true);
create policy "tbl_write" on public.trial_balance_lines for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Trilha imutável de vínculos e classificações
create table public.ledger_account_audit (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.accounting_periods(id) on delete set null,
  entity_type text not null default 'ledger_accounts',
  account_key text not null,
  account_name text,
  field_changed text not null,
  old_value text,
  new_value text,
  source text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_audit_account on public.ledger_account_audit (account_key);
create index idx_audit_period on public.ledger_account_audit (period_id, created_at);

grant select on public.ledger_account_audit to authenticated;
grant all on public.ledger_account_audit to service_role;
alter table public.ledger_account_audit enable row level security;
create policy "ledger_audit_select" on public.ledger_account_audit for select to authenticated using (true);
-- Sem policies de INSERT/UPDATE/DELETE: gravado apenas pelas funções security definer.

-- Agentes de IA
create table public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  agent text not null,
  period_id uuid references public.accounting_periods(id) on delete set null,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.agent_threads to authenticated;
grant all on public.agent_threads to service_role;
alter table public.agent_threads enable row level security;
create policy "threads_select" on public.agent_threads for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "threads_insert" on public.agent_threads for insert to authenticated with check (user_id = auth.uid());
create policy "threads_update" on public.agent_threads for update to authenticated using (user_id = auth.uid());
create policy "threads_delete" on public.agent_threads for delete to authenticated using (user_id = auth.uid() or public.is_admin());

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  parts jsonb not null default '[]'::jsonb,
  client_message_id text,
  created_at timestamptz not null default now()
);
create index idx_agent_messages_thread on public.agent_messages (thread_id, created_at);

grant select, insert, delete on public.agent_messages to authenticated;
grant all on public.agent_messages to service_role;
alter table public.agent_messages enable row level security;
create policy "messages_select" on public.agent_messages for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "messages_insert" on public.agent_messages for insert to authenticated with check (user_id = auth.uid());
create policy "messages_delete" on public.agent_messages for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- =====================================================================
-- FASE 4 — Índices financeiros derivados do razão contábil
-- Camada única: period_account_balances -> indicator_components ->
-- recalculate_period_indicators_internal -> dashboard_indicators.
-- indicator_drilldown responde "de onde veio esse número".
-- Definições vigentes: ver migrações Supabase (funções abaixo são
-- recriadas por lá; este arquivo documenta o contrato).
-- =====================================================================
-- indicator_components(_period_id) -> (component_key, basis, reduced_code,
--   account_name, hierarchical_code, nature, value)
--   component_key: receita | custo | despesa | caixa | estoques | clientes |
--   fornecedores | ativo_circulante | ativo_nao_circulante |
--   passivo_circulante | passivo_nao_circulante | patrimonio_liquido
--   basis: 'movimento' (sem lançamentos de encerramento) | 'saldo'
-- indicator_formulas() -> jsonb com label/fórmula/kind/components por índice
-- indicator_drilldown(_period_id, _indicator_key) -> jsonb com fórmula,
--   blocos, totais e contas que compõem o número
-- dashboard_indicators.indicator_key aceita:
--   receita_total, custo_total, despesa_total, margem_bruta, ebitda,
--   resultado_liquido, posicao_caixa, ativo_total, capital_giro,
--   margem_liquida, margem_ebitda, liquidez_corrente, liquidez_seca,
--   liquidez_imediata, endividamento_geral, endividamento_pl,
--   giro_ativo, giro_estoque, pmr, pmp

-- ---------------------------------------------------------------------------
-- Fase 5 — Agente Contábil sobre o razão (propostas com aprovação obrigatória)
-- ---------------------------------------------------------------------------
-- journal_leg_detail(_leg_id)  : leitura de um lançamento (conta, contrapartida,
--                                valor, doc, histórico, período) usada pelo agente
--                                para montar a proposta com evidência.
-- apply_journal_adjustment(_leg_id, _new_account, _new_value, _justificativa, _thread_id)
--   • somente Admin (is_admin());
--   • recusa período com status 'fechado' e mês/exercício com fechamento ativo;
--   • NUNCA edita o lançamento original: gera lançamento(s) de ajuste com
--     origin='ajuste' e entry_group próprio — diferença de valor contra a
--     contrapartida original e transferência do valor final para a nova conta;
--   • grava ledger_account_audit (field_changed='lancamento_ajustado',
--     source='agente_contador', old_value → new_value, actor_id, created_at),
--     tabela sem UPDATE/DELETE;
--   • dispara recalculate_period_indicators_internal.
