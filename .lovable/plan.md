# Pré-visualizador de relatórios + correção do download em produção

Objetivo: ver o relatório na tela (mesmo layout do arquivo final), imprimir direto do navegador e corrigir a falha ao baixar o PDF em produção.

## O que muda na tela `/razao` → aba Relatórios

1. Novo botão **Pré-visualizar PDF** ao lado de Exportar PDF / Exportar Excel.
2. Abre um diálogo em tela quase cheia com o PDF renderizado dentro da própria página (sem sair do sistema, sem nova aba).
3. Dentro do diálogo: **Imprimir**, **Baixar**, navegação de páginas e fechar. A impressão usa o próprio PDF (não a tela), então sai idêntico ao arquivo.
4. Os botões atuais de exportar continuam existindo, mas passam a baixar o arquivo direto (ver abaixo), sem depender de pop-up nem de nova aba.

## Correção do bug de download

Causa provável (a confirmar como primeiro passo, lendo o log da função em produção): hoje o servidor gera o PDF, envia para o bucket `exports`, cria uma URL assinada de outro domínio e o navegador é obrigado a abrir uma nova aba — em produção isso falha por bloqueio de pop-up/domínio ou por erro no envio ao bucket. O relatório em si já foi gerado; só a entrega quebra.

Mudança: a função de exportação passa a devolver o próprio arquivo (conteúdo em base64) junto com nome e tipo. O navegador monta o arquivo localmente e dispara o download por link temporário — mesma origem, sem pop-up, sem URL assinada. O envio para o bucket `exports` continua acontecendo apenas como cópia/histórico e, se falhar, não impede mais o download (o erro passa a ser apenas um aviso).

Também: mensagens de erro passam a mostrar o motivo real vindo do servidor em vez de "Falha ao exportar", e relatórios muito grandes ganham aviso claro em vez de erro genérico.

## Detalhes técnicos

- Primeiro passo: `server-function-logs` de `exportLedgerReport` em produção para confirmar a causa (falha no upload/signed URL vs. limite de execução vs. erro no gerador).
- `src/lib/razao.functions.ts` (`exportLedgerReport`): retorna `{ file_name, content_type, size, base64, storage_error? }`; upload/signed URL passam a ser best-effort dentro de `try/catch`. Nada muda nas RPCs `journal_report_analytic` / `trial_balance_report`.
- Novo `src/components/razao/VisualizadorRelatorio.tsx`: diálogo com `<iframe>` apontando para um `blob:` URL do PDF (revogado ao fechar) e botão Imprimir via `iframe.contentWindow.print()`, com fallback para abrir o blob em nova aba quando o navegador bloquear a impressão embutida.
- Novo helper em `src/lib/razao-export.ts`: `base64ToBlob` + `downloadBlob`, reutilizado pelos botões de exportar e pelo visualizador.
- `RelatoriosRazao.tsx`: estado `preview` (bytes + nome), botão Pré-visualizar, e `handleExport` usando o download por blob.
- Sem migração de banco; sem mudança de permissões (leitura já liberada para Admin e Usuário).
- Mesmo tratamento aplicado ao download de Demonstrativos, que usa o mesmo padrão de URL assinada.
