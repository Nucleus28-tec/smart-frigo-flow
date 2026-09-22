# Confirmação: sim, há dois circuitos convivendo

Conferi no banco e no código. A afirmação está correta: o sistema ainda carrega o circuito antigo (balancete importado) junto do circuito oficial (razão contábil).

## O que encontrei

Circuito oficial (razão) — em uso e com dados:
- Lançamentos do razão: 79.464 linhas; plano de contas do razão: 1.335 contas; 9 arquivos importados.
- Telas que já leem só o razão: Dashboard, Demonstrativos, Balancete (derivado), Razão Contábil, Períodos, Importar.

Circuito antigo — ainda existe na tela, mas sem dados:
- Tabelas antigas: plano de contas legado com 7.129 contas; lançamentos legados: 0 linhas; balancete importado: 0 linhas; sugestões de reclassificação: 0.
- Telas que ainda leem o legado: **Plano de Contas**, **Reclassificações**, **Atualizações**.
- Em Importar, o tipo "balancete" continua na lista, já rotulado como "em descontinuação".
- Rotinas de bastidor (sugestão de reclassificação, apontamentos e uma ferramenta dos agentes de IA) ainda consultam as tabelas legadas — por isso hoje elas não retornam nada.

Resultado prático: quem abre Plano de Contas ou Reclassificações vê telas vazias e desconectadas do razão, enquanto a mesma informação viva está dentro de Razão Contábil.

## Proposta de unificação

1. **Plano de Contas**: a rota passa a mostrar o plano do razão (o mesmo conteúdo da aba de plano de contas dentro de Razão Contábil), com árvore hierárquica, vínculos pendentes e natureza. Fim da leitura do plano legado.
2. **Reclassificações**: passa a operar sobre as contas do razão, aproveitando as sugestões de IA do plano do razão que já existem, com aprovação do Admin e trilha de auditoria.
3. **Atualizações**: passa a listar as alterações do razão (importações, ajustes, ocultações, cancelamentos) em vez do histórico de recálculo legado.
4. **Importar**: remove o tipo "balancete" da seleção e o tratamento associado; sobra razão e documentos fiscais.
5. **Apontamentos e agentes de IA**: reapontados para o razão, para voltarem a produzir resultado.
6. **Menu**: itens redundantes consolidados, evitando duas portas para a mesma informação.
7. **Banco**: as tabelas legadas não são apagadas — ficam como histórico, sem nenhuma tela lendo delas. Documentação (`docs/PAGINAS.md`, `docs/PROCESSO.md`, `docs/ARQUITETURA.md`) atualizada com o circuito único.

## Detalhes técnicos

- Telas: `plano-de-contas.tsx` migra para `chart_accounts_tree` / `chart_accounts_grid` e `set_account_link` / `upsert_ledger_account`; `reclassificacoes.tsx` migra de `reclassification_suggestions` + `chart_of_accounts` para `chart_ai_suggestions` + `ledger_accounts`; `atualizacoes.tsx` migra de `recalculation_logs` + `ledger_entries` para `ledger_account_audit` + `activity_log`.
- Server functions: `reclass.functions.ts`, `audit.functions.ts` e `agents/tools.server.ts` deixam de consultar `ledger_entries` / `chart_of_accounts` e passam a usar `journal_legs`, `period_account_balances` e `ledger_accounts`.
- `importar.tsx`: remover `balancete` de `FILE_TYPES`, o ramo de parsing do espelho e os avisos correspondentes.
- Nenhuma migração destrutiva: `chart_of_accounts`, `ledger_entries`, `trial_balance_lines` e `reclassification_suggestions` permanecem no banco.

## Ordem sugerida

Fase A: Plano de Contas + Importar (maior impacto imediato).
Fase B: Reclassificações + Apontamentos + agentes.
Fase C: Atualizações + documentação.
