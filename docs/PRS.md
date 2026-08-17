## 1. Requisitos de sistema

Os requisitos de sistema (RS) abaixo são técnicos e testáveis. Cada um rastreia o requisito funcional (RF) do Rotta Financeiro que satisfaz. Convenção de RFs inferida do PROCESSO/ESTRUTURA:

- **RF-01** — Autenticação e gestão de usuários internos (Admin/Usuário).
- **RF-02** — Gestão de períodos contábeis (abrir/selecionar/fechar).
- **RF-03** — Upload e importação de arquivos PDF/Excel (balancete, NF, romaneio, extrato Sicoob etc.).
- **RF-04** — Leitura/interpretação automática dos arquivos e extração de lançamentos.
- **RF-05** — Mapeamento do plano de contas do Rotta para as 8 naturezas contábeis.
- **RF-06** — Sugestão de reclassificação pela IA com aprovação/rejeição do Admin.
- **RF-07** — Aprendizado do padrão da empresa a partir das aprovações/rejeições.
- **RF-08** — Tabela editável de lançamentos (editar valores, reclassificar, ajustar).
- **RF-09** — Painel de Apontamentos de inconsistências e sugestões de correção no G2.
- **RF-10** — Geração automática de DRE, Balanço Patrimonial e Fluxo de Caixa.
- **RF-11** — Dashboard de resultado e BI com indicadores e gráficos.
- **RF-12** — Exportação de relatórios em PDF e Excel.
- **RF-13** — Recálculo automático ao reimportar sobre período processado, com lista de valores atualizados.
- **RF-14** — Trilha de auditoria de ações relevantes.

---

**RS-01:** O sistema deve autenticar exclusivamente por email + senha via Supabase Auth, sem cadastro público aberto; toda criação de conta deve ocorrer apenas pela Edge Function `manage-user` acionada por um Admin.
Rastreia: RF-01

**RS-02:** O sistema deve manter em `profiles.role` apenas os valores `'admin'` ou `'usuario'`, rejeitando qualquer outro valor via constraint, e a função `is_admin()` (SECURITY DEFINER) deve resolver o papel do `auth.uid()` para uso nas policies.
Rastreia: RF-01

**RS-03:** A Edge Function `manage-user` deve permitir criar, atualizar `role` e desativar (`is_active=false`) usuários, e deve negar a operação quando o chamador não for Admin (retorno 403).
Rastreia: RF-01

**RS-04:** O sistema deve permitir criar um `accounting_period` com `label`, `reference_month` (primeiro dia do mês) e `status` inicial `'aberto'`, e apenas Admin pode alterar o `status` para `'em_revisao'` ou `'fechado'`.
Rastreia: RF-02

**RS-05:** O endpoint de upload deve aceitar apenas arquivos `application/pdf` e planilhas (Excel/CSV), gravar no bucket privado `imports` via signed URL, e criar um registro em `imported_files` com `processing_status='pendente'` associado a um `period_id` válido.
Rastreia: RF-03

**RS-06:** Todo `imported_files.file_type` deve pertencer ao conjunto fechado (`balancete`, `pedido_compra`, `nota_fiscal`, `romaneio_abate`, `contas_pagar`, `contas_receber`, `relatorio_vendas`, `extrato_sicoob`); valores fora do conjunto devem ser rejeitados.
Rastreia: RF-03

**RS-07:** A Edge Function `parse-imported-file` deve baixar o arquivo pelo `file_id`, extrair os lançamentos (PDF via IA multimodal, Excel via parser), gravar `ledger_entries` com `raw_value` e atualizar `imported_files.processing_status` para `'processado'` ou `'erro'` (preenchendo `processing_error` em falha).
Rastreia: RF-04

**RS-08:** A `parse-imported-file` deve preservar o valor bruto original em `ledger_entries.raw_value` sem sobrescrevê-lo; qualquer valor revisado deve ser gravado apenas em `reviewed_value`.
Rastreia: RF-04, RF-08

**RS-09:** O sistema deve permitir ao Admin associar cada conta de origem (`chart_of_accounts.source_code`/`source_name`) a exatamente uma das 8 naturezas; a combinação (`source_code`, `source_name`) deve ser única (`uniq_coa_source`).
Rastreia: RF-05

**RS-10:** Ao mapear/confirmar uma conta, o sistema deve marcar `chart_of_accounts.is_confirmed=true`; e apenas Admin pode inserir/atualizar/excluir em `chart_of_accounts`.
Rastreia: RF-05

