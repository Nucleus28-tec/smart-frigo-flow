# Fase 2 — /balancete derivado do razão

A tela deixa de ser uma planilha editável de `ledger_entries` e passa a ser o balancete gerado pela camada canônica da Fase 1 (`period_account_balances`). Correção de valor só por lançamento de ajuste no razão.

## Como a tela fica

```text
[ Banner de conferência: Ativo x Passivo+PL, delta em R$ ]

ATIVO
  Ativo circulante                 anterior   débito   crédito   saldo atual
    023101 CAIXA GERAL             ...        ...      ...       ...   [Ajustar]
  Ativo não circulante ......................................... subtotal
  Total do Ativo
PASSIVO E PATRIMÔNIO LÍQUIDO
  Passivo circulante / não circulante / Patrimônio líquido ..... subtotais
  Total do Passivo + PL
RESULTADO
  Receita / (-) Custo / (=) Lucro bruto / (-) Despesa / (=) Resultado
CONTAS SEM NATUREZA (bloco de pendências, no topo quando houver)
```

- Colunas por conta: código, nome, saldo anterior, débito, crédito, saldo atual — os mesmos campos que `period_account_balances` já devolve.
- Seções por natureza, recolhíveis, com contagem de contas e subtotal; grupos maiores com totais consolidados e Resultado do período.
- Busca por código/nome, filtro por natureza e opção "somente contas com movimento". Subtotais refletem o que está visível, com aviso quando houver filtro ativo.
- Conferência Ativo × Passivo+PL no topo, sempre com o delta em R$ (banner `ConferenciaBalanco` já existente), e as contas candidatas a reclassificação em resumo.

## Ajuste por lançamento

- Cada linha ganha o botão "Ajustar por lançamento", que abre o formulário de lançamento manual já com a conta clicada pré-preenchida (débito por padrão, com troca para crédito no próprio formulário) e a data do período.
- Gravação por `saveManualJournalEntry` → RPC `upsert_manual_journal_entry`. Nenhuma função nova de banco.
- Ao gravar: toast de sucesso e recálculo imediato da tela (invalidação da query de saldos).
- Período fechado: botão desabilitado, com aviso do motivo.

## O que sai

- Edição inline de valor revisado, troca de natureza em massa, botão Reverter e toda a leitura/gravação de `ledger_entries` nesta tela — incluindo o uso de `updateLedgerEntry` / `revertLedgerEntry` a partir do balancete. As funções continuam no projeto, sem chamada por esta página.

## Importação de balancete

- Continua funcionando como espelho de conferência, mas a tela `/importar` passa a marcar o tipo "Balancete (G2)" como **Em descontinuação**: aviso no seletor de tipo e badge na listagem dos arquivos desse tipo, explicando que o balancete oficial agora é gerado pelo razão.

## Validação

Comparar o balancete gerado de Junho/2026 com o oficial do G2: Ativo na ordem de 11.711.331,31 D e Passivo+PL de 11.089.802,28 C, com a conferência Ativo × Passivo+PL exibida. A divergência conhecida das contas 023511 / 023413 / 023512 continua aparecendo no banner e em `/reclassificacoes` — ela é denunciada, não corrigida no cálculo.

## Detalhes técnicos

- Frontend apenas; nenhuma migração de banco.
- `src/routes/_authenticated/balancete.tsx` reescrito consumindo `useConferencia` (`src/lib/conferencia.ts`), que já chama `period_account_balances`; agrupamento derivado em memória pela ordem de `NATURE_OPTIONS` em `src/lib/rotta.ts`.
- Formulário de lançamento manual extraído de `src/components/razao/GerenciadorLancamentos.tsx` para um componente compartilhado (`src/components/razao/LancamentoManualDialog.tsx`), reutilizado pelo razão e pelo balancete sem mudar o comportamento atual do gerenciador.
- Ajuste pontual em `src/routes/_authenticated/importar.tsx` para o aviso de descontinuação.
- Head da rota atualizado: o balancete não é mais "tabela editável".
