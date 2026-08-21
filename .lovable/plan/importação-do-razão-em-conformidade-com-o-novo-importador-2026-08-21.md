# Importação do razão em conformidade com o novo importador

As funções de banco já foram atualizadas no Supabase (confirmado por consulta): `import_journal_legs` agora tem o parâmetro `_skip_closing`, devolve um relatório com `ok`, `sqlstate`, contagens e desfaz o bloco inteiro em caso de falha; `finalize_journal_import(_file_id)` existe e devolve totais, diferença débito × crédito e alertas de truncamento; `enforce_analytic_posting` deixa passar lançamentos de origem `importacao` marcando a conta como pendente.

O que está fora de conformidade é a camada da aplicação: ela ainda chama a importação sem `_skip_closing`, ignora o retorno de erro (um bloco pode falhar em silêncio e a tela mostra sucesso) e marca o arquivo como "processado" à mão, sem chamar a nova função de finalização/validação.

## 1. Envio dos blocos (server function)

- Passar `_skip_closing` na chamada da importação, com padrão "descartar encerramentos do G2" e possibilidade de desligar.
- Ler o relatório devolvido: quando `ok` for falso, interromper a importação e propagar a mensagem com sqlstate/detalhe, em vez de somar zero e seguir.
- Acumular por bloco: gravados, contas novas, saldos anteriores, encerramentos descartados, linhas sem conta, sem valor, valores e datas inválidos.

## 2. Finalização

- Chamar `finalize_journal_import(_file_id)` como parte da finalização, antes do casamento de contas/recálculo, e devolver seus totais e alertas.
- Remover a atualização manual de `processing_status` para "processado": quem define o status agora é a função de banco (processado ou erro com o motivo).
- Se a finalização vier com alertas (débito ≠ crédito, possível truncamento, encerramentos na base), o recálculo/geração de demonstrativos continua, mas o resultado é reportado como atenção, não como sucesso limpo.

## 3. Tela /importar

- Alternador "Descartar lançamentos de encerramento do G2" (ligado por padrão) na área de importação do razão, com nota de que o fechamento é feito no RotaBase.
- Ao terminar: resumo com lançamentos gravados, contas, saldos anteriores, encerramentos descartados e as linhas rejeitadas (sem conta, sem valor, valor/data inválidos).
- Alertas da finalização em destaque (débito × crédito, truncamento) em vez de um toast verde genérico; falha de bloco mostra a mensagem completa e o arquivo permanece marcado como erro na lista.
- A lista de arquivos passa a exibir `processing_error` do razão quando houver.

## 4. Documentação

Registrar o novo contrato em `db/schemas.sql` (corpo atual das funções), `docs/FUNCTIONS.md` e `docs/PROCESSO.md` (razão importado sem encerramentos; fechamento feito no RotaBase).

## Detalhes técnicos

- `src/lib/razao.functions.ts`: `importJournalChunk` ganha `skip_closing` no validador e repassa `_skip_closing`; passa a validar `ok` no retorno; `finalizeJournalImport` chama a RPC `finalize_journal_import` e para de escrever `processing_status`.
- `src/routes/_authenticated/importar.tsx`: `enviarPernas` acumula o relatório dos blocos e exibe o resumo; estado do alternador de encerramentos.
- Sem novas migrações — as funções de banco já estão aplicadas; apenas espelhamos o código em `db/schemas.sql`.
