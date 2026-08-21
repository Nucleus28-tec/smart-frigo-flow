# Functions & Endpoints — Rotta Financeiro (ERP Financeiro MVP)

> Documentação completa das **Edge Functions (Deno)**, **Postgres Functions (RPC / triggers)** e **Cron Jobs (pg_cron)** do backend Supabase do **Rotta Financeiro**. Todos os nomes seguem exatamente a ESTRUTURA técnica. Onde uma function necessária para uma regra de negócio do PROCESSO não estava detalhada, ela foi adicionada e está marcada com **[EXTENSÃO]**.
>
> **Convenções de autenticação usadas neste documento:**
> - **público** — sem sessão (não usado neste MVP; não há cadastro aberto).
> - **usuário logado** — requer JWT válido do Supabase Auth (Admin ou Usuário).
> - **admin** — requer JWT válido cujo `profiles.role = 'admin'` (verificado via `is_admin()`).
> - **service role** — invocada internamente por outra Edge Function / Cron / trigger usando a `service_role key`; nunca chamada diretamente do frontend Lovable.
>
> As chaves de IA (Anthropic/Gemini) e de e-mail (Resend) vivem apenas nos secrets das Edge Functions — nunca no frontend.

---

## Edge Functions

### `parse-imported-file`
- **Propósito:** Baixar o arquivo importado do Storage, detectar seu tipo e extrair o conteúdo estruturado em `ledger_entries` brutos.
- **Autenticação exigida:** usuário logado (Admin ou Usuário — ambos importam, conforme RLS de `imported_files` INSERT). Internamente escreve em `ledger_entries` via service role.
- **Input (body):**
  ```json
  {
    "file_id": "uuid"
  }
  ```
- **Output:**
  ```json
  {
    "file_id": "uuid",
    "processing_status": "processado | erro",
    "entries_created": 142,
    "detected_file_type": "balancete",
    "next_step": "suggest-reclassification",
    "error": null
  }
  ```
- **Regras de negócio / validações:**
  - Valida que `file_id` existe em `imported_files` e que o usuário tem acesso (RLS).
  - Marca `imported_files.processing_status = 'processando'` no início e `'processado'`/`'erro'` no fim (grava `processing_error` em falha).
  - Detecta o `file_type` (`balancete`, `nota_fiscal`, `extrato_sicoob` etc.) a partir do arquivo/conteúdo.
  - PDF → interpretação multimodal via **Claude Sonnet 4.6** (padrão); documentos muito extensos → fallback **Gemini 2.5 Pro** (contexto 1M). Excel → parser de planilha.
  - Grava linhas em `ledger_entries` (`raw_value`, `source_account_name`, `entry_date`, `period_id`, `file_id`), sem preencher `reviewed_value` (edição manual é posterior).
  - Regra do PROCESSO: entrada é sempre manual (não há API G2/Sicoob) — esta função só age sobre arquivos já enviados ao bucket `imports`.
  - Se o `period_id` do arquivo **já possui demonstrativos gerados**, ao finalizar dispara `recalculate-period` em vez do fluxo normal (recálculo automático com preservação de edições manuais).
  - Ao concluir com sucesso, encadeia `suggest-reclassification` e `detect-inconsistencies`.
  - Registra ação via `log_activity('importou_arquivo', ...)`.

---

### `suggest-reclassification`
- **Propósito:** Sugerir a natureza contábil de cada conta sem mapeamento confirmado, usando o padrão aprendido da empresa + IA, gravando sugestões para aprovação.
- **Autenticação exigida:** usuário logado (encadeada por `parse-imported-file`) ou **admin** sob demanda; escreve em `reclassification_suggestions` via service role.
- **Input (body):**
  ```json
  {
    "period_id": "uuid",
    "file_id": "uuid | null"
  }
  ```
- **Output:**
  ```json
  {
    "period_id": "uuid",
    "suggestions_created": 23,
    "auto_matched_from_chart": 78,
    "pending_review": 23
  }
  ```
