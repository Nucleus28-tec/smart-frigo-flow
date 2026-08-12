## Fase 1 — Fundação

**Entregável:** Projeto Rotta Financeiro criado no Lovable, banco de dados Supabase completo (todas as tabelas + RLS + helper `is_admin()`), autenticação por email/senha da equipe interna funcionando e o layout base do app (menu lateral com todas as páginas, header, controle de acesso por papel Admin/Usuário).

**Tabelas envolvidas:** `profiles`, `accounting_periods`, `imported_files`, `chart_of_accounts`, `ledger_entries`, `reclassification_suggestions`, `audit_findings`, `financial_statements`, `dashboard_indicators`, `recalculation_logs`, `activity_log` (todas de `db/schemas.sql`).

**Páginas envolvidas:** `/login`, shell de navegação para `/dashboard`, `/periodos`, `/importar`, `/balancete`, `/reclassificacoes`, `/plano-de-contas`, `/apontamentos`, `/demonstrativos`, `/atualizacoes`, `/usuarios`.

**Functions envolvidas:** `is_admin()`, `manage-user` (cadastro interno de usuários pelo Admin), `log_activity()`.

**Checklist:**
- [ ] Criar o projeto no Lovable conectado ao Supabase
- [ ] Rodar `db/schemas.sql` no Supabase (tabelas, índices, RLS e `is_admin()`)
- [ ] Configurar Auth email/senha e a tabela `profiles` sincronizada com `auth.users`
- [ ] Criar a Edge Function `manage-user` e a tela `/usuarios` (Admin cadastra/desativa usuários e define papel)
- [ ] Montar o layout base (menu lateral, header, rotas protegidas por papel)
- [ ] Criar a página `/periodos` para criar e selecionar o período de fechamento

---

## Fase 2 — Construção

**Entregável:** O fluxo completo do MVP funcionando de ponta a ponta — importar arquivos do G2/Sicoob, a IA ler e estruturar os lançamentos, sugerir reclassificações para o Admin aprovar (com aprendizado do plano de contas), editar o balancete manualmente, ver apontamentos de inconsistência e gerar DRE, Balanço Patrimonial e Fluxo de Caixa com indicadores no dashboard/BI.

**Tabelas envolvidas:** `imported_files`, `ledger_entries`, `chart_of_accounts`, `reclassification_suggestions`, `audit_findings`, `financial_statements`, `dashboard_indicators`, `recalculation_logs`.

**Páginas envolvidas:** `/importar`, `/balancete`, `/reclassificacoes`, `/plano-de-contas`, `/apontamentos`, `/demonstrativos`, `/dashboard`, `/atualizacoes`.

**Functions envolvidas:** `parse-imported-file`, `suggest-reclassification`, `apply-reclassification-decision`, `detect-inconsistencies`, `generate-statements`, `recalculate-period`, `export-report`, `get_period_summary()`.

**Checklist:**
- [ ] Upload de PDF/Excel em `/importar` + Edge Function `parse-imported-file` (Claude Sonnet 4.6) gravando `ledger_entries`
- [ ] Tabela editável `/balancete` (editar valores, reclassificar, edições manuais destacadas) + `/plano-de-contas`
- [ ] Painel `/reclassificacoes` com `suggest-reclassification` e `apply-reclassification-decision` (aprovação e aprendizado)
- [ ] Painel `/apontamentos` com `detect-inconsistencies` populando `audit_findings`
- [ ] Geração de DRE/Balanço/Fluxo de Caixa (`generate-statements`) em `/demonstrativos` + `dashboard_indicators`
- [ ] Dashboard/BI em `/dashboard` (margem bruta, EBITDA, resultado líquido, posição de caixa) com gráficos

---

## Fase 3 — Polimento e lançamento

**Entregável:** App robusto e pronto para o dia a dia — recálculo automático ao reimportar arquivos (preservando edições manuais), tela de valores atualizados, exportação em PDF/Excel, estados de vazio/carregando/erro em todas as telas, responsividade, cron de atualização diária e deploy publicado para a equipe do Rotta.

**Tabelas envolvidas:** `recalculation_logs`, `financial_statements`, `dashboard_indicators`, `activity_log`.

**Páginas envolvidas:** `/atualizacoes`, `/demonstrativos`, todas as telas (estados vazio/erro/loading e responsividade).

**Functions envolvidas:** `recalculate-period`, `export-report`, Cron `nightly-daily-refresh`, Resend (notificação de recálculo).

**Checklist:**
- [ ] Recálculo automático ao reimportar (`recalculate-period`) + tela `/atualizacoes` listando os diffs e edições manuais preservadas
- [ ] Exportação PDF (com logo Rotta) e Excel dos demonstrativos via `export-report` no bucket `exports`
- [ ] Estados de vazio/carregando/erro e responsividade em todas as páginas
- [ ] Cron `nightly-daily-refresh` + notificação Resend de "recálculo concluído"
- [ ] Testar o fluxo completo (importar → reclassificar → editar → gerar relatórios) e publicar o app