**RS-11:** A Edge Function `suggest-reclassification` deve gerar, para cada conta sem natureza confirmada, um registro em `reclassification_suggestions` com `suggested_nature`, `reasoning` e `confidence_score`, sem alterar `ledger_entries.nature` (nada aplicado silenciosamente).
Rastreia: RF-06

**RS-12:** A Edge Function `apply-reclassification-decision` deve, ao receber `'aprovada'`, atualizar `ledger_entries.nature` e a natureza da conta correspondente; ao receber `'rejeitada'`, apenas registrar a decisão — em ambos os casos gravando `decided_by` e `decided_at`. A operação deve ser permitida apenas a Admin.
Rastreia: RF-06

**RS-13:** Ao aprovar uma reclassificação, o sistema deve incrementar `chart_of_accounts.times_confirmed` e marcar `is_confirmed=true`, de modo que sugestões futuras da mesma conta priorizem a natureza aprendida antes de acionar a IA.
Rastreia: RF-07

**RS-14:** A tabela editável de `/balancete` deve permitir a Admin e Usuário editar `reviewed_value` e `nature` de um lançamento, marcando `is_manually_edited=true` e registrando `updated_by`; e `reviewed_value` deve prevalecer sobre `raw_value` em todos os cálculos.
Rastreia: RF-08

**RS-15:** A Edge Function `detect-inconsistencies` deve popular `audit_findings` com `finding_type` do conjunto fechado (`conta_mal_classificada`, `lancamento_incorreto`, `valor_divergente`, `conta_sem_natureza`, `duplicidade`), `description`, `suggested_fix` e `severity`.
Rastreia: RF-09

**RS-16:** O Painel de Apontamentos deve permitir a Admin e Usuário alterar `audit_findings.status` para `'resolvido'` ou `'ignorado'`, registrando `resolved_by`, sem que isso altere dados na origem G2 (apenas orientação de correção).
Rastreia: RF-09

**RS-17:** A Edge Function `generate-statements` deve calcular DRE, Balanço Patrimonial e Fluxo de Caixa a partir das contas classificadas e dos valores revisados/aprovados, gravando um registro por tipo em `financial_statements` (unicidade `period_id` + `statement_type`) com `content` em JSONB estruturado.
Rastreia: RF-10

**RS-18:** A `generate-statements` deve, no mesmo processamento, calcular e persistir os indicadores em `dashboard_indicators` (`margem_bruta`, `ebitda`, `resultado_liquido`, `posicao_caixa`, `receita_total`, `custo_total`), com unicidade `period_id` + `indicator_key`.
Rastreia: RF-11

**RS-19:** A tela `/dashboard` deve renderizar os indicadores e gráficos a partir de `dashboard_indicators` para o período selecionado, atualizando via Realtime quando novos cálculos forem persistidos.
Rastreia: RF-11

**RS-20:** A Edge Function `export-report` deve gerar PDF (com logo Rotta) e Excel dos demonstrativos, salvar no bucket privado `exports` e retornar signed URL de download com expiração; o download não deve ser possível sem autenticação.
Rastreia: RF-12

**RS-21:** A Edge Function `recalculate-period`, ao processar reimportação sobre período já processado, deve fazer merge preservando lançamentos com `is_manually_edited=true`, registrar cada alteração em `recalculation_logs` (`field_changed`, `old_value`, `new_value`, `manual_edit_preserved`) e reexecutar `generate-statements`.
Rastreia: RF-13

**RS-22:** A tela `/atualizacoes` deve listar os diffs de `recalculation_logs` do período, sinalizando explicitamente as edições manuais preservadas (`manual_edit_preserved=true`); os registros de log devem ser imutáveis (sem UPDATE/DELETE).
Rastreia: RF-13

**RS-23:** O Cron Job `nightly-daily-refresh` (pg_cron) deve, diariamente, identificar períodos com arquivos novos não consolidados e disparar `recalculate-period`, suportando o cenário de análise diária.
Rastreia: RF-13

**RS-24:** Toda ação relevante (aprovar reclassificação, editar lançamento, gerar demonstrativo) deve gerar um registro em `activity_log` via `log_activity(...)`, com `actor_id`, `action`, `entity_type` e `entity_id`; a leitura da trilha deve ser restrita a Admin e os registros imutáveis.
Rastreia: RF-14

---

## 2. Arquitetura

