
# Estrutura Técnica — Rotta Financeiro (ERP Financeiro MVP)

> **Caminho de build escolhido: Lovable + Supabase.** O perfil do usuário no dossiê é explícito: "Gestor de operações de frigorífico, com domínio de processos financeiros mas sem perfil técnico" e a equipe é composta por "usuários internos" sem TI dedicada. Para quem precisa de uma interface simples de importar/revisar/corrigir/gerar relatórios rapidamente e não tem quem mantenha código, o Lovable (React + Tailwind + shadcn/ui, com integração nativa ao Supabase e tabelas editáveis geradas de forma no-code) é o caminho mais rápido do zero ao app no ar. Toda a lógica pesada — leitura de PDF/Excel, reclassificação por IA, recálculo de demonstrativos — fica em **Supabase Edge Functions**, invisível para o usuário final. O backend é 100% Supabase (PostgreSQL + RLS + Auth + Storage + Edge Functions + Realtime + pg_cron).

---

## 1. Modelo de dados

### `profiles`
Espelha `auth.users` e guarda o papel (Admin/Usuário) de cada membro interno do Rotta.
- `id` uuid **PK** (FK → `auth.users.id`)
- `full_name` text NOT NULL
- `email` text NOT NULL
- `role` text NOT NULL default `'usuario'` — valores: `'admin'`, `'usuario'`
- `is_active` boolean NOT NULL default `true`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`
- Índices: `idx_profiles_role (role)`, `idx_profiles_email (email)`

### `accounting_periods`
Cada período de fechamento (ex.: janeiro/2026) sobre o qual arquivos são importados e demonstrativos gerados.
- `id` uuid **PK** default `gen_random_uuid()`
- `label` text NOT NULL — ex.: "Janeiro/2026"
- `reference_month` date NOT NULL — primeiro dia do mês de referência
- `status` text NOT NULL default `'aberto'` — `'aberto'`, `'em_revisao'`, `'fechado'`
- `last_recalculated_at` timestamptz
- `created_by` uuid **FK** → `profiles.id` NOT NULL
- `created_at` timestamptz NOT NULL default `now()`
- Índices: `idx_periods_reference_month (reference_month)`, `idx_periods_status (status)`, `idx_periods_created_by (created_by)`

### `imported_files`
Registro de cada arquivo exportado do G2/Sicoob que sobe para o Storage (balancete, NF, romaneio, extrato etc.).
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `file_type` text NOT NULL — `'balancete'`, `'pedido_compra'`, `'nota_fiscal'`, `'romaneio_abate'`, `'contas_pagar'`, `'contas_receber'`, `'relatorio_vendas'`, `'extrato_sicoob'`
- `original_name` text NOT NULL
- `storage_path` text NOT NULL — caminho no bucket `imports`
- `mime_type` text NOT NULL — `application/pdf` ou planilha
- `processing_status` text NOT NULL default `'pendente'` — `'pendente'`, `'processando'`, `'processado'`, `'erro'`
- `processing_error` text
- `uploaded_by` uuid **FK** → `profiles.id` NOT NULL
- `created_at` timestamptz NOT NULL default `now()`
- Índices: `idx_files_period (period_id)`, `idx_files_status (processing_status)`, `idx_files_type (file_type)`, `idx_files_uploaded_by (uploaded_by)`

### `chart_of_accounts`
Plano de contas do Rotta (sem padrão) mapeado para as naturezas contábeis oficiais — a fonte do aprendizado da empresa.
- `id` uuid **PK** default `gen_random_uuid()`
- `source_code` text — código/número da conta como vem do G2 (pode ser nulo)
- `source_name` text NOT NULL — descrição original da conta no G2
- `nature` text — uma das 8 naturezas: `'ativo_circulante'`, `'ativo_nao_circulante'`, `'passivo_circulante'`, `'passivo_nao_circulante'`, `'patrimonio_liquido'`, `'receita'`, `'custo'`, `'despesa'`
- `is_confirmed` boolean NOT NULL default `false` — true quando o mapeamento já foi aprovado por Admin
- `confidence_score` numeric — confiança da última sugestão da IA (0–1)
- `times_confirmed` integer NOT NULL default `0` — reforça o aprendizado do padrão da empresa
- `updated_by` uuid **FK** → `profiles.id`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`
- Índices: `idx_coa_nature (nature)`, `idx_coa_source_name (source_name)`, `idx_coa_confirmed (is_confirmed)`, `uniq_coa_source (source_code, source_name)` UNIQUE