- **Regras de negócio / validações:**
  - Para cada conta com `chart_of_accounts.is_confirmed = true`, aplica a natureza diretamente em `ledger_entries.nature` (padrão já aprendido — não gera sugestão).
  - Para contas sem natureza confirmada, consulta o histórico de `chart_of_accounts` (padrão da empresa, `times_confirmed`) e chama a IA para propor uma das **8 naturezas** oficiais.
  - Grava em `reclassification_suggestions` com `current_nature`, `suggested_nature`, `reasoning` e `confidence_score`, `status = 'pendente'`.
  - **Regra crítica:** nada é aplicado silenciosamente — toda sugestão fica `pendente` até decisão do Admin (via `apply-reclassification-decision`).
  - Não duplica sugestões pendentes para o mesmo `entry_id`/`account_id`.

---

### `apply-reclassification-decision`
- **Propósito:** Aplicar a decisão do Admin (aprovar/rejeitar) sobre uma sugestão de reclassificação, atualizando o lançamento e reforçando o aprendizado da empresa.
- **Autenticação exigida:** **admin** (RLS de UPDATE em `reclassification_suggestions` é somente Admin).
- **Input (body):**
  ```json
  {
    "suggestion_id": "uuid",
    "decision": "aprovada | rejeitada"
  }
  ```
- **Output:**
  ```json
  {
    "suggestion_id": "uuid",
    "status": "aprovada",
    "entry_updated": true,
    "chart_account_confirmed": true,
    "times_confirmed": 4
  }
  ```
- **Regras de negócio / validações:**
  - Valida `is_admin()`; valida que a sugestão está `pendente` (não redecide sugestões já resolvidas).
  - Em **aprovada**: aplica `suggested_nature` em `ledger_entries.nature`, marca `chart_of_accounts.is_confirmed = true` e incrementa `times_confirmed` (aprendizado do padrão da empresa).
  - Em **rejeitada**: não altera o lançamento; registra a rejeição (também alimenta o aprendizado, evitando repetir a sugestão).
  - Preenche `decided_by = auth.uid()` e `decided_at = now()`; atualiza `status`.
  - Registra `log_activity('aprovou_reclassificacao' | 'rejeitou_reclassificacao', ...)`.

---

### `detect-inconsistencies`
- **Propósito:** Analisar os lançamentos e cruzamentos do período para detectar inconsistências e alimentar o Painel de Apontamentos.
- **Autenticação exigida:** usuário logado (encadeada por `parse-imported-file`) ou admin sob demanda; escreve em `audit_findings` via service role.
- **Input (body):**
  ```json
  {
    "period_id": "uuid"
  }
  ```
- **Output:**
  ```json
  {
    "period_id": "uuid",
    "findings_created": 9,
    "by_severity": { "alta": 2, "media": 4, "baixa": 3 }
  }
  ```
- **Regras de negócio / validações:**
  - Detecta e classifica em `finding_type`: `conta_sem_natureza`, `conta_mal_classificada`, `lancamento_incorreto`, `valor_divergente`, `duplicidade`.
  - Gera `description`, `suggested_fix` (correção na origem G2) e `severity` (`baixa`/`media`/`alta`).
  - **Regra:** apontamentos orientam a correção no **G2**; a função NUNCA corrige a origem automaticamente.
  - Não recria findings já `resolvido`/`ignorado` para o mesmo item (evita ruído em reprocessamentos).

---

### `generate-statements`
- **Propósito:** Recalcular e montar DRE, Balanço Patrimonial e Fluxo de Caixa a partir dos valores revisados/aprovados e calcular os indicadores do dashboard.
- **Autenticação exigida:** usuário logado (ação "Gerar demonstrativos"); escreve em `financial_statements` e `dashboard_indicators` via service role.
- **Input (body):**
  ```json
  {
    "period_id": "uuid"
  }
  ```
- **Output:**
  ```json
  {
    "period_id": "uuid",
    "statements_generated": ["dre", "balanco_patrimonial", "fluxo_de_caixa"],
    "indicators": {
      "margem_bruta": 0.2841,
      "ebitda": 152340.00,
      "resultado_liquido": 98120.55,
      "posicao_caixa": 431200.00
    }
  }
  ```
