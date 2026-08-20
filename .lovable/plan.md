# Relatórios por intervalo de datas (multi-período) + seletor de período único

Hoje os relatórios do razão consultam apenas o período ativo no cabeçalho: as RPCs `journal_report_analytic` e `trial_balance_report` filtram por um único `period_id`, então escolher 01/02/2026 a 30/06/2026 traz apenas o que existe no mês ativo. Também há dois campos de data separados (de / até) em Relatórios e na grade de Lançamentos.

## 1. Relatórios respeitam o intervalo escolhido

- As duas RPCs passam a aceitar uma lista de períodos (`_period_ids uuid[]`), mantendo `_period_id` por compatibilidade. Quando a lista vier preenchida, os movimentos são consolidados de todos esses períodos.
- Saldo anterior: continua sendo o saldo de abertura do período mais antigo do intervalo (`journal_account_openings`) somado a todos os movimentos anteriores à data inicial dentro dos períodos selecionados — assim o "saldo anterior" e o "saldo atual" ficam corretos numa faixa de vários meses.
- Ordenação e saldo corrido por conta passam a considerar a data do lançamento ao longo de todos os meses, não por mês.
- O cabeçalho do relatório (tela, PDF e Excel) passa a mostrar o intervalo real (ex.: "Data mov.: 01/02/2026 a 30/06/2026 · 5 períodos"), em vez do rótulo do mês ativo.

- Na tela de Relatórios, os períodos usados são deduzidos automaticamente do intervalo de datas escolhido (todos os períodos contábeis cujo mês de referência cai dentro de "de/até"), mais o período ativo. Um texto discreto abaixo do filtro informa quais períodos entram no relatório e avisa quando algum mês do intervalo ainda não tem período cadastrado.
- A grade de contas ("somente contas com movimento") também passa a considerar o intervalo, não só o mês ativo.

## 2. Seletor único de intervalo de datas

- Novo componente `DateRangeField`: um botão que abre um calendário (`Calendar mode="range"`) onde o usuário clica na data inicial e na final de uma vez, com atalhos rápidos — Mês atual, Mês anterior, Últimos 30 dias, Ano corrente, Período selecionado, Limpar.
- Substitui os pares "de/até" em:
  - Relatórios do razão (`RelatoriosRazao`);
  - filtro da grade de Lançamentos (`GerenciadorLancamentos`).
- O campo de data única do formulário manual de lançamento vira um date picker com calendário (mesmo visual), mantendo digitação livre.
- Padrão visual Synetica, com suporte a teclado e formato pt-BR (dd/mm/aaaa).

## Detalhes técnicos

- Migração SQL: `CREATE OR REPLACE` de `journal_report_analytic` e `trial_balance_report` com o parâmetro adicional `_period_ids uuid[] DEFAULT NULL`; nenhuma tabela nova. Mesmas regras atuais (`SECURITY DEFINER`, `search_path = public`, execute para `authenticated`/`service_role`); `db/schemas.sql` atualizado.
- `src/lib/razao.functions.ts`: `getLedgerReport`, `getTrialBalanceReport` e `exportLedgerReport` ganham `period_ids: string[]` opcional (Zod) repassado às RPCs; o cabeçalho de exportação usa o intervalo.
- `src/lib/razao-report.server.ts`: título/subtítulo do PDF e do Excel com o intervalo de datas.
- Novo `src/components/ui/date-range-field.tsx` (Popover + Calendar com `pointer-events-auto`), usado nos dois pontos acima; datas trafegam como `YYYY-MM-DD`, sem mudança nos contratos das RPCs.
- Documentação: `docs/FUNCTIONS.md` e `docs/DEPARA.md` atualizados com os novos parâmetros.
