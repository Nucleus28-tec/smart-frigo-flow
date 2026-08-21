# Abril/2026 — por que a importação acusou erro

## O que realmente aconteceu (verificado no banco)

A importação **não falhou**: os 8.371 lançamentos de Abril foram gravados. O que apareceu foi um **alerta de conferência**.

Somando o período: débito 55.709.000,47 × crédito 55.709.059,99 → diferença de **-59,52**.

Rastreando a diferença, ela vem de **um único documento**:

```text
Doc 96786 · 06/04/2026 · R$ 59,52
  conta 011906 SUPERCEI ......... CRÉDITO 59,52   (contrapartida 031154)
  conta 031154 .................. AUSENTE no arquivo
  histórico: DEVOLUÇÃO DE PRODUTOS - CLIENTE SUPERCEI ... NFE SAIDA 19078
```

A conta **031154 não existe no razão de Abril** — nem como página de conta, nem em `ledger_accounts`. O arquivo do G2 trouxe **378 contas** em Abril contra **407** em Maio. Ou seja: a perna de débito desse lançamento ficou de fora do relatório exportado. É um problema de origem (G2), não do importador — exatamente o tipo de erro que o sistema existe para revelar.

Observações adicionais do mesmo toast:
- **"1175 sem valor"** — são as linhas de cabeçalho "CONTA: … SALDO ANTERIOR", uma por conta. Elas viram saldo anterior (1175 saldos gravados), mas hoje também são contadas como "sem valor". Mensagem confusa, não é perda de dado.
- **"0 contas vinculadas"** — o casamento razão × balancete não achou nada porque não há balancete importado para Abril. Esperado.
- **Status "Erro" e coluna "Lançamentos = 0"** — o status vira "erro" para qualquer alerta, mesmo com tudo gravado; e a coluna conta `ledger_entries` (fluxo antigo do balancete), não as pernas do razão. Ambos enganam o usuário.

## O que proponho ajustar

1. **Separar "Erro" de "Importado com alertas"**
   `finalize_journal_import` passa a marcar `processado_com_alertas` quando houver lançamentos gravados e apenas alertas de conferência; `erro` fica reservado para falha real de gravação. Badge âmbar na lista de arquivos.

2. **Corrigir a coluna "Lançamentos"**
   Contar pernas de `journal_legs` por `file_id` (somando `ledger_entries` só nos arquivos de balancete).

3. **Relatório "O que não fecha" no período**
   Nova seção em `/importar` (e reaproveitada em `/razao` → Pendências) listando:
   - documentos com débito ≠ crédito, com valor, data, conta, contrapartida e histórico;
   - contrapartidas citadas que não têm conta no período (caso 031154);
   - queda de contas em relação ao período anterior (378 × 407).
   Cada linha com link para o lançamento no razão e ação "Lançar ajuste".

4. **Mensagem de importação mais honesta**
   Trocar "1175 sem valor" por "1175 cabeçalhos de conta (saldo anterior)" e só reportar como rejeitadas as linhas realmente descartadas.

## Detalhes técnicos

- Migração: ajustar `finalize_journal_import` (novo status + retorno com `unbalanced_docs` e `missing_counterparts`) e criar `journal_import_diagnostics(_period_id)` retornando os três blocos do item 3.
- Front: `src/routes/_authenticated/importar.tsx` (badge de status, contagem de pernas, painel de diagnóstico), `src/lib/imports.functions.ts` (novo relatório do chunk/finalize), reaproveitar `journal_pending_report` onde já existe em `/razao`.
- Constraint de `imported_files.processing_status` precisa aceitar o novo valor.

## Sobre o -59,52 de Abril, na prática

Depois do ajuste, o caminho será: abrir o diagnóstico → ver o doc 96786 → lançar o ajuste manual de R$ 59,52 na conta correta (ou pedir a reexportação do razão no G2 com a conta 031154). Nada é corrigido silenciosamente.