- **Regras de negócio / validações:**
  - Usa `reviewed_value` quando existir; caso contrário `raw_value` (edição manual prevalece).
  - Agrega por `nature` (as 8 naturezas) para montar o `content` (jsonb hierárquico) de cada `statement_type`.
  - Faz upsert em `financial_statements` respeitando o UNIQUE `(period_id, statement_type)`.
  - Calcula e faz upsert em `dashboard_indicators` (`margem_bruta`, `ebitda`, `resultado_liquido`, `posicao_caixa`, `receita_total`, `custo_total`) respeitando UNIQUE `(period_id, indicator_key)`.
  - **Recomendação de bloqueio (soft):** se houver contas com `nature` nula, ainda gera mas sinaliza (via `audit_findings`) que o demonstrativo pode estar incompleto.
  - Atualiza `accounting_periods.last_recalculated_at`.
  - Registra `log_activity('gerou_dre' / 'gerou_balanco' / 'gerou_fluxo_caixa', ...)`.

---

### `recalculate-period`
- **Propósito:** Fazer o merge de uma reimportação sobre um período já processado, preservando edições manuais e registrando o que mudou.
- **Autenticação exigida:** service role (disparada automaticamente por `parse-imported-file` ou pelo Cron `nightly-daily-refresh`).
- **Input (body):**
  ```json
  {
    "period_id": "uuid",
    "file_id": "uuid"
  }
  ```
- **Output:**
  ```json
  {
    "period_id": "uuid",
    "file_id": "uuid",
    "changes_logged": 17,
    "manual_edits_preserved": 5,
    "statements_regenerated": true
  }
  ```
- **Regras de negócio / validações:**
  - Faz merge dos novos `raw_value`/naturezas sobre os lançamentos existentes do período.
  - **Regra crítica:** onde `is_manually_edited = true`, o `reviewed_value` é mantido e o registro é marcado `manual_edit_preserved = true` no diff.
  - Grava cada alteração em `recalculation_logs` (`field_changed`, `old_value`, `new_value`, `manual_edit_preserved`) — tabela imutável.
  - Ao final, invoca `generate-statements` para reprocessar demonstrativos e indicadores.
  - Aciona notificação "recálculo concluído / valores atualizados" via Resend (ver `manage-user`/integração Resend) para a equipe interna.
  - Registra `log_activity('recalculou_periodo', ...)`.

---

### `export-report`
- **Propósito:** Gerar o arquivo PDF (com logo Rotta) ou Excel de um demonstrativo e devolver uma URL assinada de download.
- **Autenticação exigida:** usuário logado; grava no bucket privado `exports` e retorna signed URL.
- **Input (body):**
  ```json
  {
    "period_id": "uuid",
    "statement_type": "dre | balanco_patrimonial | fluxo_de_caixa",
    "format": "pdf | excel"
  }
  ```
- **Output:**
  ```json
  {
    "storage_path": "exports/2026/janeiro/dre.pdf",
    "signed_url": "https://.../exports/...",
    "expires_in": 3600
  }
  ```
- **Regras de negócio / validações:**
  - Valida que existe `financial_statements` para `(period_id, statement_type)`.
  - PDF é formatado com identidade visual/logo do Rotta; Excel com abas estruturadas.
  - Salva no bucket `exports` (privado) e retorna signed URL temporária (download restrito).
  - Registra `log_activity('exportou_relatorio', ...)`.

---

### `manage-user`
- **Propósito:** Criar, atualizar, desativar usuários internos e definir o papel (Admin/Usuário), operando sobre `auth.users` e `profiles`.
- **Autenticação exigida:** **admin** (chamada da tela `/usuarios`); usa service role internamente para operar em `auth.users`.
- **Input (body):**
  ```json
  {
    "action": "create | update | deactivate",
    "user_id": "uuid | null",
    "full_name": "string",
    "email": "string",
    "role": "admin | usuario",
    "is_active": true
  }
  ```
- **Output:**
  ```json
  {
    "action": "create",
    "user_id": "uuid",
    "role": "usuario",
    "invite_email_sent": true
  }
  ```
