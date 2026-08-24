# Saldo inicial e final no painel de lançamentos

O painel lateral do razão (aberto ao clicar numa conta) hoje mostra apenas quantidade de lançamentos, soma considerada no resultado e ocultos. Vamos acrescentar o **saldo inicial** e o **saldo final** das contas abertas no painel, respeitando o intervalo de datas em que o usuário está trabalhando.

## Comportamento

- Nova linha no cabeçalho do painel:
  `Saldo inicial 12.345,67 C · movimento do período · Saldo final 15.000,00 C`
- **Saldo inicial** = saldo de abertura da(s) conta(s) no período + movimento anterior à data inicial do filtro. Se não houver filtro de data, é o saldo de abertura do período.
- **Saldo final** = saldo inicial + débitos − créditos dos lançamentos do intervalo filtrado.
- Lançamentos ocultos não entram no cálculo do saldo final (mesma regra do resultado); quando houver ocultos, exibimos entre parênteses o saldo final "com ocultos" para comparação.
- A busca por texto não altera os saldos (ela filtra a lista, não o saldo da conta); o intervalo de datas sim.
- Para grupos sintéticos (várias contas), os saldos são a soma das contas do ramo.
- Valores exibidos com o sufixo D/C já usado nos relatórios do razão.

## Detalhes técnicos

- Migração: `CREATE OR REPLACE FUNCTION public.journal_line_legs(...)` mantendo a assinatura atual e adicionando ao JSON de retorno `saldo_inicial`, `saldo_final` e `saldo_final_com_ocultos`.
  - saldo de abertura: soma de `journal_account_openings.opening_balance` para os `_codes` do período.
  - movimento anterior: `sum(debit - credit)` de `journal_legs` do período com `account_reduced_code = any(_codes)`, `status in ('ativo','oculto')` e `entry_date < _from`.
  - movimento do intervalo: idem com `entry_date` entre `_from` e `_to`, separando `status='ativo'` (saldo final) de todos (saldo final com ocultos).
  - Cálculo por `account_reduced_code` (perna da conta), não pela contrapartida, para não duplicar valores.
- `src/lib/razao.functions.ts`: nenhuma mudança de contrato necessária (o retorno é `JsonObject`).
- `src/components/razao/PainelLancamentosLinha.tsx`: ler os novos campos de `legsQuery.data` e renderizar a linha de saldos no cabeçalho, usando `balanceLabel` de `src/lib/razao-report-types.ts`.
- Sem mudanças em outras telas: o painel é o mesmo usado em Demonstrativos, que passa a exibir a informação também.
- `docs/PAGINAS.md` atualizado com a nova informação do painel.
