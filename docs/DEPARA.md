# DE-PARA — Rotta Financeiro (Matriz de Rastreabilidade)

> Este documento amarra **banco (PostgreSQL/Supabase)** → **Functions/Endpoints (Edge Functions + RPCs + Cron)** → **Páginas (Lovable/React)**. Nomes usados EXATAMENTE como na ESTRUTURA: tabelas/RPC em `snake_case`, Edge Functions e rotas em `kebab-case`. Se algum nome divergir aqui, o pacote perde consistência — use este arquivo como checklist para garantir que nenhuma tabela, function ou página ficou órfã.

---

## 1. Tabela (DB) → Functions/Endpoints → Páginas

| Tabela | Functions/Endpoints que a tocam | Páginas que a usam | Observação |
|---|---|---|---|
| `profiles` | `manage-user`, `is_admin()`, `log_activity()` (indireto), e é FK-alvo de quase todas as functions que gravam `*_by` | `/login`, `/usuarios`, `/dashboard` (nome/papel do usuário logado) | Espelha `auth.users`. Base das policies RLS via `is_admin()`. INSERT/UPDATE/DELETE só por Admin (via `manage-user`); usuário edita o próprio `full_name`. |
| `accounting_periods` | `generate-statements`, `recalculate-period`, `detect-inconsistencies`, `suggest-reclassification`, `parse-imported-file`, `get_period_summary()`, `nightly-daily-refresh` | `/periodos`, `/dashboard`, `/importar`, `/balancete`, `/demonstrativos`, `/atualizacoes` | Pivô central de todo o fechamento. INSERT/UPDATE/DELETE só Admin; `status` controla aberto/em_revisão/fechado; `last_recalculated_at` atualizado pelo recálculo. |
| `imported_files` | `parse-imported-file`, `recalculate-period`, `nightly-daily-refresh` | `/importar`, `/atualizacoes` | Registro de cada arquivo do G2/Sicoob no bucket `imports`. INSERT por Admin e Usuário; `processing_status` movido pelas Edge Functions (service role). |
| `chart_of_accounts` | `suggest-reclassification`, `apply-reclassification-decision`, `parse-imported-file` (lookup) | `/plano-de-contas`, `/reclassificacoes`, `/balancete` | Plano de contas do Rotta (sem padrão) → naturezas. `is_confirmed`/`times_confirmed` são o aprendizado da empresa. INSERT/UPDATE/DELETE só Admin. |
| `ledger_entries` | `parse-imported-file`, `suggest-reclassification`, `apply-reclassification-decision`, `detect-inconsistencies`, `generate-statements`, `recalculate-period`, `log_activity()` | `/balancete`, `/demonstrativos` (fonte), `/reclassificacoes`, `/apontamentos` | Tabela editável central. `reviewed_value` prevalece sobre `raw_value`; `is_manually_edited` protege edições no recálculo. UPDATE por Admin e Usuário. |
| `reclassification_suggestions` | `suggest-reclassification` (INSERT), `apply-reclassification-decision` (UPDATE de status) | `/reclassificacoes` | IA nunca aplica direto: grava sugestão `pendente`. Aprovar/rejeitar só Admin. |
| `audit_findings` | `detect-inconsistencies` (INSERT), (UPDATE de status via frontend RLS) | `/apontamentos`, `/dashboard` (contagem) | Painel de Apontamentos: orienta correção na origem (G2), não corrige automático. UPDATE por Admin e Usuário. |
| `financial_statements` | `generate-statements` (INSERT/UPDATE), `recalculate-period` (reexecuta), `export-report` (leitura) | `/demonstrativos`, `/dashboard` | JSON hierárquico da DRE/Balanço/Fluxo de Caixa. UNIQUE `(period_id, statement_type)`. INSERT/UPDATE só via Edge Function. |
| `dashboard_indicators` | `generate-statements` (INSERT/UPDATE), `recalculate-period` (reexecuta), `get_period_summary()` (indireto) | `/dashboard`, `/demonstrativos` | Indicadores (margem bruta, EBITDA, resultado líquido, posição de caixa) para dashboard/BI. UNIQUE `(period_id, indicator_key)`. |
| `recalculation_logs` | `recalculate-period` (INSERT) | `/atualizacoes` | Registro imutável dos diffs após reimportação. `manual_edit_preserved` sinaliza edições mantidas. Sem UPDATE/DELETE. |
| `activity_log` | `log_activity()` (INSERT), gravado por `apply-reclassification-decision`, `generate-statements`, `export-report`, `manage-user` e edições de `/balancete` | (nenhuma página dedicada; consulta futura por Admin) | Trilha de auditoria imutável. SELECT só Admin. Sem UPDATE/DELETE. Sem tela no MVP — alimentado por várias ações. |

---

## 2. Function/Endpoint → Tabelas → Páginas (caminho inverso)