- **Regras de negócio / validações:**
  - Valida `is_admin()` (só Admin gerencia usuários).
  - **create:** cria o usuário no Auth, cria `profiles` correspondente e dispara e-mail de convite via **Resend** (free tier atende ao volume interno).
  - **update:** atualiza `full_name` e/ou `role`.
  - **deactivate:** marca `profiles.is_active = false` (não deleta, mantém trilha).
  - Não há cadastro aberto — apenas o Admin cria contas.
  - Registra `log_activity('criou_usuario' | 'atualizou_usuario' | 'desativou_usuario', ...)`.

---

## Postgres Functions (RPC / triggers)

### `is_admin()`
- **Tipo:** função auxiliar `SECURITY DEFINER` (usada dentro de policies RLS; chamável como RPC).
- **Propósito:** Retornar se o usuário autenticado atual tem papel de Admin.
- **Input:** nenhum (usa `auth.uid()`).
- **Output:** `boolean`.
- **Regras:** lê `profiles.role` do `auth.uid()`; retorna `true` somente se `role = 'admin'` e `is_active = true`. Base de todas as policies que restringem escrita a Admin (ex.: `chart_of_accounts`, `reclassification_suggestions`, `manage-user`).
- **Quando dispara:** avaliada em cada checagem de política RLS e quando chamada via RPC pelo client.

---

### `get_period_summary(period_id uuid)`
- **Tipo:** RPC chamável pelo client.
- **Propósito:** Fornecer ao painel do período um resumo consolidado do estado de trabalho.
- **Input:** `period_id uuid`.
- **Output (composite/jsonb):**
  ```json
  {
    "pending_suggestions": 5,
    "open_findings": 3,
    "findings_by_severity": { "alta": 1, "media": 1, "baixa": 1 },
    "statements_status": { "dre": true, "balanco_patrimonial": true, "fluxo_de_caixa": false },
    "period_status": "em_revisao",
    "last_recalculated_at": "2026-01-31T22:10:00Z"
  }
  ```
- **Regras:** conta `reclassification_suggestions` com `status = 'pendente'`, `audit_findings` com `status = 'aberto'` (por severidade) e verifica quais `financial_statements` existem para o período. Respeita RLS de leitura (qualquer usuário autenticado).
- **Quando dispara:** chamada via RPC pelo frontend ao abrir `/periodos` e `/dashboard`.

---

### `log_activity(action text, entity_type text, entity_id uuid, metadata jsonb)`
- **Tipo:** RPC chamável pelo client / usada pelas Edge Functions.
- **Propósito:** Inserir um registro na trilha de auditoria `activity_log`.
- **Input:** `action`, `entity_type`, `entity_id` (nullable), `metadata` (jsonb, opcional).
- **Output:** `uuid` do registro criado (ou `void`).
- **Regras:** grava `actor_id = auth.uid()` (ou o service role quando chamada internamente) e `created_at = now()`. Tabela imutável (sem UPDATE/DELETE). Usada em aprovações, edições e gerações.
- **Quando dispara:** via RPC a partir do frontend ou invocada pelas Edge Functions após ações relevantes.

---

### `handle_new_user()` **[EXTENSÃO]**
- **Tipo:** trigger de tabela.
- **Propósito:** Garantir que todo usuário criado no Auth tenha uma linha correspondente em `profiles` (necessário para as policies baseadas em `role`, que a ESTRUTURA exige mas cujo mecanismo de criação não foi detalhado).
- **Input/Output:** trigger `AFTER INSERT` — sem retorno ao client.
- **Regras:** cria `profiles` com `id = NEW.id`, `email = NEW.email`, `role` default `'usuario'` (o Admin promove depois via `manage-user`), `is_active = true`. Complementa `manage-user` como rede de segurança de consistência.
- **Quando dispara:** `AFTER INSERT` em `auth.users`.

---

### `set_updated_at()` **[EXTENSÃO]**
- **Tipo:** trigger de tabela.
- **Propósito:** Manter a coluna `updated_at` sempre coerente nas tabelas que a possuem (`profiles`, `chart_of_accounts`, `ledger_entries`), garantindo rastreabilidade das edições manuais citadas no PROCESSO.
- **Input/Output:** trigger `BEFORE UPDATE` — sem retorno ao client.
- **Regras:** define `NEW.updated_at = now()` em qualquer UPDATE.
- **Quando dispara:** `BEFORE UPDATE` em `profiles`, `chart_of_accounts` e `ledger_entries`.

