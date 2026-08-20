# Auditoria e reorganização hierárquica do plano de contas

Transformar a aba "Plano de contas" do razão numa árvore contábil de verdade: sintéticas que só agregam, analíticas que recebem lançamento, movimentação (individual e em massa) entre grupos com renumeração hierárquica automática, e um analista de IA que sugere a reorganização — sempre com aprovação humana.

## Situação atual verificada

- `ledger_accounts` tem 1.316 contas: 1.175 analíticas e 141 sintéticas; todas com `hierarchical_code`, `level` e (exceto 3) `nature`.
- Nenhum lançamento cai hoje em conta sintética e nenhum lançamento aponta para conta inexistente — a base está sadia para impor a regra.
- 5 contas têm `parent_code` apontando para um pai que não existe (órfãs) e 554 analíticas nunca receberam lançamento — candidatas naturais da auditoria.
- A tela atual é uma grade plana com filtros, edição e reclassificação de natureza em lote; não há visão de árvore nem movimentação de ramo.

## 1. Regras estruturais (impostas no banco)

- Conta **sintética** nunca recebe lançamento: bloqueio na gravação de lançamento manual, na importação e no ajuste do agente, com mensagem clara ("Conta 3.02.01 é sintética — selecione uma conta analítica filha").
- Conta **analítica** não pode ter filhas; promover analítica a sintética só é permitido se ela não tiver lançamentos.
- Toda sintética com filhas mostra saldo agregado dos descendentes; nunca saldo próprio.
- Código reduzido (6 dígitos) **não muda** ao mover a conta — ele é a chave usada por todos os lançamentos. O que muda é o código hierárquico, o nível e o pai.

## 2. Tela "Plano de contas" — modo árvore

A aba ganha duas visões alternáveis, mantendo o padrão visual do gerenciador de lançamentos:

- **Árvore** (nova, padrão): grupos expansíveis por nível, com contador de filhas, saldo agregado do período e chip de natureza herdada. Busca destaca e abre o caminho até a conta.
- **Grade** (a atual): lista plana com filtros, para trabalho em massa.

Ações na árvore:

- **Mover conta/ramo**: selecionar uma ou várias contas e escolher o novo pai (busca por código ou descrição). O sistema recalcula código hierárquico, nível, pai e natureza pelo prefixo do destino, e mostra um preview "de → para" antes de confirmar. Mover uma sintética leva o ramo inteiro junto.
- **Promover/rebaixar**: analítica ↔ sintética, respeitando as regras acima.
- **Nova conta filha** direto do nó pai, já com código hierárquico sugerido (próximo livre no ramo).
- **Reordenar/renumerar ramo**: compactar a numeração das filhas de um pai (00001, 00002…) sem furos.
- **Painel de auditoria** no topo: contas órfãs, sintéticas sem filhas, analíticas sem lançamento, natureza incoerente com o prefixo hierárquico, códigos duplicados. Cada item leva à conta na árvore.

Edição restrita a Admin; usuário comum vê em leitura. Toda alteração grava em `ledger_account_audit` (de → para, ator, data), já existente.

## 3. Analista de IA do plano de contas

Botão **"Analisar com IA"** roda sobre as contas filtradas e devolve uma lista de propostas: mover conta X para o grupo Y, marcar como sintética, corrigir natureza, agrupar contas de cliente/fornecedor sob o ramo correto. Cada proposta traz justificativa e confiança.

O resultado aparece como uma fila de sugestões com checkbox: o Admin seleciona as que concorda e aplica em massa — a IA nunca grava sozinha, seguindo a regra do sistema. Sugestões rejeitadas ficam registradas para não voltarem iguais.

## 4. Efeito no resto do sistema

Com a hierarquia disciplinada, balancete, demonstrativos e indicadores passam a poder agregar por ramo (nível 1, 2, 3), e o balancete analítico ganha totalização por sintética.

## Detalhes técnicos

- Migração: índice único em `hierarchical_code`; coluna `is_analytic` continua sendo a fonte de verdade de sintética/analítica; trigger em `journal_legs` recusando conta sintética ou inativa; correção das 5 órfãs.
- Novas RPCs `SECURITY DEFINER` (Admin via `is_admin()`, todas gravando em `ledger_account_audit`):
  - `chart_accounts_tree(_period_id, _query, _nature, _only_pending)` — nós com filhos, nível, saldo agregado do período (via `period_account_balances`) e contagem de lançamentos.
  - `move_ledger_accounts(_ids uuid[], _new_parent_hier text)` — recalcula ramo (hierárquico, nível, pai, natureza pelo prefixo) em cascata, com `_dry_run boolean` para o preview.
  - `set_ledger_account_kind(_id, _is_analytic)` — promoção/rebaixamento com as validações.
  - `renumber_branch(_parent_hier text)` — compacta a numeração das filhas.
  - `chart_accounts_audit()` — devolve as inconsistências do painel.
- Server functions novas em `src/lib/razao.functions.ts`: `getChartTree`, `moveChartAccounts` (com preview), `setChartAccountKind`, `renumberBranch`, `getChartAudit`, `analyzeChartWithAi`, `applyChartSuggestions`.
- IA: `src/lib/chart-ai.server.ts` no padrão de `reclass.server.ts` (roteador `callAiJson`, schema estrito, lotes de ~40 contas), recebendo código reduzido, hierárquico, descrição, natureza e ramos disponíveis.
- Frontend: `src/components/razao/PlanoDeContasArvore.tsx` (árvore + ações + painel de auditoria) e `src/components/razao/MoverContasDialog.tsx` (busca do destino + preview de → para), com `PlanoDeContasRazao.tsx` mantido como visão em grade.

## Validação

Mover um grupo de contas de despesa para custo e conferir que o código hierárquico e a natureza mudaram e o reduzido não; tentar lançar numa sintética e ver o bloqueio; rodar a IA, aprovar parte das sugestões e conferir o registro na trilha de auditoria; abrir o balancete e ver os totais por ramo consistentes.
