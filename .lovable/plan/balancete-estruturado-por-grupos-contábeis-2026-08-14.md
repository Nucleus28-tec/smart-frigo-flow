# Balancete estruturado por grupos contábeis

Reorganizar a tela `/balancete` para que ela se comporte como um balancete de verdade: contas agrupadas em blocos (Ativo, Passivo e Patrimônio Líquido, Resultado), com subtotais por grupo e verificação de fechamento — mantendo toda a edição de valores que já existe hoje.

## Estrutura da tela

```text
BALANÇO PATRIMONIAL
  ATIVO
    Ativo circulante ................. subtotal
    Ativo não circulante ............. subtotal
    Total do Ativo ................... total
  PASSIVO E PATRIMÔNIO LÍQUIDO
    Passivo circulante ............... subtotal
    Passivo não circulante ........... subtotal
    Patrimônio líquido ............... subtotal
    Total do Passivo + PL ............ total

RESULTADO
    Receita .......................... subtotal
    (-) Custo ........................ subtotal
    (=) Lucro bruto
    (-) Despesa ...................... subtotal
    (=) Resultado do período

CONTAS SEM NATUREZA (bloco de pendências, sempre no topo quando houver)
```

## Comportamento

- Cada natureza vira uma seção com cabeçalho, contagem de contas e subtotal à direita; seções podem ser recolhidas/expandidas.
- Grupos maiores (Ativo, Passivo+PL, Resultado) mostram totais consolidados e o Resultado do período calculado como Receita − Custo − Despesa.
- Faixa de conferência no topo: Ativo x Passivo+PL, com indicação visual de diferença quando não fecha, e Resultado do período.
- Bloco "Contas sem natureza" aparece destacado no topo quando existirem, já que são o que impede a consolidação.
- Edição inline de valor revisado, troca de natureza, destaque de linha editada manualmente e botão Reverter continuam exatamente como estão. Ao trocar a natureza, a linha migra para a seção correta.
- Busca, filtro de natureza e "somente editados" continuam funcionando: filtram as linhas dentro das seções e os subtotais refletem o que está visível (com aviso quando houver filtro ativo).
- O card atual de "Totais por natureza" no rodapé é substituído por um resumo de fechamento (Ativo, Passivo+PL, diferença, Resultado).

## Detalhes técnicos

- Mudança apenas de frontend em `src/routes/_authenticated/balancete.tsx`; nenhuma alteração de banco, RLS ou server function.
- Agrupamento derivado em memória a partir da mesma query `ledger_entries`, usando a ordem canônica de `NATURE_OPTIONS` em `src/lib/rotta.ts`.
- Sinal contábil: subtotais somam o valor aplicado (`reviewed_value ?? raw_value`); para a conferência Ativo x Passivo+PL e para o Resultado usa-se o valor absoluto por grupo conforme convenção de sinais do balancete importado, exibindo a diferença quando os lados não baterem.
- Renderização em uma única `Table` com linhas de cabeçalho de seção e linhas de subtotal, para preservar o alinhamento das colunas.