---

### `mark_entry_manually_edited()` **[EXTENSÃO]**
- **Tipo:** trigger de tabela.
- **Propósito:** Sinalizar automaticamente quando um lançamento foi editado à mão, base para a regra "edições manuais prevalecem e são preservadas no recálculo".
- **Input/Output:** trigger `BEFORE UPDATE` em `ledger_entries` — sem retorno ao client.
- **Regras:** se o UPDATE alterar `reviewed_value` ou `nature` e a origem **não** for o service role (edição feita por um usuário na tabela editável), define `is_manually_edited = true` e `updated_by = auth.uid()`. Esse flag é lido por `recalculate-period` para preservar a edição (`manual_edit_preserved`).
- **Quando dispara:** `BEFORE UPDATE` em `ledger_entries`.

---

## Cron Jobs (pg_cron)

### `nightly-daily-refresh`
- **Tipo:** função de cron agendada via `pg_cron`.
- **Propósito:** Suportar o cenário de análise diária citado pelo usuário — consolidar automaticamente períodos que receberam arquivos novos ainda não recalculados.
- **Input/Output:** sem parâmetros de client; itera internamente pelos períodos elegíveis.
- **Regras:** identifica `accounting_periods` com `imported_files.processing_status = 'processado'` cujos lançamentos ainda não foram consolidados (arquivo mais novo que `last_recalculated_at`) e invoca `recalculate-period` (que preserva edições manuais e regenera demonstrativos). Ignora períodos com `status = 'fechado'`.
- **Quando dispara:** agendamento noturno diário via `pg_cron` (ex.: `0 3 * * *`, 03:00 America/Sao_Paulo).

---

> **Cobertura:** todas as Edge Functions da ESTRUTURA (`parse-imported-file`, `suggest-reclassification`, `apply-reclassification-decision`, `detect-inconsistencies`, `generate-statements`, `recalculate-period`, `export-report`, `manage-user`), todas as RPCs (`is_admin`, `get_period_summary`, `log_activity`) e o Cron `nightly-daily-refresh` estão documentadas. Triggers marcados **[EXTENSÃO]** (`handle_new_user`, `set_updated_at`, `mark_entry_manually_edited`) foram adicionados para sustentar regras de negócio do PROCESSO (criação de perfil, rastreabilidade de edições e preservação de ajustes manuais no recálculo).

---

## Extensão — Razão contábil, auditoria e agentes

> Nesta fase o backend deixou de usar Edge Functions Deno: a lógica roda em **server functions** do TanStack Start (`src/lib/*.functions.ts`), com autenticação por `requireSupabaseAuth`, e em **Postgres Functions** `security definer` protegidas por `is_admin()`.

### Postgres Functions (RPC)

