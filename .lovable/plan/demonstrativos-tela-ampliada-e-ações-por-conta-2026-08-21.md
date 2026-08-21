# Demonstrativos: tela ampliada e ações por conta

Três melhorias na tela /demonstrativos, mantendo o cálculo atual intacto.

## 1. Expandir DRE, Balanço e Fluxo de Caixa

Cada card ganha um botão de expandir no cabeçalho. Ao clicar, o demonstrativo ocupa a tela inteira (modo foco), com a hierarquia em fonte e espaçamento maiores e o painel lateral de lançamentos continuando a abrir ao lado. Botão de fechar (ou tecla Esc) volta para a grade de três colunas. O estado de expansão dos grupos é preservado ao entrar e sair do modo ampliado.

## 2. Reclassificar a conta direto do demonstrativo

Na árvore de cada linha, o menu de ações da conta (analítica ou grupo) ganha "Reclassificar conta". Abre o mesmo diálogo já usado em /razao (seleção do grupo de destino com busca por código/nome e prévia da nova posição), reaproveitando a movimentação hierárquica existente. Exemplo: mover 041138 JUROS ATIVOS de "Receitas financeiras" para "Receitas". Depois de confirmar, a conta passa a ter o código hierárquico do novo grupo, os demonstrativos são regerados e a tela recarrega os valores.

Como hoje, a movimentação manual fica protegida: importações futuras do G2 não desfazem o novo posicionamento.

## 3. Ocultar a conta inteira do resultado

No mesmo menu, "Ocultar do resultado" oculta de uma vez todos os lançamentos daquela conta no período (e reexibe pelo mesmo caminho). A conta oculta aparece riscada/esmaecida na árvore, e o aviso do topo (quantidade e total de lançamentos ocultos) passa a somar esses lançamentos. Ao ocultar, pede-se um motivo curto, igual ao que já existe por lançamento.

Ação restrita a Admin, como as demais edições.

## Detalhes técnicos

- **Banco**: nova RPC `set_account_excluded(_period_id uuid, _reduced_codes text[], _excluded boolean, _motivo text)`, `security definer`, que aplica a mesma lógica de `set_journal_leg_excluded` em lote para todas as pernas não canceladas das contas informadas no período, registra em `activity_log` e recalcula indicadores. `statement_line_tree` passa a devolver também `hidden_count` por nó para a marcação visual.
- **Backend**: `setAccountExcluded` em `src/lib/razao.functions.ts`, no padrão das demais server functions autenticadas.
- **Frontend**:
  - `src/routes/_authenticated/demonstrativos.tsx`: estado `expandido` por `statement_type`; quando ativo, renderiza apenas aquele card em largura total.
  - `src/components/demonstrativos/LinhaHierarquica.tsx`: menu de ações por nó (abrir lançamentos, reclassificar, ocultar/reexibir) e estilo de conta oculta.
  - Reaproveita `GroupSelect`/diálogo de movimentação de `src/components/razao` e `moveChartAccounts`.
- **Documentação**: `docs/FUNCTIONS.md`, `docs/PAGINAS.md` e `db/schemas.sql` atualizados com a nova RPC e as ações da tela.
