# Impacto do sinal na prévia da reclassificação

Hoje a prévia mostra apenas de onde para onde a conta vai (código hierárquico e natureza). Ela passa a mostrar também **como o valor será apresentado** depois da mudança, aplicando a convenção contábil de cada grupo.

## Como fica

Na tabela de prévia do diálogo "Reclassificar conta", duas colunas novas:

```text
Conta                        De         Para       Hoje aparece     Vai aparecer
041133 FORNECEDOR PECUARISTA 1.02.03.   2.02.01.   -1.240.500,00    +1.240.500,00   ↕ sinal invertido
041140 ADIANTAMENTOS         1.01.05.   2.02.01.     320.000,00      -320.000,00    ⚠ saldo invertido
```

- **Hoje aparece**: o valor do período com a convenção da natureza atual.
- **Vai aparecer**: o mesmo saldo com a convenção da natureza de destino.
- Quando o sinal muda de negativo para positivo (o caso normal ao corrigir uma conta que estava no grupo errado), aparece a marca discreta "sinal invertido" — é o comportamento esperado.
- Quando o valor **fica** negativo no destino (ex.: saldo devedor indo para o passivo), aparece um aviso âmbar "saldo invertido — confira a escrituração": o sistema não inverte débito/crédito dos lançamentos, então isso indica erro de lançamento, não de classificação.
- Um rodapé no diálogo lembra que os totais gravados de DRE/Balanço/Fluxo só refletem a mudança após "Gerar demonstrativos".

Contas sintéticas arrastadas junto no ramo continuam listadas na prévia; para elas o valor exibido é o somatório do ramo.

## Convenção aplicada

| Natureza de destino | Como o saldo é apresentado |
| --- | --- |
| Ativo circulante / não circulante | saldo (devedor positivo) |
| Passivo circulante / não circulante / PL | saldo invertido (credor positivo) |
| Receita | crédito − débito |
| Custo / despesa | débito − crédito |

## Detalhes técnicos

- Nenhuma mudança de banco: `move_ledger_accounts` já devolve `natureza_de` e `natureza_para` na prévia, e `chart_accounts_tree` já devolve `balance` (saldo do período, convenção débito-positivo) por conta — a prévia é montada só com esses dados.
- Novo utilitário em `src/lib/rotta.ts` (ou `src/lib/indicadores.ts`, conforme o que já existir): `valorApresentado(saldo, natureza)` com a tabela acima, reutilizável por outras telas.
- `src/components/demonstrativos/ReclassificarContaDialog.tsx`: cruza cada linha de `preview` com a linha correspondente de `chart_accounts_tree` por `reduced_code`, calcula os dois valores, e renderiza as colunas novas mais os avisos e o rodapé.
- Sem alteração no fluxo de confirmação, nas RPCs de movimentação ou no cálculo dos demonstrativos.