O Rotta Financeiro é uma aplicação single-tenant (uma empresa: Rotta) organizada em três camadas: frontend web, backend Supabase e integrações externas de IA/email. A lógica pesada (parsing de PDF/Excel, reclassificação por IA, recálculo de demonstrativos) fica em Edge Functions, invisível ao gestor não-técnico.

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND (Lovable — React + Tailwind + shadcn/ui)            │
│  /login /dashboard /periodos /importar /balancete             │
│  /reclassificacoes /plano-de-contas /apontamentos             │
│  /demonstrativos /atualizacoes /usuarios                      │
└───────────────┬──────────────────────────────────────────────┘
                │ SDK Supabase (Auth JWT, RLS, Realtime, signed URLs)
                ▼
┌──────────────────────────────────────────────────────────────┐
│  BACKEND — SUPABASE                                           │
│                                                              │
│  ┌────────────┐  ┌───────────────┐  ┌───────────────────┐    │
│  │ PostgreSQL │  │ Auth          │  │ Storage           │    │
│  │ + RLS      │  │ email/senha   │  │ imports/ exports/ │    │
│  │ (13 tabs)  │  │ is_admin()    │  │ (buckets privados)│    │
│  └────────────┘  └───────────────┘  └───────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Edge Functions (Deno)                                │    │
│  │ parse-imported-file · suggest-reclassification       │    │
│  │ apply-reclassification-decision · detect-inconsist.  │    │
│  │ generate-statements · recalculate-period             │    │
│  │ export-report · manage-user                          │    │
│  └───────────────────┬──────────────────────────────────┘    │
│                      │                                        │
│  ┌───────────────────┴──────────┐  ┌────────────────────┐    │
│  │ Realtime (dashboard/status)  │  │ pg_cron            │    │
│  │                              │  │ nightly-refresh    │    │
│  └──────────────────────────────┘  └────────────────────┘    │
└───────────────┬──────────────────────────────────────────────┘
                │ (chaves em variáveis de ambiente, nunca no frontend)
                ▼
