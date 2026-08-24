# Reinício limpo das operações e alinhamento das telas

## O que eu verifiquei no banco agora

- `imported_files` = 0 (você realmente apagou os arquivos de todos os períodos).
- Mas sobrou movimento antigo: `journal_account_openings` = 8.465 linhas (1.175 em Jan–Jun, 897 em Jul, 518 em Ago), `financial_statements` = 24 (3 por período), `dashboard_indicators` = 160, `period_excluded_accounts` = 15, `journal_legs` = 10 em Janeiro, `ledger_accounts` = 1.319.
- Por isso as telas "não atualizam": o Dashboard de Janeiro ainda calcula Ativo total 13.799.534,98, caixa 1.302.102,10 e liquidez 1,88 — números derivados dos saldos de abertura que ficaram para trás.
- Causa confirmada na função `delete_imported_file`: ela apaga `journal_legs`, `ledger_entries` e `trial_balance_lines` do arquivo, mas **não** apaga as aberturas do período, nem demonstrativos, nem indicadores. Só `purge_period_journal` limpa aberturas — e essa ação não é usada ao excluir arquivo.
- Todos os 8 períodos estão com `chain_stale = true`, ou seja, o próprio banco já sinaliza saldos pendentes de recálculo.

## O que vou fazer

### 1. Reinício de verdade (banco + tela)

- `delete_imported_file` passa a limpar também, quando o período fica sem nenhum arquivo de razão: aberturas do período, demonstrativos gerados, indicadores, e a marcar a cadeia como pendente.
- Nova ação **"Zerar período"** em `/periodos` e em `/importar` (Admin), com confirmação, em dois níveis:
  - **Movimento**: razão, aberturas, balancete derivado, demonstrativos, indicadores, contas ocultas do período.
  - **Movimento + plano de contas** (opcional): também remove contas do razão sem uso, para recomeçar o cadastro do zero.
- Depois de zerar, recálculo automático da cadeia (`rebuild_ledger_chain`) e limpeza do `chain_stale`.
- Vou executar essa limpeza uma vez nos 8 períodos, deixando a base pronta para a nova importação.

### 2. Telas refletindo o estado real

- **Dashboard**: se o período não tem razão importado, não mostra números antigos — mostra o estado vazio com atalho para Importar. Aviso quando os indicadores forem mais antigos que a última alteração do razão.
- **Demonstrativos**: mesmo tratamento; DRE/Balanço/Fluxo salvos deixam de aparecer quando não há movimento, e passa a exibir a data de geração + botão "recalcular agora" quando o período está com cadeia pendente.
- **Balancete**: estado vazio consistente com o razão (hoje pode desenhar grupos a partir de aberturas órfãs).
- **Razão** e **Plano de contas**: mensagem única de "nenhum razão importado neste período", com o mesmo atalho.
- **Apontamentos / Atualizações / Reclassificações**: estados vazios revisados para o cenário de base zerada.

### 3. Auditoria das melhorias já feitas no banco que a UI ainda não usa

Views novas sem nenhum consumo no frontend: `v_ledger_reconciliation`, `v_chain_continuity`, `v_anchor_sign_check` (só `v_ledger_import_gaps` é usada, na finalização da importação).

- Em `/importar`, no Relatório de Inconformidades: bloco de **conferência pós-importação** com reconciliação razão × balancete, continuidade da cadeia entre meses e checagem de sinal das âncoras — verde/amarelo/vermelho por período.
- Em `/periodos`: coluna de situação da cadeia (`chain_stale`, último recálculo) e botão de recalcular por período.
- No razão: usar `opening_source` (origem do saldo anterior: arquivo × cadeia) e `running_balance_file` (saldo do arquivo × saldo recalculado) como sinalização de divergência na grade e nos relatórios.

### 4. Fluxo operacional de partida

Painel curto no topo de `/importar` com os passos na ordem certa: selecionar período → importar razão → conferir inconformidades → casar plano de contas → recalcular → gerar demonstrativos → fechar. Cada passo com indicador de concluído/pendente lido do banco.

## Detalhes técnicos

- Migração: ajuste de `delete_imported_file` e nova RPC `reset_period(_period_id, _include_accounts boolean)` (Admin, bloqueada em período fechado/com fechamento ativo), com log em `activity_log`.
- `src/lib/imports.functions.ts` / `razao.functions.ts`: server functions `resetPeriod`, `periodHealth` (reconciliação + continuidade + âncoras), com `requireSupabaseAuth`.
- Telas: `dashboard.tsx`, `demonstrativos.tsx`, `balancete.tsx`, `razao.tsx`, `periodos.tsx`, `importar.tsx`, `apontamentos.tsx`, `atualizacoes.tsx`, `reclassificacoes.tsx` + `RelatorioInconformidades.tsx`.
- Invalidação de cache padronizada após reset/recálculo: `financial_statements`, `indicators`, `journal_grid`, `conferencia_balanco`, `accounting_periods`.
- Documentação: `docs/FUNCTIONS.md`, `docs/PAGINAS.md`, `docs/PROCESSO.md` e `db/schemas.sql`.

## Validação

Depois do reset, mostro os 8 períodos zerados (dashboard, demonstrativos e balancete sem números residuais) e faço uma importação de razão ponta a ponta em um mês para conferir o novo painel de conferência.
