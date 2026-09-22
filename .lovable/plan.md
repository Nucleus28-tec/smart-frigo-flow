# Confirmação: sim, há dois circuitos convivendo — e unificação no razão

Conferi no banco e no código. A afirmação está correta: o sistema ainda carrega o circuito antigo (balancete importado) junto do circuito oficial (razão contábil).

## O que encontrei

Circuito oficial (razão) — em uso e com dados:
- 79.464 lançamentos do razão, 1.335 contas no plano do razão, 9 arquivos importados.
- Telas que já leem só o razão: Dashboard, Demonstrativos, Balancete (derivado), Razão Contábil, Períodos, Importar.

Circuito antigo — ainda visível, mas sem movimento:
- Plano de contas legado com 7.129 contas; lançamentos legados: 0; balancete importado: 0; sugestões de reclassificação: 0.
- Telas ainda no legado: **Plano de Contas**, **Reclassificações**, **Atualizações**.
- Em Importar o tipo "balancete" continua na lista (já marcado como em descontinuação).
- Rotinas de bastidor (sugestão de reclassificação, apontamentos e uma ferramenta dos agentes de IA) ainda consultam as tabelas antigas — por isso não retornam nada.

## Regra desta unificação

As 7.129 contas antigas **não** serão unificadas, migradas ou mescladas ao plano do razão. O razão está correto e atualizado e passa a ser a única fonte. O legado só é desligado da interface e deixa de ser consultado por qualquer rotina.

## O que vou fazer

1. **Plano de Contas**: a rota passa a mostrar o plano do razão (mesmo conteúdo já existente dentro de Razão Contábil): árvore hierárquica, vínculos pendentes, natureza, ativar/desativar. Nenhuma conta do legado entra.
2. **Reclassificações**: passa a operar sobre as contas do razão e sobre as sugestões de IA do plano do razão, com aprovação do Admin e trilha de auditoria.
3. **Atualizações**: passa a listar o histórico do razão (importações, ajustes, ocultações, cancelamentos, mudanças de vínculo) em vez do log de recálculo legado.
4. **Apontamentos e agentes de IA**: reapontados para o razão, para voltarem a produzir resultado.
5. **Importar**: o tipo "balancete" sai da tela e do processamento; sobram razão e documentos fiscais.
6. **Banco**: tabelas legadas ficam intactas como histórico, sem nenhuma leitura pelo sistema. Nada é apagado e nada é copiado para o razão.

## Nova organização do menu lateral

Hoje são 12 itens, com portas duplicadas para a mesma informação. Proposta, em grupos:

```text
OPERAÇÃO
  Dashboard
  Períodos
  Importar

CONTABILIDADE
  Razão Contábil        (lançamentos, plano de contas, árvore, fechamento, relatórios)
  Balancete
  Demonstrativos

REVISÃO
  Reclassificações      (contas do razão + sugestões de IA)
  Apontamentos
  Atualizações
  IA Agentes

ADMIN
  Usuários
```

Mudanças concretas: **Plano de Contas** deixa de ser item próprio (já vive como aba dentro de Razão Contábil, evitando duas portas para o mesmo conteúdo); os demais itens ganham agrupamento com título, mantendo o visual Synetica. Se preferir manter Plano de Contas como item separado, ele passa a apontar direto para a aba do razão.

## Detalhes técnicos

- `plano-de-contas.tsx`: reaproveita `PlanoDeContasRazao` / `PlanoDeContasArvore` (RPCs `chart_accounts_tree`, `chart_accounts_grid`, `set_account_link`, `upsert_ledger_account`) ou é removido em favor da aba do razão.
- `reclassificacoes.tsx`: de `reclassification_suggestions` + `chart_of_accounts` para `chart_ai_suggestions` + `ledger_accounts`.
- `atualizacoes.tsx`: de `recalculation_logs` + `ledger_entries` para `ledger_account_audit` + `activity_log`.
- `reclass.functions.ts`, `reclass.server.ts`, `audit.functions.ts`, `agents/tools.server.ts`: trocam `ledger_entries` / `chart_of_accounts` por `journal_legs`, `period_account_balances` e `ledger_accounts`.
- `importar.tsx`: remove `balancete` de `FILE_TYPES`, o ramo de parsing do espelho e os avisos relacionados.
- `AppShell.tsx`: `NAV` vira lista agrupada (`group` + `adminOnly`), com cabeçalho de seção na sidebar.
- Sem migração de dados. Nenhum `INSERT` do legado para o razão.
- Documentação atualizada: `docs/PAGINAS.md`, `docs/PROCESSO.md`, `docs/ARQUITETURA.md`.

## Ordem de execução

Fase A: menu reorganizado + Plano de Contas no razão + Importar sem balancete.
Fase B: Reclassificações + Apontamentos + agentes no razão.
Fase C: Atualizações + documentação.
