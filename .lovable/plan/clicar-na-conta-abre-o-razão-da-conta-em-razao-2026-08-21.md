# Clicar na conta abre o razão da conta em /razao

Hoje, na aba **Plano de contas › Árvore hierárquica**, clicar numa conta apenas seleciona a linha. A proposta é reaproveitar o painel lateral já existente em /demonstrativos para que o clique na conta abra, ao lado da árvore, os lançamentos daquela conta com as ações de editar, mover (reclassificar) e ocultar.

## Comportamento

1. **Clique na conta** (analítica ou sintética) abre o painel lateral à direita com:
   - Cabeçalho: código reduzido / hierárquico, nome, natureza e saldo do período.
   - Lista dos lançamentos do período para aquela conta (e, se sintética, das contas do ramo), com busca, alternância "mostrar ocultos" e largura ajustável — o mesmo painel usado em Demonstrativos.
   - O checkbox de seleção em massa continua funcionando separadamente do clique (o clique na linha abre o painel; o checkbox segue só marcando).

2. **Editar**: edição em linha do lançamento (data, documento, valor, conta débito/crédito, histórico), cancelar lançamento e comentários — já disponíveis no painel.

3. **Mover / reclassificar a conta**: botão no cabeçalho do painel abre o mesmo diálogo de reclassificação usado em Demonstrativos (busca do grupo de destino, prévia da nova posição e do impacto de sinal). Ao confirmar, a árvore, os indicadores e os demonstrativos são recalculados e recarregados.

4. **Ocultar / reexibir a conta**: botão no cabeçalho do painel oculta todos os lançamentos da conta no período, pedindo um motivo curto, e o mesmo botão reexibe quando a conta já está oculta. Conta oculta aparece esmaecida/riscada na árvore.

5. Ações de escrita continuam restritas a Admin e a períodos não fechados; para os demais, o painel abre em modo leitura.

## Detalhes técnicos

- `src/components/razao/PlanoDeContasArvore.tsx`: novo estado `contaAberta` (código reduzido, nome, códigos do ramo); handler de clique na linha; renderiza `PainelLancamentosLinha` com `drill = { label, codes, from, to, kind: "razao" }` montado a partir do nó (para sintética, coleta os `reduced_code` das folhas descendentes). Layout passa a ser flex com o painel ocupando a direita.
- `src/components/razao/PainelLancamentosLinha.tsx`: aceita props opcionais de conta (`account`) para renderizar no cabeçalho os botões "Reclassificar conta" e "Ocultar/Reexibir do resultado". Nenhuma mudança no comportamento atual quando essas props não são passadas (Demonstrativos segue igual).
- Reaproveita `ReclassificarContaDialog`, `moveChartAccounts`, `setAccountExcluded`, `listHiddenAccounts` de `src/lib/razao.functions.ts`. Sem migração de banco.
- Invalida `chart_tree`, `period_summary`, `statements` e `line_legs` após cada ação.
- Documentação: `docs/PAGINAS.md` atualizado com o novo comportamento da aba Plano de contas.
