# Balancete editável + Plano de contas

Duas telas da Fase 3: revisar os lançamentos importados e mapear as contas do G2 para as 8 naturezas contábeis.

## Situação atual

Os 9 lançamentos já importados estão sem conta vinculada (`account_id` nulo) e a tabela `chart_of_accounts` está vazia — nada foi criado durante a importação. Então, além das duas páginas, é preciso popular o plano de contas a partir das contas que aparecem nos lançamentos.

## 1. Vincular lançamentos ao plano de contas

- Ao processar um arquivo (e sob demanda, por um botão "Sincronizar contas" na tela de plano de contas), cada `source_account_name` distinto vira uma linha em `chart_of_accounts` (sem natureza, `is_confirmed = false`), e o lançamento passa a apontar para ela via `account_id`.
- Quando a conta já existir com natureza definida, o lançamento herda essa natureza automaticamente.

## 2. Página /plano-de-contas (Admin edita, todos veem)

- Lista de contas com código, descrição, natureza, situação (confirmada / pendente), nº de confirmações e quem atualizou por último.
- Busca por texto e filtros por natureza e por "pendentes de classificação".
- Admin escolhe a natureza numa lista com as 8 opções; ao salvar, a conta é marcada como confirmada, `times_confirmed` é incrementado e todos os lançamentos dessa conta nos períodos abertos passam a usar a nova natureza (sem sobrescrever ajustes manuais de natureza feitos no balancete).
- Usuário não-Admin vê a tela em modo leitura com aviso.
- Contador de contas pendentes em destaque no topo.

## 3. Página /balancete (todos autenticados editam)

- Tabela dos lançamentos do período selecionado: conta, natureza, valor bruto, valor revisado, valor aplicado, data e situação.
- Regra do valor: quando `reviewed_value` existe, ele prevalece sobre `raw_value` na coluna "valor aplicado" e em todos os totais.
- Edição inline do valor revisado (aceita formato brasileiro, sinal negativo e parênteses) e da natureza da linha; ao salvar, a linha recebe `is_manually_edited = true` e registra quem editou.
- Linhas editadas manualmente ficam destacadas (fundo âmbar + selo "Editado"), com opção de "Reverter" que limpa o valor revisado e volta ao dado bruto.
- Rodapé com totais por natureza e total geral, sempre pelo valor aplicado.
- Filtros por natureza, por arquivo de origem e por "somente editados"; busca por nome de conta.
- Período fechado deixa a tabela somente leitura.
- Toda edição fica registrada na trilha de auditoria (Atualizações).

## Detalhes técnicos

- Server functions em `src/lib/ledger.functions.ts`: `syncChartOfAccounts` (cria contas faltantes + vincula `account_id`), `updateLedgerEntry` (grava `reviewed_value`/`nature`, seta `is_manually_edited` e `updated_by`, chama `log_activity`), `revertLedgerEntry`, `upsertAccountNature` (Admin; valida via `is_admin()`, atualiza `chart_of_accounts` e propaga a natureza aos lançamentos).
- As policies atuais já cobrem o caso: `ledger_entries` UPDATE liberado a autenticados, `chart_of_accounts` INSERT/UPDATE restrito a Admin — a criação/vínculo automático de contas roda no servidor com a chave de serviço, disparada pela importação ou pelo botão de sincronizar.
- `plano-de-contas` continua sob o layout `_admin` para edição; a listagem em leitura fica acessível a todos movendo a rota para `/_authenticated/plano-de-contas` com gate de ação por papel (mesmo padrão já usado em Reclassificações).
- Labels das naturezas reaproveitam `NATURE_LABEL` de `src/lib/rotta.ts`; formatação monetária em pt-BR com um helper novo `formatCurrency`.

## Validação

Teste no navegador com o admin: sincronizar as contas, classificar "Receita de Vendas de Carne" como receita, conferir que a natureza aparece no balancete, editar o valor revisado de uma linha, ver o destaque de linha editada e os totais mudarem, e conferir no banco que `reviewed_value`, `nature` e `is_manually_edited` foram gravados.