### `ledger_entries`
Lançamentos do balancete importado (dado bruto + valor revisado); é a tabela editável central da plataforma.
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `file_id` uuid **FK** → `imported_files.id` NOT NULL
- `account_id` uuid **FK** → `chart_of_accounts.id`
- `source_account_name` text NOT NULL — como veio do arquivo
- `raw_value` numeric(15,2) NOT NULL — valor bruto importado do G2
- `reviewed_value` numeric(15,2) — valor editado manualmente (prevalece sobre `raw_value`)
- `nature` text — natureza aplicada (herda de `chart_of_accounts` ou ajuste manual)
- `is_manually_edited` boolean NOT NULL default `false`
- `entry_date` date
- `updated_by` uuid **FK** → `profiles.id`
- `created_at` timestamptz NOT NULL default `now()`
- `updated_at` timestamptz NOT NULL default `now()`
- Índices: `idx_entries_period (period_id)`, `idx_entries_file (file_id)`, `idx_entries_account (account_id)`, `idx_entries_nature (nature)`, `idx_entries_edited (is_manually_edited)`

### `reclassification_suggestions`
Sugestões de reclassificação geradas pela IA que aguardam aprovação/rejeição do Admin (nada é aplicado silenciosamente).
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `entry_id` uuid **FK** → `ledger_entries.id`
- `account_id` uuid **FK** → `chart_of_accounts.id`
- `current_nature` text
- `suggested_nature` text NOT NULL
- `reasoning` text — justificativa gerada pela IA
- `confidence_score` numeric
- `status` text NOT NULL default `'pendente'` — `'pendente'`, `'aprovada'`, `'rejeitada'`
- `decided_by` uuid **FK** → `profiles.id`
- `decided_at` timestamptz
- `created_at` timestamptz NOT NULL default `now()`
- Índices: `idx_suggestions_period (period_id)`, `idx_suggestions_status (status)`, `idx_suggestions_entry (entry_id)`, `idx_suggestions_account (account_id)`

### `audit_findings`
Itens do Painel de Apontamentos — inconsistências/erros detectados para corrigir na origem (G2).
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `entry_id` uuid **FK** → `ledger_entries.id`
- `finding_type` text NOT NULL — `'conta_mal_classificada'`, `'lancamento_incorreto'`, `'valor_divergente'`, `'conta_sem_natureza'`, `'duplicidade'`
- `description` text NOT NULL
- `suggested_fix` text — sugestão de correção no G2
- `severity` text NOT NULL default `'media'` — `'baixa'`, `'media'`, `'alta'`
- `status` text NOT NULL default `'aberto'` — `'aberto'`, `'resolvido'`, `'ignorado'`
- `resolved_by` uuid **FK** → `profiles.id`
- `created_at` timestamptz NOT NULL default `now()`
- Índices: `idx_findings_period (period_id)`, `idx_findings_status (status)`, `idx_findings_type (finding_type)`, `idx_findings_severity (severity)`

### `financial_statements`
Demonstrativos gerados (DRE, Balanço, Fluxo de Caixa) por período — armazena o JSON estruturado renderizado na tela e exportado.
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `statement_type` text NOT NULL — `'dre'`, `'balanco_patrimonial'`, `'fluxo_de_caixa'`
- `content` jsonb NOT NULL — estrutura hierárquica de linhas/grupos/valores
- `generated_by` uuid **FK** → `profiles.id` NOT NULL
- `generated_at` timestamptz NOT NULL default `now()`
- Índices: `idx_statements_period (period_id)`, `idx_statements_type (statement_type)`, `uniq_statement (period_id, statement_type)` UNIQUE

### `dashboard_indicators`
Indicadores financeiros calculados por período para o Dashboard e o BI (margem bruta, EBITDA, resultado líquido, posição de caixa).
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `indicator_key` text NOT NULL — `'margem_bruta'`, `'ebitda'`, `'resultado_liquido'`, `'posicao_caixa'`, `'receita_total'`, `'custo_total'`
- `indicator_value` numeric(15,4) NOT NULL
- `calculated_at` timestamptz NOT NULL default `now()`
- Índices: `idx_indicators_period (period_id)`, `uniq_indicator (period_id, indicator_key)` UNIQUE

### `recalculation_logs`
Registro das mudanças de valor após reimportação sobre período já processado (lista "o que foi atualizado").
- `id` uuid **PK** default `gen_random_uuid()`
- `period_id` uuid **FK** → `accounting_periods.id` NOT NULL
- `file_id` uuid **FK** → `imported_files.id`
- `entry_id` uuid **FK** → `ledger_entries.id`
- `field_changed` text NOT NULL — ex.: `'raw_value'`, `'nature'`
- `old_value` text
- `new_value` text
- `manual_edit_preserved` boolean NOT NULL default `false` — destaca edições manuais mantidas
- `created_at` timestamptz NOT NULL default `now()`
- Índices: `idx_reclog_period (period_id)`, `idx_reclog_file (file_id)`, `idx_reclog_entry (entry_id)`