| Function/Endpoint | Tabelas que toca | Página(s) que chama | Observação |
|---|---|---|---|
| `parse-imported-file` (Edge) | `imported_files` (R/U status), `ledger_entries` (INSERT brutos), `chart_of_accounts` (lookup), `accounting_periods` (R) | `/importar` (após upload) | Baixa arquivo do Storage, detecta tipo, extrai conteúdo (PDF via IA multimodal Claude/Gemini, Excel via parser). Encadeia `suggest-reclassification` e `detect-inconsistencies`. |
| `suggest-reclassification` (Edge) | `chart_of_accounts` (R padrão aprendido), `ledger_entries` (R), `reclassification_suggestions` (INSERT), `accounting_periods` (R) | `/importar` (fim do parse), `/reclassificacoes` (sob demanda Admin) | Gera sugestões `pendente` via IA — nunca aplica direto. Usa histórico da empresa para aumentar precisão. |
| `apply-reclassification-decision` (Edge) | `reclassification_suggestions` (U status), `ledger_entries` (U nature), `chart_of_accounts` (U `is_confirmed`/`times_confirmed`), `activity_log` (INSERT) | `/reclassificacoes` | Ação Aprovar/Rejeitar (só Admin). Aprovação alimenta o aprendizado do plano de contas. |
| `detect-inconsistencies` (Edge) | `ledger_entries` (R), `audit_findings` (INSERT), `accounting_periods` (R) | `/importar` (pós-parse), `/apontamentos` | Detecta contas sem natureza, valores divergentes, duplicidades. Roda antes da geração de demonstrativos. |
| `generate-statements` (Edge) | `ledger_entries` (R revisados/aprovados), `financial_statements` (INSERT/UPDATE), `dashboard_indicators` (INSERT/UPDATE), `accounting_periods` (R), `activity_log` (INSERT) | `/demonstrativos` ("Gerar demonstrativos"), `/dashboard` | Monta DRE, Balanço e Fluxo de Caixa + indicadores. Reexecutado pelo recálculo automático. |
| `recalculate-period` (Edge) | `ledger_entries` (merge preservando `is_manually_edited`), `recalculation_logs` (INSERT diffs), `imported_files` (R), `accounting_periods` (U `last_recalculated_at`), + chama `generate-statements` | `/importar` (reimportação automática), `/atualizacoes` | Merge que preserva edições manuais; lista o que mudou. Suporta análise diária. |
| `export-report` (Edge) | `financial_statements` (R), `dashboard_indicators` (R), `accounting_periods` (R), `activity_log` (INSERT) | `/demonstrativos` ("Exportar PDF/Excel") | Gera PDF (logo Rotta) e Excel no bucket `exports`, retorna signed URL. |
| `manage-user` (Edge) | `profiles` (INSERT/UPDATE/desativar), `auth.users` (service role), `activity_log` (INSERT) | `/usuarios` | Cria/edita/desativa usuários internos e define `role`. Envia convite via Resend. Só Admin. |
| `is_admin()` (RPC Postgres) | `profiles` (R `role` do `auth.uid()`) | (todas — usado nas policies RLS) | `SECURITY DEFINER`. Base do isolamento por papel (single-tenant Rotta). Não é chamado direto por página. |
| `get_period_summary(period_id)` (RPC Postgres) | `reclassification_suggestions` (count pendentes), `audit_findings` (count abertos), `financial_statements` (status), `accounting_periods` (R) | `/periodos`, `/dashboard` | Resumo do período: sugestões pendentes, apontamentos abertos, status dos demonstrativos. |
| `log_activity(action, entity_type, entity_id, metadata)` (RPC Postgres) | `activity_log` (INSERT) | (chamada por várias páginas/functions) | Helper de trilha de auditoria. Invocado por edições em `/balancete`, `/reclassificacoes`, `/demonstrativos`, `/usuarios`. |
| `nightly-daily-refresh` (Cron pg_cron) | `accounting_periods` (R), `imported_files` (R), + dispara `recalculate-period` | (nenhuma — automação de fundo) | Verifica períodos com arquivos novos não consolidados e dispara recálculo. Suporta o cenário de análise diária. |

---

### Notas de consistência

- **Nenhuma tabela órfã:** todas as 11 tabelas da ESTRUTURA aparecem na Tabela 1 com ao menos uma function e uma página (exceto `activity_log`, sem tela dedicada no MVP — alimentado por várias ações, consulta reservada ao Admin).
- **Nenhuma página órfã:** `/login` (auth Supabase), `/dashboard`, `/periodos`, `/importar`, `/balancete`, `/reclassificacoes`, `/plano-de-contas`, `/apontamentos`, `/demonstrativos`, `/atualizacoes` e `/usuarios` estão todas cobertas.
- **Nenhuma function órfã:** as 8 Edge Functions, as 3 RPCs e o 1 Cron Job aparecem na Tabela 2.
- **Fluxo crítico do MVP:** `/importar` → `parse-imported-file` → `suggest-reclassification` + `detect-inconsistencies` → `/reclassificacoes`/`/apontamentos` → `generate-statements` → `/demonstrativos` + `/dashboard`, com `recalculate-period` → `/atualizacoes` no ciclo de reimportação.
---

## Extensão — Razão contábil, auditoria e agentes

| Tabela | Functions/Endpoints que a tocam | Páginas que a usam |
|---|---|---|
| `ledger_accounts` | `import_journal_legs`, `link_reduced_accounts`, `set_account_link`, `journal_*`, `reconcile_journal_vs_trial_balance` | `/razao` (Extrato, Vínculos, Pendências), `/agentes` |
| `journal_legs` | `import_journal_legs`, `journal_account_statement`, `journal_document`, `journal_top_counterparts`, `reconcile_journal_vs_trial_balance`, `recalculate_period_indicators_internal`, `generate_period_statements` | `/razao`, `/dashboard`, `/demonstrativos`, `/agentes` |
| `journal_account_openings` | `import_journal_legs`, `journal_account_statement`, `link_reduced_accounts` | `/razao` (Extrato) |
| `trial_balance_lines` | `import_trial_balance_lines`, `link_reduced_accounts`, `reconcile_journal_vs_trial_balance`, `journal_pending_report` | `/razao` (Conferência, Pendências), `/balancete` |
| `ledger_account_audit` | `link_reduced_accounts`, `set_account_link`, `apply_reclassification_decision` | `/razao` (Histórico) |
| `agent_threads` / `agent_messages` | rota de streaming `api/agents/chat`, `agents.functions.ts` | `/agentes`, `/agentes/{id}` |
