# Fase 2 — Importação de arquivos e leitura automática

Objetivo: a equipe sobe os arquivos exportados do G2 na tela `/importar`, acompanha o status de cada um e, no caso do balancete, vê as linhas (`ledger_entries`) criadas automaticamente a partir do conteúdo do arquivo.

## Página /importar

- Exige um período selecionado (usa o contexto de período já existente no cabeçalho). Sem período, mostra aviso com link para `/periodos`.
- Formulário de envio: tipo do arquivo (balancete, pedido de compra, nota fiscal, romaneio de abate, contas a pagar, contas a receber, relatório de vendas, extrato Sicoob) + arquivo PDF/Excel/CSV, com limite de tamanho e validação de extensão.
- O envio vai direto para o bucket privado `imports` por meio de uma URL assinada de upload, sem passar o arquivo pelo servidor da aplicação. Caminho: `periodo/{period_id}/{tipo}/{timestamp}-{nome}`.
- Após o upload, o registro entra em `imported_files` com status "pendente" e a leitura automática é disparada.
- Lista dos arquivos do período: nome, tipo, quem enviou, data, status (pendente / processando / processado / erro) com cor, mensagem de erro quando houver, contagem de linhas geradas, botão "Baixar" (URL assinada de leitura), "Reprocessar" e "Excluir" (Admin).
- A lista se atualiza sozinha enquanto houver arquivo em processamento.

## Leitura automática do arquivo (equivalente à "Edge Function parse-imported-file")

Nesta stack a lógica de servidor roda como Server Function do TanStack (mesmo papel da Edge Function descrita no documento, com o mesmo acesso privilegiado e mesmo contrato: recebe `file_id`, baixa do Storage, extrai e grava).

Fluxo:

1. Marca `processing_status = 'processando'`.
2. Baixa o arquivo do bucket privado.
3. **Excel/CSV**: parser de planilha no próprio servidor — detecta a linha de cabeçalho, a coluna de descrição da conta e a coluna de valor (saldo atual), normaliza número no formato brasileiro (1.234,56 e parênteses/D/C para negativo).
4. **PDF**: envia o documento ao AI Gateway da Lovable (modelo padrão do projeto) pedindo extração estruturada de cada linha do balancete: código da conta, nome da conta, valor e, quando existir, data. Prompt em português, orientado ao layout do balancete do G2.
5. Grava em `ledger_entries`: `period_id`, `file_id`, `source_account_name`, `raw_value`, `entry_date` quando disponível. Reprocessamento substitui as linhas daquele arquivo (não duplica).
6. Atualiza para "processado" (ou "erro" com a mensagem) e registra em `activity_log`.

Tipos que não são balancete são armazenados e registrados com status próprio nesta fase; a extração específica de cada um entra nas etapas seguintes do plano (reclassificação, apontamentos, demonstrativos).

## Permissões

- Enviar e listar: Admin e Usuário (ambos importam, conforme o processo).
- Excluir arquivo: apenas Admin.
- A gravação de `ledger_entries` acontece no servidor com credencial de serviço, respeitando a regra de que só o servidor insere lançamentos brutos.

## Detalhes técnicos

- `src/routes/_authenticated/importar.tsx`: tela completa (upload, lista, status, ações).
- `src/lib/imports.functions.ts`: `createUploadUrl`, `registerImportedFile`, `parseImportedFile` (o "parse-imported-file"), `reprocessFile`, `deleteImportedFile`, `getFileDownloadUrl` — todas autenticadas via `requireSupabaseAuth`, com o cliente de serviço carregado dentro do handler.
- `src/lib/imports.server.ts`: parser de planilha e normalização de valores; chamada ao AI Gateway para PDF.
- Dependência nova: biblioteca de leitura de planilha em JavaScript puro (compatível com o runtime do servidor).
- Sem alteração de banco: as tabelas `imported_files` e `ledger_entries` já existem. Se o teste real indicar necessidade, proponho depois um índice/constraint adicional em migração separada.
- Metadados `head()` próprios para a rota.

## Validação

Faço um teste ponta a ponta com um balancete de exemplo (Excel e PDF) para confirmar upload, status e linhas criadas. Para a confirmação final com dado real, preciso do arquivo de balancete que você vai enviar — assim que ele chegar, importo, mostro as linhas geradas e ajusto o parser ao layout exato do G2.