### `activity_log`
Trilha de auditoria de ações relevantes (aprovações, edições, gerações), para rastreabilidade interna.
- `id` uuid **PK** default `gen_random_uuid()`
- `actor_id` uuid **FK** → `profiles.id` NOT NULL
- `action` text NOT NULL — ex.: `'aprovou_reclassificacao'`, `'editou_lancamento'`, `'gerou_dre'`
- `entity_type` text NOT NULL
- `entity_id` uuid
- `metadata` jsonb
- `created_at` timestamptz NOT NULL default `now()`
- Índices: `idx_activity_actor (actor_id)`, `idx_activity_created (created_at)`, `idx_activity_entity (entity_type, entity_id)`

---

## 2. RLS e autenticação

**Autenticação:** Supabase Auth por **email + senha** (login interno da equipe do Rotta). Sem OAuth público e sem cadastro aberto — apenas o Admin cria contas (funções abaixo). Recomendado ativar confirmação de email. Todo o modelo é single-tenant (uma empresa: Rotta), portanto o isolamento é por **papel**, não por organização. A coluna `profiles.role` é a base das políticas. Um helper `is_admin()` (Postgres function `SECURITY DEFINER` que lê `profiles.role` do `auth.uid()`) é usado nas policies.

RLS **habilitado em todas as tabelas**. Resumo por tabela:

- **`profiles`**: SELECT — qualquer usuário autenticado lê o próprio perfil; Admin lê todos. INSERT/UPDATE/DELETE — apenas Admin (gestão de usuários). Cada usuário pode UPDATE do próprio `full_name`.
- **`accounting_periods`**: SELECT — todos autenticados. INSERT/UPDATE/DELETE — apenas Admin (define períodos e status de fechamento).
- **`imported_files`**: SELECT — todos autenticados. INSERT — Admin e Usuário (ambos importam). UPDATE — Admin, ou o próprio `uploaded_by`. DELETE — apenas Admin.
- **`chart_of_accounts`**: SELECT — todos autenticados. INSERT/UPDATE/DELETE — apenas Admin (regra: só o Admin define o mapeamento do plano de contas).
- **`ledger_entries`**: SELECT — todos autenticados. INSERT — Edge Functions (via service role) e Admin. UPDATE — Admin e Usuário (edição manual da tabela, dentro das permissões). DELETE — apenas Admin.
- **`reclassification_suggestions`**: SELECT — todos autenticados. INSERT — via Edge Function (service role). UPDATE (aprovar/rejeitar) — apenas Admin. DELETE — Admin.
- **`audit_findings`**: SELECT — todos autenticados. INSERT — Edge Function (service role). UPDATE (marcar resolvido/ignorado) — Admin e Usuário. DELETE — Admin.
- **`financial_statements`**: SELECT — todos autenticados. INSERT/UPDATE — Edge Function (service role) via geração; DELETE — Admin.
- **`dashboard_indicators`**: SELECT — todos autenticados. INSERT/UPDATE — Edge Function (service role). DELETE — Admin.
- **`recalculation_logs`**: SELECT — todos autenticados. INSERT — Edge Function (service role). Sem UPDATE/DELETE (registro imutável).
- **`activity_log`**: SELECT — apenas Admin. INSERT — Edge Function (service role) e usuários autenticados via RPC. Sem UPDATE/DELETE (trilha imutável).

**Storage:** bucket privado `imports` — política de leitura/escrita restrita a usuários autenticados; upload via signed URL. Bucket `exports` (PDFs/Excel gerados) privado com download por signed URL.

---

## 3. Functions/endpoints

### Edge Functions (Deno)

- **`parse-imported-file`** — recebe `file_id`, baixa o arquivo do Storage, detecta se é balancete/NF/extrato etc. e extrai o conteúdo estruturado (PDF via IA multimodal, Excel via parser). Grava `ledger_entries` brutos e atualiza `imported_files.processing_status`. Chamada: após upload de arquivo (trigger a partir do frontend / webhook de Storage).
- **`suggest-reclassification`** — para cada conta sem natureza confirmada, consulta `chart_of_accounts` (padrão aprendido da empresa) e chama a IA para sugerir a natureza; grava em `reclassification_suggestions`. Chamada: ao final do `parse-imported-file` e sob demanda pelo Admin.
- **`apply-reclassification-decision`** — recebe decisão (aprovada/rejeitada) do Admin, atualiza `ledger_entries.nature`, marca `chart_of_accounts.is_confirmed` e incrementa `times_confirmed` (aprendizado). Chamada: ação "Aprovar/Rejeitar" no painel de sugestões.
- **`detect-inconsistencies`** — analisa lançamentos e cruzamentos (contas sem natureza, valores divergentes, duplicidades) e popula `audit_findings`. Chamada: após parsing e antes da geração de demonstrativos.
- **`generate-statements`** — recalcula e monta DRE, Balanço Patrimonial e Fluxo de Caixa a partir dos valores revisados/aprovados; grava `financial_statements` e `dashboard_indicators`. Chamada: ação "Gerar demonstrativos" e após recálculo automático.
- **`recalculate-period`** — ao reimportar arquivo sobre período processado, faz merge preservando edições manuais, registra diffs em `recalculation_logs` (com `manual_edit_preserved`) e reexecuta `generate-statements`. Chamada: automaticamente após novo `parse-imported-file` em período já processado.
- **`export-report`** — gera PDF (com logo Rotta) e Excel dos demonstrativos e salva no bucket `exports`, retornando signed URL. Chamada: ação "Exportar PDF/Excel".
- **`manage-user`** — cria/atualiza/desativa usuários internos e define `role`. Chamada: telas de gestão de usuários (Admin). Usa service role para operar em `auth.users`.

