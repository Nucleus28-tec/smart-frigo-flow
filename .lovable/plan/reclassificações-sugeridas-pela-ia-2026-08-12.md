# Reclassificações sugeridas pela IA

Objetivo: gerar sugestões de natureza contábil para contas ainda não confirmadas, exibi-las em fila e permitir que apenas o Admin aprove ou rejeite — nada é aplicado silenciosamente, e cada decisão alimenta o padrão aprendido da empresa.

## Como vai funcionar

1. Na página **Reclassificações**, o Admin clica em "Gerar sugestões" para o período selecionado (também roda automaticamente ao final do processamento de um arquivo importado).
2. O sistema junta as contas do período que ainda não têm natureza confirmada, envia junto o padrão já aprovado (contas confirmadas) como referência e pede à IA a natureza sugerida, com justificativa e um índice de confiança.
3. As sugestões entram na fila com status "pendente", mostrando: conta, natureza atual, natureza sugerida, confiança e justificativa.
4. O Admin aprova ou rejeita — individualmente ou em lote (selecionar várias).
   - **Aprovar**: grava a natureza no plano de contas, marca a conta como confirmada, incrementa o contador de confirmações e aplica a natureza aos lançamentos daquela conta no período (respeitando lançamentos editados manualmente).
   - **Rejeitar**: nada é aplicado; a sugestão fica registrada como rejeitada para servir de contra-exemplo em sugestões futuras.
5. Usuários não-Admin veem a fila em modo leitura, sem botões de decisão.

## Detalhes técnicos

- **Banco** (migração): função `public.apply_reclassification_decision(_suggestion_id uuid, _decision text)` SECURITY DEFINER, com checagem de `is_admin()`, que numa única transação atualiza `reclassification_suggestions` (status, `decided_by`, `decided_at`), e — quando aprovada — atualiza `chart_of_accounts` (`nature`, `is_confirmed=true`, `times_confirmed = times_confirmed + 1`, `updated_by`) e `ledger_entries.nature` das linhas da conta no período que não estão com `is_manually_edited`. Também `public.confirmed_account_patterns()` opcional para leitura do padrão aprendido. Fazer no banco evita o limite de sub-requisições do runtime serverless, como já ocorreu na sincronização do plano de contas.
- **Servidor**: `src/lib/reclass.server.ts` monta o prompt (contas pendentes + amostra de contas confirmadas como padrão), chama a IA em lotes e normaliza a resposta para as 8 naturezas válidas, descartando valores fora do enum. `src/lib/reclass.functions.ts` expõe `suggestReclassifications` (Admin, grava sugestões pendentes evitando duplicar sugestão pendente da mesma conta) e `applyReclassificationDecision` (chama o RPC e registra em `log_activity`).
- **IA**: mantém o padrão já adotado no projeto — Lovable AI Gateway com o modelo já usado na leitura de arquivos, em vez de chave Anthropic direta. Se preferir Claude direto via chave própria, é uma troca pontual no cliente de IA.
- **Server Functions em vez de Edge Functions**: mesma decisão já aplicada em `parse-imported-file`/`manage-user` neste stack TanStack Start.
- **UI**: `src/routes/_authenticated/reclassificacoes.tsx` reescrita com filtro por status (pendentes/aprovadas/rejeitadas), seleção múltipla, badges de confiança e ações gated por `is_admin()` no frontend e nas policies.
- **Validação**: teste end-to-end com Playwright — gerar sugestões no período Janeiro/2026, aprovar uma e conferir no banco que `chart_of_accounts.is_confirmed`, `times_confirmed` e `ledger_entries.nature` foram atualizados.