| Função | Auth | Propósito |
|---|---|---|
| `import_journal_legs(_file_id, _legs, _reset, _skip_closing)` | admin | Grava um bloco de pernas do razão de forma atômica, cria contas novas em `ledger_accounts` e registra saldos anteriores (deduplicados). `_reset` limpa o movimento do arquivo antes da carga; `_skip_closing` (padrão `true`) descarta os lançamentos de encerramento do G2, pois o fechamento é feito no RotaBase. Usa `safe_numeric`/`safe_date`/`safe_int` (valor ruim vira nulo em vez de derrubar o bloco) e devolve relatório: `ok`, `received`, `inserted`, `new_accounts`, `openings`, `skipped_closing`, `closing_detected`, `ignored_no_account`, `ignored_no_value`, `bad_numbers`, `bad_dates`. Em falha, desfaz o bloco inteiro, grava o erro em `imported_files.processing_error` e retorna `ok:false` com `sqlstate`/`detail`/`hint`/`context`. |
| `finalize_journal_import(_file_id)` | admin | Fecha a importação: confere débito × crédito, compara contas e saldos com o período anterior (possível truncamento) e sinaliza encerramentos que entraram na base. Define `imported_files.processing_status` como `processado` ou `erro` com o motivo. Retorna totais, `difference` e `warnings`. |
| `delete_imported_file(_file_id)` | admin | Exclusão padrão de arquivo importado: apaga em **uma única transação** as pernas do razão, as linhas legadas (`ledger_entries`) e o espelho (`trial_balance_lines`) do arquivo e só então o registro em `imported_files`. Bloqueia período fechado e registra em `activity_log`. Retorna `storage_path` (para remover o objeto no bucket) e as contagens apagadas. Se qualquer passo falhar, **nada** é excluído — evita o caso de arquivo removido com movimento órfão (`file_id` nulo). |
| `purge_period_journal(_period_id)` | admin | Limpa todo o movimento do período: `journal_legs`, `ledger_entries`, `trial_balance_lines` e `journal_account_openings`, seguido de `recalculate_period_indicators_internal`. Bloqueia período com status `fechado` ou com fechamento contábil ativo. Registra em `activity_log`. Usada pelo botão "Limpar movimento do período" em `/importar` para lançamentos sem arquivo vinculado. |


| `import_trial_balance_lines(_file_id, _lines)` | admin | Grava/atualiza o espelho oficial do balancete (upsert por `period_id` + `code`). |
| `link_reduced_accounts(_period_id)` | admin | Casamento razão × balancete em 5 rodadas: nome normalizado, nome sem sufixo de filial, confronto débito/crédito, saldo final e natureza pelo código. Cada vínculo gera registro em `ledger_account_audit`. Retorna contagens e `pending`. |
| `reconcile_journal_vs_trial_balance(_period_id)` | usuário logado | Conferência conta a conta: `ok`, `divergente`, `so_razao`, `so_balancete`. |
| `journal_pending_report(_period_id)` | usuário logado | Relatório de pendências com causa provável, detalhe, ação sugerida e delta. |
| `journal_account_statement(_period_id, _reduced_code, _limit, _offset)` | usuário logado | Extrato paginado da conta: saldo anterior, totais e pernas com contrapartida nomeada. |
| `journal_document(_period_id, _doc_number)` | usuário logado | Lançamento completo com todas as pernas e conferência débito = crédito. |
| `journal_search(_period_id, _query, _limit, _offset)` | usuário logado | Busca livre nos lançamentos do período (número do documento, código/nome da conta e da contrapartida, histórico e valor), sem acento e sem distinção de maiúsculas, ordenada por data decrescente e paginada. Usada pela server function `searchJournalLegs` na aba Lançamento → Buscar de `/razao`. Índices GIN trigram em `journal_legs` e `ledger_accounts`. |

| `journal_top_counterparts(_period_id, _reduced_code, _limit)` | usuário logado | Contrapartidas mais frequentes da conta, com percentual — evidência das propostas do agente. |
| `set_account_link(_reduced_code, _hierarchical_code, _nature)` | admin | Confirma manualmente o vínculo e a natureza; grava auditoria. |
| `recalculate_period_indicators_internal(_period_id)` | interna | Recalcula indicadores; usa o razão quando há pernas no período, senão o balancete. |
| `generate_period_statements(_period_id)` | interna/admin | Gera DRE, Balanço e Fluxo de Caixa; o JSON traz `fonte` = `razao` ou `balancete`. |

### Server functions (`src/lib/razao.functions.ts`)

`importJournalChunk`, `importTrialBalanceMirror`, `finalizeJournalImport` (casa contas + recalcula + gera demonstrativos + marca o arquivo como processado + registra atividade), `linkReducedAccounts`, `reconcileJournal`, `pendingReport`, `topCounterparts`, `getAccountStatement`, `getJournalDocument`, `setAccountLink`.

### Ferramentas dos agentes (somente leitura)

`razao_extrato_conta`, `razao_lancamento`, `razao_contrapartidas`, `razao_conferencia`, `razao_pendencias`, além das ferramentas de balancete, plano de contas, indicadores e demonstrativos. O Agente CFO não recebe ferramentas de escrita; o Agente Contador propõe e só o Admin aplica.