### Postgres RPCs / functions

- **`is_admin()`** — retorna boolean se `auth.uid()` tem `role = 'admin'`; usada nas policies RLS.
- **`get_period_summary(period_id)`** — retorna contagens de sugestões pendentes, apontamentos abertos e status dos demonstrativos para o painel do período.
- **`log_activity(action, entity_type, entity_id, metadata)`** — insere em `activity_log`.

### Cron Jobs (pg_cron)

- **`nightly-daily-refresh`** — verifica períodos com arquivos novos não consolidados e dispara `recalculate-period` (suporta o cenário de análise diária citado pelo usuário).

---

## 4. Páginas do frontend

- **`/login`** — Autenticação. Login por email/senha da equipe interna.
- **`/dashboard`** — Dashboard de resultado e BI. Exibe indicadores (margem bruta, EBITDA, resultado líquido, posição de caixa) e gráficos por período selecionado.
- **`/periodos`** — Lista e gestão de períodos contábeis. Criar/selecionar período de fechamento e ver status (aberto/em revisão/fechado).
- **`/importar`** — Importação de arquivos. Upload de PDF/Excel (balancete, NF, romaneio, extrato Sicoob etc.) e acompanhamento do status de processamento.
- **`/balancete`** — Tabela editável de lançamentos. Revisar, editar valores, reclassificar contas e ajustar lançamentos do período; edições manuais destacadas.
- **`/reclassificacoes`** — Painel de sugestões da IA. Admin aprova/rejeita reclassificações sugeridas, alimentando o padrão da empresa.
- **`/plano-de-contas`** — Mapeamento do plano de contas. Admin associa cada conta do G2 a uma das 8 naturezas contábeis.
- **`/apontamentos`** — Painel de Apontamentos. Lista inconsistências/erros e sugestões de correção no G2, com marcação de resolvido/ignorado.
- **`/demonstrativos`** — Visualização de DRE, Balanço Patrimonial e Fluxo de Caixa estruturados, com botões de exportar PDF/Excel.
- **`/atualizacoes`** — Lista de valores atualizados. Mostra os diffs de `recalculation_logs` após reimportações, sinalizando edições manuais preservadas.
- **`/usuarios`** — Gestão de usuários (somente Admin). Cadastra/edita/desativa usuários internos e define papel Admin/Usuário.

---

## 5. Integrações externas

Todas via **Supabase Edge Functions** (chaves nunca expostas no frontend Lovable):

- **Anthropic — Claude (leitura de PDF e reclassificação):** usado em `parse-imported-file` (interpretação multimodal do balancete PDF e classificação) e `suggest-reclassification`. Recomendado **Claude Sonnet 4.6** como padrão operacional (bom equilíbrio qualidade/custo para interpretar documentos contábeis com precisão), com **Claude Haiku 4.5** para tarefas simples/alto volume de linhas.
- **Google — Gemini 2.5 Pro (fallback para arquivos grandes):** opção quando o balancete/relatório vier muito extenso (contexto de 1M tokens e multimodal nativo com custo baixo), acionado dentro de `parse-imported-file` para documentos longos.
- **Resend (email transacional):** convites de novos usuários criados pelo Admin em `manage-user` e notificações de "recálculo concluído / valores atualizados". Free tier (100/dia) atende ao volume interno do Rotta.
- **Nenhuma integração com G2 ou Sicoob:** confirmado no processo — não há API; toda entrada é por importação manual de arquivos. Portanto não há conector automático desses sistemas.

**Observação de custo:** para o volume de uma equipe interna do Rotta com fechamento mensal + eventuais atualizações diárias, o **Supabase Pro (R$125/mês)** é recomendado pelo Storage e volume de Edge invocations do parsing; **Lovable Pro (R$95/mês)** para o app publicado. IA fica em pague-por-uso (Sonnet 4.6/Haiku 4.5) — baixo, dado o volume documental mensal. Resend no Free tier.
