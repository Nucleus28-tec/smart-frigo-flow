# Grade de lançamentos: ordenar, ajustar colunas, linhas compactas e cores de partida/contrapartida

Tudo acontece na tela `/razao` (aba única de Lançamentos). Nenhuma regra contábil muda.

## 1. Ordenação pelo cabeçalho

Clicar no título da coluna ordena a grade; clicar de novo inverte; uma seta indica a direção.
Colunas ordenáveis: Doc, Conta débito, Conta crédito, Data, Valor e Histórico.

A ordenação é feita no banco (não só na página visível), para que ordenar com 4.835
lançamentos e paginação de 50 traga de fato o maior/menor de todo o período.
Padrão inicial continua: data mais recente e documento decrescente.

## 2. Largura das colunas ajustável

Cada divisória do cabeçalho vira uma alça: arrastar aumenta ou diminui a largura da coluna.
As larguras escolhidas ficam salvas no navegador, então a tela reabre do jeito que o usuário
deixou. Duplo clique na alça devolve a largura padrão da coluna.

## 3. Linhas mais baixas (mais informação na tela)

Densidade padrão passa a ser compacta: célula com 6px de altura vertical em vez de 12px,
texto 13px, cabeçalho em caixa alta 11px — cabe cerca de 40% mais linhas sem rolagem.
Um botão "Densidade" no topo alterna entre **Compacto** e **Confortável**, também memorizado
no navegador. Nada de texto quebrado: cada célula continua com corte por reticências.

## 4. Cores de partida e contrapartida

Hoje cada movimento é uma linha com a conta de débito e a conta de crédito lado a lado.
A leitura ganha código visual:

- **Conta débito**: chip com fundo âmbar suave e o código reduzido em fonte monoespaçada.
- **Conta crédito**: chip com fundo verde-marca suave, mesmo formato.
- Entre as duas colunas, uma seta discreta indicando o sentido débito → crédito.
- A linha selecionada recebe faixa verde à esquerda (mesmo padrão `glow-row` do sistema).
- Linha cancelada permanece cinza e riscada, com os chips esmaecidos.

Quando um documento tem várias pernas (lançamento múltiplo), as linhas do mesmo documento
recebem uma barra vertical fina de mesma cor à esquerda, agrupando visualmente o movimento.

Todas as cores saem dos tokens existentes (`brand-soft`, `warning`, `muted`) — nenhuma cor
solta é adicionada, e o comportamento em modo noite acompanha.

## Detalhes técnicos

- Migração: nova versão de `journal_entries_grid` com os parâmetros `_sort`
  (`doc | debito | credito | data | valor | historico`) e `_dir` (`asc | desc`), aplicando
  `order by` correspondente antes do `limit/offset`. Assinatura antiga substituída por
  `create or replace` com defaults, sem quebrar chamadas existentes.
- `listJournalEntries` em `src/lib/razao.functions.ts` ganha `sort` e `dir` no validador Zod.
- `src/components/razao/GerenciadorLancamentos.tsx`: estados `sort`/`dir` (entram na
  queryKey), `density` e `colWidths` persistidos em `localStorage`
  (`rotta-razao-grid`); cabeçalho com botão de ordenação + alça de redimensionamento
  (`onPointerDown` → `pointermove`), `<colgroup>` com as larguras e `table-layout: fixed`.
- Chips de conta e utilitários de densidade como classes locais do componente, usando
  tokens já definidos em `src/styles.css`.
- Documentação: atualizar `docs/PAGINAS.md` (novos controles da grade) e `docs/FUNCTIONS.md`
  (parâmetros de ordenação da RPC).
