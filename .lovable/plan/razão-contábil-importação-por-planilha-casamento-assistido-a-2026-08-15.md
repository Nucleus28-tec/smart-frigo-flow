# Razão Contábil — importação por planilha, casamento assistido, auditoria, agente e exportação

Cinco entregas sobre o gerenciador do razão que já existe (importação por PDF, tela `/razao` com extrato, lançamento, conferência e vínculos).

## 1. Importar razão por CSV/Excel com mapeamento de colunas

Em `/importar`, ao escolher "Razão contábil", passa a aceitar também `.csv`, `.xlsx` e `.xls` além do PDF.

- O arquivo é lido no navegador e a primeira linha vira a lista de colunas disponíveis.
- Uma tela de mapeamento aparece antes de gravar: para cada campo do razão (conta reduzida, nome da conta, saldo anterior, data, número do lançamento, contrapartida, histórico, débito, crédito, saldo acumulado) o usuário escolhe a coluna correspondente. O sistema pré-seleciona por semelhança de nome; conta reduzida, débito e crédito são obrigatórios.
- Pré-visualização com paginaçao de todos os lancamentos linhas já convertidas, com valores em Real e datas normalizadas, partida e contrapartida
- Validação antes de salvar: conta reduzida vazia, valor não numérico, data inválida, linha com débito e crédito ao mesmo tempo ou ambos zerados, contrapartida inexistente. O resultado é um resumo "X linhas válidas, Y com problema", com a lista dos problemas e a linha original. Nada é gravado enquanto houver erro bloqueante; avisos podem ser aceitos e as linhas correspondentes são ignoradas.
- Confirmado o mapeamento, o envio usa o mesmo caminho em blocos e a mesma finalização já usados pelo PDF (nenhuma regra de gravação muda).
- O mapeamento fica lembrado por tipo de arquivo para as próximas importações.

## 2. Casamento automático razão × balancete e relatório de pendências

O casamento hoje é por nome normalizado e por confronto de débito/crédito. Passa a ter rodadas adicionais, aplicadas em ordem e sempre só quando o par é único dos dois lados:

- nome normalizado sem sufixos numéricos/filial;
- saldo final coincidente (anterior + débito − crédito) além do confronto de movimento;
- prefixo do código hierárquico compatível com a natureza já confirmada da conta em meses anteriores;
- herança do vínculo confirmado em período anterior para o mesmo código reduzido.

A aba **Conferência** ganha um **relatório de pendências** com uma causa provável por linha, entre elas: "conta nova no razão, ausente no balancete", "conta no balancete sem movimento no razão", "vários candidatos com o mesmo nome", "diferença de valor" (mostrando o delta), "natureza indefinida para o código". Cada pendência traz a ação sugerida e o botão de vincular/confirmar (Admin), e o relatório é exportável.

## 3. Trilha de auditoria de vínculos e classificações

Toda alteração de vínculo (código hierárquico, natureza, status) e toda classificação aplicada passam a registrar usuário, data/hora, valores anteriores e novos, e a origem (casamento automático, confirmação manual, proposta do agente aprovada).

Uma aba **Histórico** em `/razao` lista esses registros com filtro por conta, usuário e período, e mostra o antes → depois de cada mudança. Sem exclusão nem edição do histórico.

## 4. Agente Contador ligado ao razão

O Contador ganha ferramentas de leitura sobre o razão: extrato da conta, lançamento completo por número, contrapartidas mais frequentes de uma conta, conferência razão × balancete e vínculos pendentes.

A proposta de classificação passa a citar as contrapartidas que a justificam ("94% dos créditos desta conta têm contrapartida em Fornecedores"), e o cartão no chat mostra essas evidências junto do botão Aplicar do Admin. A gravação continua sendo só pelo botão do Admin, e passa pela trilha de auditoria do item 3.

## 5. Exportar extrato e lançamento em CSV e PDF

Botões de exportação no extrato da conta, na visão do lançamento completo e na conferência/pendências.

- CSV com as mesmas colunas da tela.
- PDF com cabeçalho (empresa, período, conta, saldo anterior/final) e a mesma tabela, no padrão visual dos demonstrativos.
- A exportação respeita os filtros ativos na tela e o papel do usuário: quem não é Admin exporta o que vê, sem colunas restritas.

## Detalhes técnicos

- Leitura de planilha com o `xlsx` já instalado; CSV pelo mesmo caminho. Mapeamento e validação no cliente, gravação pelas server functions existentes (`importJournalChunk`, `finalizeJournalImport`).
- Novas regras de casamento dentro de `link_reduced_accounts`; nova função de banco para o relatório de pendências com a causa por linha.
- Nova tabela `ledger_account_audit` (conta, campo, valor anterior, valor novo, origem, usuário, data), gravada pelas funções de vínculo/classificação; leitura para autenticados, escrita só via funções.
- Novas ferramentas do agente em `tools.server.ts` reusando as RPCs `journal_account_statement`, `journal_document` e `reconcile_journal_vs_trial_balance`, mais uma RPC de contrapartidas frequentes.
- PDF com `pdf-lib` no mesmo padrão de `reports.server.ts`; CSV gerado no cliente.

## Ordem de execução

1. Migração: tabela de auditoria, RPC de pendências, novas regras de casamento.
2. Importação por CSV/Excel com mapeamento e validação.
3. Relatório de pendências e aba Histórico.
4. Ferramentas do agente e evidência de contrapartida na proposta.
5. Exportações CSV/PDF.