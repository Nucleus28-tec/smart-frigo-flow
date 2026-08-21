# Ocultar conta = fora de todo o resultado

## O problema confirmado

Hoje, ocultar um lançamento marca a perna do razão como `oculto`, e o cálculo central (`period_account_balances`) já ignora esses lançamentos no movimento. Porém o **saldo de abertura da conta continua entrando** no cálculo: o saldo final é `abertura + débitos ativos − créditos ativos`.

Verificado em Janeiro/2026: 5 contas têm lançamentos ocultos e ainda assim carregam abertura no Balanço (ex.: `011133` com abertura de −112.162,37 e `011129` com −5.579,94). Ou seja, ao ocultar a conta inteira, ela some do movimento mas permanece no Balanço, no Fluxo de Caixa e nos indicadores pelo saldo de abertura.

Também não existe hoje nenhuma marca de "conta oculta no período": a ocultação só existe no nível de lançamento, então uma conta sem nenhum lançamento não pode ser removida do resultado.

## O que será feito

1. **Marcar a conta como oculta no período**, e não só seus lançamentos. `set_account_excluded` passa a registrar a conta como excluída do período (motivo, autor e data), além de ocultar as pernas do razão como já faz.

2. **Zerar a abertura das contas ocultas** no cálculo central `period_account_balances`. Conta oculta no período → abertura, movimento e saldo final igual a zero, e a conta deixa de ser retornada. Como DRE, Balanço, Fluxo de Caixa, indicadores do dashboard e a árvore de drill-down bebem todos dessa mesma função, a exclusão passa a valer em todos de uma vez.

3. **Coerência com contas desativadas**: contas marcadas como inativas no plano hierárquico (`is_active = false`) também deixam de compor o resultado, seguindo a mesma regra.

4. **Reexibir volta tudo**: desfazer a ocultação restaura abertura, movimento e saldo, e limpa o motivo registrado.

5. **Recálculo automático**: ao ocultar/reexibir, os indicadores já são recalculados; a geração dos demonstrativos passa a ser disparada em seguida também no fluxo de conta (hoje ocorre apenas em parte dos caminhos da tela), para que os totais na tela reflitam a mudança sem clique extra.

6. **Transparência na tela `/demonstrativos`**: o resumo de ocultos passa a contar contas ocultas e o valor de abertura retirado, não apenas os lançamentos, e cada linha oculta na árvore mostra o motivo registrado ao passar o mouse.

## Detalhes técnicos

- Migração: nova coluna de exclusão em `journal_account_openings` (ou tabela de exclusão por período quando a conta não tem abertura) + índice por `period_id`.
- `period_account_balances`: filtro adicional eliminando contas excluídas do período e contas com `ledger_accounts.is_active = false`; o `where` final continua descartando linhas totalmente zeradas.
- `set_account_excluded`: grava/limpa a marca da conta, mantém a auditoria em `ledger_account_audit` e o `log_activity`, e continua chamando `recalculate_period_indicators_internal`.
- `period_hidden_summary`: retorna também `accounts` e `opening_total`.
- Frontend: `demonstrativos.tsx` e `LinhaHierarquica.tsx` — invalidação de queries e chamada de `generateStatements` após ocultar/reexibir conta; textos do resumo de ocultos.
- Sem alteração nas regras de período fechado: a ação continua bloqueada em períodos fechados.
