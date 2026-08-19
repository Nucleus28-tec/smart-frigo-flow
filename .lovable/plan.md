# Mostrar o nome da conta na coluna de crédito

## O que acontece hoje

A coluna de crédito já foi preparada para exibir "código + nome", mas na prática só aparece o código (ex.: `23511`). Conferi os dados: o código da conta de débito é gravado com 6 dígitos (`000119`) e o código da contrapartida (crédito) é gravado sem zeros à esquerda (`23511`, `21315`). O plano de contas (`ledger_accounts`) usa sempre 6 dígitos.

Resultado: das 9.700 linhas com contrapartida, **nenhuma** encontra a conta correspondente no plano de contas — por isso o nome não aparece. Testei o mesmo cruzamento completando o código com zeros à esquerda e ele casa em 100% das linhas.

## Correção

1. **Padronizar os códigos de contrapartida já gravados** para o formato de 6 dígitos (`23511` → `023511`), igual ao que já é feito no código de débito. É uma atualização única nos lançamentos existentes.
2. **Padronizar na importação**, para que novos arquivos do razão já entrem no formato correto e o problema não volte.
3. **Blindar as consultas**: ao buscar o nome da conta, comparar sempre o código normalizado, para linhas antigas ou vindas de outra origem continuarem resolvendo o nome.

Depois disso, a coluna de crédito passa a mostrar o chip verde com o código seguido do nome da conta (ex.: `023511 — DUPLICATAS A PAGAR`), com o de-para completo no tooltip — exatamente como já acontece na coluna de débito.

## Onde mais isso aparece

A mesma normalização corrige o nome da contrapartida em: busca livre de lançamentos, visão do documento, extrato por conta, principais contrapartidas e nos relatórios (Razão Analítico em tela, PDF e Excel).

## Detalhes técnicos

- Migração: `UPDATE public.journal_legs SET counterpart_reduced_code = lpad(counterpart_reduced_code, 6, '0')` para códigos numéricos com menos de 6 caracteres; mesmo tratamento em `journal_account_openings` se houver divergência.
- `import_journal_legs` e `upsert_manual_journal_entry` passam a aplicar `lpad(...,6,'0')` em `account_reduced_code` e `counterpart_reduced_code`.
- Joins com `ledger_accounts` em `journal_entries_grid`, `journal_search`, `journal_document`, `journal_account_statement`, `journal_top_counterparts` e `journal_report_analytic` passam a comparar `lpad(codigo,6,'0')`.
- Nenhuma alteração de layout: `AccountChip` em `src/components/razao/GerenciadorLancamentos.tsx` já renderiza o nome quando ele vem preenchido.
- `db/schemas.sql` atualizado com as funções revisadas.
