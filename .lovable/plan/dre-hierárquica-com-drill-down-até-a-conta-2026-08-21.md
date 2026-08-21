# DRE hierárquica com drill-down até a conta

Em vez de criar uma visão nova dentro do painel, a própria DRE passa a ser navegável: cada grupo abre em sua hierarquia do plano de contas até a conta analítica, e clicar na conta abre o painel de lançamentos do razão já filtrado nela.

## Como fica

A DRE continua com as linhas de resultado (Receita bruta, Custos, Lucro bruto, Despesas, Resultado), mas as linhas de grupo passam a ser expansíveis:

```text
▾ Receita bruta                                    R$ 14.332.554,07
   ▾ 4.01  RECEITA OPERACIONAL BRUTA               R$ 14.332.554,07
        ▸ 4.01.01  VENDAS DE PRODUTOS              R$ 13.980.114,20
             041121  VENDAS DE CARNES              R$ 12.980.114,20  →
             041133  VENDAS DE MIUDOS              R$  1.000.000,00  →
        ▸ 4.01.02  OUTRAS RECEITAS                 R$    352.439,87
▸ (−) Custos                                       R$  9.104.220,10
```

- Cada nível vem do código hierárquico do plano de contas (o mesmo da árvore em /razao), somando os filhos até chegar na conta analítica.
- Clicar em uma **conta analítica** abre o painel lateral de lançamentos daquela conta (edição, reclassificação, ocultar do resultado, cancelar e comentários — como já funciona hoje).
- Clicar em um **grupo sintético** apenas expande/recolhe; o botão de seta ao lado abre o painel com todas as contas do grupo somadas.
- O estado de expansão é lembrado enquanto a tela estiver aberta e os totais respeitam os lançamentos ocultos (saem do resultado, aparecem no aviso do topo).

O mesmo comportamento vale para o Balanço Patrimonial, que já usa a mesma estrutura de linhas com códigos.

## Detalhes técnicos

- **Banco**: nova RPC `statement_line_tree(_period_id, _codes text[], _basis text)` — recebe as contas de uma linha do demonstrativo e devolve a árvore montada a partir de `ledger_accounts.hierarchical_code`, com `codigo`, `nome`, `nivel`, `parent`, `is_analytic` e `valor` por nó (soma dos filhos), usando `period_account_balances` conforme a base (`movimento` ou `saldo`). `security definer`, leitura para autenticados.
- **Backend**: server function `getStatementTree` em `src/lib/reports.functions.ts`, no padrão das demais.
- **Frontend**: `src/routes/_authenticated/demonstrativos.tsx` passa a renderizar cada linha com `codes` como nó expansível (componente `LinhaHierarquica`), carregando a árvore sob demanda ao expandir. O clique em conta analítica reaproveita o `PainelLancamentosLinha` existente, passando apenas aquela conta em `codes`. Nada muda na exportação PDF/Excel nem no cálculo dos demonstrativos.
- **Documentação**: `docs/FUNCTIONS.md`, `docs/PAGINAS.md` e `db/schemas.sql` atualizados com a nova RPC e a navegação hierárquica.
