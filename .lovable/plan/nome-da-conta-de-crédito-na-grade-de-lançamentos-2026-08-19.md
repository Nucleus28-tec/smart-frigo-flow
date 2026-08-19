# Nome da conta de crédito na grade de lançamentos

## Objetivo
Na grade de lançamentos (`/razao`), a coluna "Conta crédito" deve exibir o **nome da conta** ao lado do chip verde que já mostra o código reduzido. Hoje, quando a conta não está em `ledger_accounts`, o nome fica igual ao código (ex.: "32427").

## Alterações

### 1. Resolver nome da conta de crédito na RPC
Atualizar `public.journal_entries_grid` para buscar o nome da conta de crédito (`counterpart_reduced_code`) em cascata:
1. `ledger_accounts.name`
2. `journal_account_openings.account_name` (onde o código reduzido bate)
3. `chart_of_accounts.name` (caso exista vinculação por código reduzido)
4. Fallback para o próprio código reduzido

A mesma lógica deve ser aplicada ao nome da conta de débito, para manter consistência.

### 2. Garantir exibição no componente
Verificar `src/components/razao/GerenciadorLancamentos.tsx` no componente `AccountChip` para confirmar que, quando `name` é fornecido, ele é renderizado ao lado do chip. Ajustar tooltip/title para mostrar código + nome completo em caso de truncamento.

### 3. Migration
Criar nova migration substituindo `journal_entries_grid` com `create or replace function`, mantendo a assinatura e grants existentes.

### 4. Validação
Abrir `/razao`, localizar uma linha onde a coluna de crédito mostra apenas o código e confirmar que o nome da conta passa a aparecer ao lado do chip verde.
