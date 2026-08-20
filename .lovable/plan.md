# Migração: razão contábil como fonte única de cálculo

O razão passa a ser a única verdade do sistema. O balancete deixa de ser importado e passa a ser gerado. Execução em fases, uma de cada vez, com validação sua contra o G2 antes de avançar.

## O que já está confirmado no banco

- `generate_period_statements` e `recalculate_period_indicators_internal` já preferem o razão quando o período tem lançamentos ativos (fallback no balancete importado).
- Junho/2026 tem os lançamentos de encerramento do G2 misturados ao movimento: histórico "Encerramento parcial 06/2026" / "Resultado parcial 06/2026" com contrapartida em `023511` (Resultado do Exercício) e `023413`, somando R$ 16,79 mi no crédito da conta de resultado. Esses lançamentos **não** têm `entry_group` preenchido (só o fechamento feito pelo próprio sistema tem), então hoje entram na DRE e distorcem a receita.
- `trial_balance_lines` está vazia; `ledger_entries` tem 9.700 linhas legadas; `chart_of_accounts` 4.565 contas legadas; `ledger_accounts` 1.316 contas do razão.

## Fase 1 — Camada de cálculo canônica

Alicerce de tudo. Criar, no banco, uma camada única de saldos que separa dois conceitos:

- **Movimento do período** (alimenta DRE e índices de resultado): lançamentos do mês **excluindo** os de encerramento.
- **Saldo da conta** (alimenta Balanço): saldo anterior + débito − crédito, com encerramento incluído.

Um lançamento é classificado como encerramento quando tem `entry_group` de fechamento **ou** toca a conta de resultado configurada no fechamento (`result_code` / `profit_code`) **ou** o histórico casa com o padrão de encerramento/resultado do G2. A marcação fica gravada na perna (flag persistida), não recalculada por texto a cada consulta.

Todas as telas passam a ler dessa camada — nenhuma tela faz soma própria.

Validação da fase: receita de Junho/2026 = R$ 16.791.473,92 (e não R$ 0,02), Ativo = Passivo+PL.

## Fase 2 — Balancete gerado e plano de contas único

**/balancete** deixa de ser editável e passa a exibir o balancete derivado do razão: por conta, saldo anterior, débito, crédito, saldo atual, agrupado por natureza, com totais e conferência Ativo × Passivo+PL. Cada linha tem atalho "Lançar ajuste", que abre o formulário de lançamento manual do razão já contextualizado na conta (usando `upsert_manual_journal_entry`, que já existe). Período fechado não aceita ajuste.

**Plano de contas**: `ledger_accounts` vira o único plano. `/plano-de-contas` e `/reclassificacoes` passam a operar sobre ele; `chart_of_accounts` fica como legado, sem leitura por tela.

**/importar**: o tipo "balancete" sai da tela e os arquivos de balancete somem da listagem — só razão contábil é importado. Nenhuma tela lê mais `ledger_entries`; os dados ficam no banco, sem interface.

## Fase 3 — Demonstrativos com drill-down

`/demonstrativos` consome exclusivamente a camada da Fase 1: DRE pelo movimento do período, Balanço pelo saldo da conta, DFC pela variação das contas de caixa/banco/aplicação. O campo `fonte` continua exibido. Clicar numa linha do demonstrativo abre em `/razao` os lançamentos que a compõem.

## Fase 4 — Índices e Dashboard

Liquidez, margens, endividamento e giro calculados sobre a mesma camada, gravados em `dashboard_indicators`. Dashboard e BI leem só de lá. Todo número exibido leva ao detalhe: indicador → conta → lançamento.

## Fase 5 — Agente Contábil sobre o razão

O agente continua sem gravar nada: propõe, mostra evidência (contrapartidas, histórico, conta) e só o botão Aplicar do Admin efetiva. As propostas passam a incluir ajuste de lançamento (reclassificação de conta e correção de valor) com diff visível valor atual → valor proposto. Aplicar gera um **lançamento de ajuste** rastreável, nunca edição silenciosa do lançamento importado, e grava em `ledger_account_audit`.

## Detalhes técnicos

- Nova coluna booleana em `journal_legs` marcando perna de encerramento, preenchida na importação e por backfill nos períodos já importados; trigger mantém a marcação em lançamentos manuais.
- Novas funções de banco de camada canônica (`period_account_balances` / `period_movement`), consumidas por `recalculate_period_indicators_internal`, `generate_period_statements`, pelo balancete gerado e pelos índices. As funções existentes são alteradas, não duplicadas.
- Frontend: `balancete.tsx` reescrito como leitura + atalho de ajuste; `plano-de-contas.tsx` e `reclassificacoes.tsx` migrados de `chart_of_accounts`/`ledger_entries` para `ledger_accounts`/razão; `importar.tsx` sem o tipo balancete; `demonstrativos.tsx` e `dashboard.tsx` com drill-down para `/razao`.
- RLS no padrão atual: leitura para autenticado, escrita via `is_admin()`. Auditoria imutável. Período fechado bloqueia lançamento e ajuste.
- Nada de tabela ou função nova onde já existe equivalente; `ledger_entries` e `chart_of_accounts` não são apagados.
