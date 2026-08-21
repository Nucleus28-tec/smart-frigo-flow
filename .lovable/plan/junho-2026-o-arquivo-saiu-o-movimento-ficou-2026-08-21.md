# Junho/2026: o arquivo saiu, o movimento ficou

## O que o banco mostra agora

- Junho/2026 não tem mais nenhum arquivo importado (`imported_files` = 0), então a tela **/importar** ficou limpa.
- Mas os lançamentos continuam lá: **9.699 pernas ativas** (9.695 importadas + 4 manuais) e 3 canceladas, todas com o vínculo de arquivo apagado (`file_id` nulo). Nos demais meses, todas as pernas ainda têm arquivo vinculado — Junho é o único caso.
- O período em si continua com status **Aberto**, e isso é esperado: o status é manual (Aberto / Em revisão / Fechado) e não muda por exclusão de arquivo. Não há fechamento registrado para Junho.

Ou seja: a exclusão removeu o arquivo, mas não removeu o movimento. Razão, balancete, demonstrativos e índices de Junho seguem calculando em cima desses 9.699 lançamentos órfãos.

## Por que aconteceu

A rotina de excluir arquivo faz, nesta ordem: apaga os lançamentos do arquivo, depois apaga o arquivo. O passo dos lançamentos **não verifica se deu erro** — se ele falha (com ~9,7 mil linhas, o mais provável é estouro de tempo da requisição), a rotina segue em frente e apaga o arquivo assim mesmo. Como a coluna de arquivo nas pernas é "limpar ao excluir", os lançamentos ficam órfãos e invisíveis para qualquer nova exclusão por arquivo.

## Correção proposta

1. **Limpar Junho/2026 agora**: apagar as 9.702 pernas órfãs do período (inclusive as canceladas) e recalcular indicadores/demonstrativos do mês, deixando-o zerado e pronto para reimportação. As 4 pernas manuais também são de Junho e serão apagadas junto — se você quiser preservá-las, aviso antes de rodar.
2. **Corrigir a exclusão de arquivo** para que ela pare no primeiro erro: se os lançamentos não forem apagados, o arquivo **não** é excluído e a tela mostra o motivo, em vez de falhar em silêncio.
3. **Exclusão em bloco no banco**: mover a limpeza para uma rotina no próprio banco, que apaga tudo de uma vez em transação (arquivo + pernas + linhas legadas), sem risco de estouro de tempo por volume.
4. **Botão "Limpar movimento do período"** em /importar (só Admin, só período não fechado), para casos em que sobrem lançamentos sem arquivo — com confirmação mostrando quantas pernas serão apagadas.

## Detalhes técnicos

- Nova função no banco `delete_imported_file(_file_id)` (security definer, transação única): apaga `journal_legs`, `ledger_entries`, `trial_balance_lines` e a linha de `imported_files`, valida período não fechado e grava em `activity_log`.
- Nova função `purge_period_journal(_period_id)` para o caso órfão, com a mesma validação de período fechado, seguida de `recalculate_period_indicators`.
- `src/lib/imports.functions.ts`: `deleteImportedFile` passa a chamar a RPC e a propagar erro (hoje ignora o retorno dos três deletes).
- `src/routes/_authenticated/importar.tsx`: ação de limpeza do período com diálogo de confirmação e contagem.
- Sem mudança de esquema nas tabelas; RLS mantida (escrita por `is_admin()`).  
  
padronizar este operaçao e documentar 
- &nbsp;