┌──────────────────────────────────────────────────────────────┐
│  INTEGRAÇÕES EXTERNAS                                         │
│  Anthropic Claude (Sonnet 4.6 / Haiku 4.5) — leitura PDF     │
│  Google Gemini 2.5 Pro — fallback arquivos grandes           │
│  Resend — convites e notificação de recálculo                │
│  (SEM G2 / SEM Sicoob — não há API, só importação manual)    │
└──────────────────────────────────────────────────────────────┘
```

**Fluxo principal:** o usuário faz upload de um arquivo em `/importar` → Storage `imports` + registro em `imported_files` → `parse-imported-file` extrai `ledger_entries` → `suggest-reclassification` cria sugestões → Admin aprova em `/reclassificacoes` (aplica natureza + aprende) → `detect-inconsistencies` popula o Painel de Apontamentos → `generate-statements` monta DRE/Balanço/Fluxo + indicadores → visualização em `/demonstrativos` e `/dashboard` → `export-report` gera PDF/Excel. Reimportações disparam `recalculate-period` preservando edições manuais e registrando diffs em `/atualizacoes`.

---

## 3. Stack tecnológica

**Backend — Supabase (não negociável):**
- **PostgreSQL** gerenciado com 13 tabelas (perfis, períodos, arquivos, plano de contas, lançamentos, sugestões, apontamentos, demonstrativos, indicadores, logs de recálculo, trilha de auditoria) e **RLS** habilitado em todas.
- **Auth** por email + senha (equipe interna), sem cadastro público; criação de contas só pelo Admin.
- **Storage** com buckets privados `imports` (arquivos do G2/Sicoob) e `exports` (PDFs/Excel gerados), acesso por signed URL.
- **Edge Functions (Deno)** para toda a lógica server-side: parsing de documentos, chamadas de IA, recálculo de demonstrativos e geração de relatórios — mantendo as API keys fora do frontend.
- **Realtime** para atualizar status de processamento de arquivos e o dashboard sem refresh manual.
- **pg_cron** para o refresh diário (`nightly-daily-refresh`) que suporta o cenário de "análise diária" citado pelo usuário.

**Frontend — Lovable (React + Tailwind + shadcn/ui):**
O caminho de build escolhido é **Lovable + Supabase**, ancorado no perfil descrito no dossiê: "Gestor de operações de frigorífico, com domínio de processos financeiros mas **sem perfil técnico**", com equipe de "usuários internos" e sem TI dedicada para manter código. Como o critério de sucesso do MVP é operacional — "importar um balancete, visualizar as contas, reclassificar, editar valores manualmente e gerar DRE, Balanço e Fluxo de Caixa em uma única sessão" — o Lovable entrega o caminho mais rápido do zero ao app no ar, com **tabelas editáveis** (essenciais para o `/balancete`) geradas de forma no-code e integração nativa ao Supabase. Toda a complexidade técnica (IA, parsing, recálculo) fica encapsulada nas Edge Functions, invisível para o gestor. Não há necessidade de Next.js/Vue/Angular; o React gerado pelo Lovable atende ao escopo.

**Integrações externas (via Edge Functions):**
- **Anthropic — Claude Sonnet 4.6** como padrão para interpretar o balancete PDF e reclassificar contas (bom equilíbrio qualidade/custo, precisão em documento contábil), com **Claude Haiku 4.5** para alto volume de linhas simples.
- **Google — Gemini 2.5 Pro** como fallback para arquivos muito extensos (contexto de 1M tokens, multimodal, custo baixo).
- **Resend** (email transacional) no Free tier (100/dia) para convites de usuários e notificações de recálculo concluído.
- **Sem integração com G2 ou Sicoob** — confirmado: não há API, toda entrada é por importação manual.

**Custos de referência:** Lovable Pro (R$95/mês) para o app publicado; Supabase Pro (R$125/mês) pelo Storage e volume de invocations do parsing; IA em pague-por-uso (Sonnet 4.6/Haiku 4.5), baixo dado o volume documental mensal; Resend Free.

---

## 4. Segurança

**Autenticação:** Supabase Auth por email + senha, com confirmação de email recomendada. Não há OAuth público nem auto-cadastro — apenas o Admin cria contas via `manage-user` (que usa service role para operar em `auth.users`). O modelo é single-tenant (Rotta), portanto o isolamento é por **papel** (`profiles.role`), não por organização.

**RLS por tabela (habilitado em todas):**
- **`profiles`**: SELECT do próprio perfil por qualquer autenticado; Admin lê todos. INSERT/UPDATE/DELETE só Admin (cada usuário pode atualizar o próprio `full_name`).
- **`accounting_periods`**: SELECT todos autenticados; INSERT/UPDATE/DELETE só Admin.
- **`imported_files`**: SELECT todos; INSERT Admin e Usuário; UPDATE Admin ou o próprio `uploaded_by`; DELETE só Admin.
- **`chart_of_accounts`**: SELECT todos; INSERT/UPDATE/DELETE só Admin (só o Admin define o mapeamento).
- **`ledger_entries`**: SELECT todos; INSERT via Edge Function (service role) e Admin; UPDATE Admin e Usuário (edição manual); DELETE só Admin.
- **`reclassification_suggestions`**: SELECT todos; INSERT via Edge Function; UPDATE (aprovar/rejeitar) só Admin; DELETE Admin.
- **`audit_findings`**: SELECT todos; INSERT via Edge Function; UPDATE (resolver/ignorar) Admin e Usuário; DELETE Admin.
- **`financial_statements`** e **`dashboard_indicators`**: SELECT todos; INSERT/UPDATE via Edge Function; DELETE Admin.
- **`recalculation_logs`**: SELECT todos; INSERT via Edge Function; sem UPDATE/DELETE (imutável).
- **`activity_log`**: SELECT só Admin; INSERT via Edge Function/RPC; sem UPDATE/DELETE (trilha imutável).

O helper `is_admin()` (Postgres `SECURITY DEFINER`) é a base das policies que restringem operações administrativas.

**Storage:** buckets `imports` e `exports` privados; upload por signed URL restrito a autenticados; download de relatórios por signed URL com expiração. Nenhum arquivo do G2/Sicoob é público.

**Dados sensíveis / LGPD:** os arquivos contêm dados financeiros e contábeis do Rotta (balancetes, NFs, extrato bancário Sicoob). Todos ficam em buckets privados, acessíveis somente por usuários internos autenticados e com signed URL. A `activity_log` fornece rastreabilidade de quem importou, editou, aprovou e gerou relatórios — atendendo à demanda de auditoria interna. Como não há usuário externo no MVP e não há compartilhamento automático com terceiros, a superfície de exposição é mínima; o acesso segue o princípio do menor privilégio via papéis.

**Segredos e API keys:** as chaves da Anthropic, Google Gemini e Resend residem exclusivamente em **variáveis de ambiente das Edge Functions** — nunca no frontend Lovable nem em código versionado. O frontend jamais chama as APIs de IA diretamente; toda chamada externa passa por Edge Function autenticada, que valida o JWT do usuário antes de executar.

---

## 5. Performance

**Carga/volume esperado:** ancorado nas respostas — a equipe é interna e reduzida (perfis Admin e Usuário), com ciclo padrão de **fechamento mensal** e possibilidade de **atualizações semanais ou diárias** ("melhor cenário de análise diária"). Isso significa poucos usuários simultâneos e um volume documental que gira entre 8 tipos de arquivo por período (balancete, NF, romaneio, contas a pagar/receber, vendas, pedidos, extrato Sicoob). O gargalo real não é concorrência de usuários, mas o **parsing por IA de documentos** e o **recálculo de demonstrativos**.

**Índices críticos** (já previstos na estrutura): `idx_entries_period`, `idx_entries_file`, `idx_entries_nature` e `idx_entries_edited` em `ledger_entries` (tabela central e mais volumosa); `idx_files_period`/`idx_files_status` para acompanhar processamento; `idx_suggestions_status` e `idx_findings_status` para os painéis; unicidades `uniq_statement (period_id, statement_type)`, `uniq_indicator (period_id, indicator_key)` e `uniq_coa_source (source_code, source_name)` para evitar duplicação em recálculos e reimportações; `idx_reclog_period`/`idx_reclog_file` para montar rapidamente a lista de "valores atualizados".

**Limites conhecidos e mitigações:**
- **Timeout de Edge Function (~60s):** o parsing de PDFs longos com IA pode se aproximar do limite. Mitigação — `parse-imported-file` roda de forma assíncrona (dispara após upload e atualiza `processing_status`), o frontend acompanha o status via Realtime em vez de aguardar resposta síncrona, e arquivos muito extensos são roteados para **Gemini 2.5 Pro** (contexto de 1M tokens) para evitar múltiplas passagens.
- **Tamanho de payload / arquivos grandes:** o upload vai direto ao Storage via signed URL (não passa como payload de Edge Function), evitando limites de corpo de requisição; a Edge Function só recebe o `file_id`.
- **Recálculo em reimportações:** `recalculate-period` faz merge incremental preservando edições manuais e registra apenas os diffs em `recalculation_logs`, evitando reprocessar tudo do zero quando desnecessário; o `nightly-daily-refresh` distribui a carga de consolidação diária no horário noturno.
- **Dashboard/BI:** os indicadores são **pré-calculados e persistidos** em `dashboard_indicators` por período (não recalculados a cada abertura de tela), garantindo carregamento rápido dos gráficos mesmo com histórico de vários meses; a atualização chega via Realtime quando um recálculo persiste novos valores.
- **Custo de IA sob controle:** uso preferencial de **Claude Haiku 4.5** para linhas simples/alto volume e **Sonnet 4.6** apenas para interpretação que exige precisão, mantendo o custo por uso baixo para o volume mensal do Rotta.

---

## Requisitos de sistema — Razão contábil

- **RS-R1 (RF-R1):** a importação de planilha exige mapeamento de conta reduzida, débito e crédito; o sistema bloqueia a gravação enquanto houver erro bloqueante e exibe "X linhas válidas / Y com problema" com a linha original de cada erro.
- **RS-R2 (RF-R1):** o envio ocorre em blocos de até 4.000 pernas por chamada, com barra de progresso; reimportar o mesmo arquivo com `reset` substitui o movimento daquele arquivo.
- **RS-R3 (RF-R2):** `ledger_accounts.reduced_code` é único e serve de chave estável; `link_status` distingue `pendente`, `sugerido`, `confirmado` e `confirmado_manual`.
- **RS-R4 (RF-R3):** `link_reduced_accounts` só vincula quando o par é único dos dois lados, em rodadas de nome, nome-base, movimento, saldo e natureza por código, e retorna o total pendente.
- **RS-R5 (RF-R4):** o extrato é sempre paginado por conta (nunca o mês inteiro de uma vez) e o lançamento exibe a soma de débitos e créditos para conferência.
- **RS-R6 (RF-R5):** `generate_period_statements` e `recalculate_period_indicators_internal` retornam `fonte`/`source` igual a `razao` quando existirem pernas no período, senão `balancete`.
- **RS-R7 (RF-R6):** `ledger_account_audit` não tem policies de UPDATE/DELETE; a gravação ocorre apenas dentro de funções `security definer`.
- **RS-R8 (RF-R8):** as ferramentas do agente são somente leitura; qualquer gravação passa por server function com `requireSupabaseAuth` e verificação de Admin, disparada pelo botão "Aplicar".
