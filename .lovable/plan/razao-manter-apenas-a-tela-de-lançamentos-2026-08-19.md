# /razao: manter apenas a tela de Lançamentos

A página do razão passa a ter uma única tela — o gerenciador de Lançamentos. As abas Contas e extrato, Conferência, Pendências, Histórico e Vínculos saem da interface.

## O que muda

- `src/routes/_authenticated/razao.tsx` vira uma rota enxuta: cabeçalho da página (título, período selecionado) + `GerenciadorLancamentos`, sem barra de abas.
- Todo o código que só servia às abas removidas (consultas de extrato, conferência razão × balancete, relatório de pendências, vínculos de contas e histórico de auditoria, além dos estados, exportações e diálogos ligados a eles) é apagado do arquivo — hoje são ~900 das 1093 linhas.
- Imports e helpers que ficarem sem uso saem junto; o menu lateral continua com o item "Razão" apontando para a mesma rota.

## O que é preservado

- O gerenciador (`src/components/razao/GerenciadorLancamentos.tsx`) fica intacto: grade, busca, filtros, Novo / Editar / Cancelar reg. / Principal, exportação e visão do documento.
- As RPCs e server functions das telas removidas (`journal_account_statement`, `reconcile_journal_vs_trial_balance`, `journal_pending_report`, `set_account_link`, `link_reduced_accounts`, `journal_top_counterparts`) **permanecem no banco e em `src/lib/razao.functions.ts`**, porque os Agentes de IA e as rotinas de importação/recálculo as utilizam. Só a interface é desativada.
- Nenhuma migração de banco é necessária.

## Documentação

Atualizar `docs/PAGINAS.md` e `docs/ESTRUTURA.md` para descrever `/razao` como tela única de lançamentos, marcando as demais visões como desativadas na interface (funções mantidas para uso interno/agentes).

## Depois disso

Seguimos evoluindo somente dentro da tela de Lançamentos.
