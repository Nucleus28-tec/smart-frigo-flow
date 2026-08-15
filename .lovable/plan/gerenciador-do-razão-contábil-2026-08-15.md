# Gerenciador do Razão Contábil

O razão passa a ser a fonte do movimento (partida e contrapartida de cada lançamento) e o balancete continua sendo a árvore de contas e o espelho oficial do G2 para conferência. Os dois lados seguem editáveis.

## O que já sei dos arquivos enviados

Razão de maio: 315 páginas, 1.170 contas. Cada conta abre com `CONTA: 011126 - BANCO SICOOB ROTA...` e `SALDO ANTERIOR`, e cada linha traz: número do lançamento, data, código da contrapartida, histórico, débito, crédito e saldo acumulado.

Balancete de maio: 12 páginas, código hierárquico (`1.01.01.002.00006`), descrição, saldo anterior, débito, crédito e saldo atual.

O elo que falta é o de-para: o razão usa o código reduzido de 6 dígitos, o balancete o código estruturado, e o prefixo do reduzido não permite derivar o grupo (contas reparentadas). O código reduzido é o identificador estável e vira a chave do plano.

## O que será construído

**1. Plano de contas unificado (de-para)**
Uma tabela de contas com: código reduzido (chave), código hierárquico, descrição, nível, conta-pai, se é analítica e a natureza contábil. É aqui que o vínculo reduzido → hierárquico → natureza vive, uma vez só, reaproveitado em todos os meses.

O casamento inicial é automático (nome normalizado + confronto de débito/crédito e saldo do mês entre razão e balancete). O que casar com segurança entra confirmado; o duvidoso e o não casado vão para uma fila de confirmação na tela, contas reparentadas incluídas.

**2. Importação do razão**
Novo tipo de arquivo em `/importar`: "Razão contábil". A leitura é determinística (sem IA), feita no navegador com extração de texto do PDF por posição de coluna, enviada ao servidor em blocos e gravada por uma função no banco. Reimportar o mesmo mês substitui o movimento do arquivo e registra o diff, no mesmo padrão já usado hoje.

Cada linha vira uma "perna" de lançamento: número do lançamento, data, conta, contrapartida, histórico, débito, crédito e saldo acumulado. Pernas com o mesmo número de lançamento formam o lançamento completo.

**3. Espelho do balancete**
O balancete importado passa a gravar também a árvore oficial (código, descrição, nível, saldo anterior, débito, crédito, saldo atual). A tela `/balancete` continua editável como hoje.

**4. Tela `/razao` — o gerenciador**

- Coluna esquerda: árvore de contas do período com filtro por código, nome e natureza, e busca.
- Ao abrir uma conta: saldo anterior, movimento do mês e saldo final, com a lista de lançamentos.
- Cada linha mostra data, número do lançamento, histórico, débito/crédito e **a contrapartida com nome**, clicável para pular para a outra conta.
- Visão por lançamento: abre o documento inteiro com todas as pernas e a conferência débito = crédito.
- Aba **Conferência**: razão × balancete conta a conta (débito, crédito e saldo), destacando divergências e contas presentes em um lado e ausentes no outro.
- Aba **Vínculos pendentes**: contas do razão sem conta hierárquica ou sem natureza, com sugestão e confirmação de Admin.

**5. Cálculo pelo razão**
Indicadores e demonstrativos passam a ser calculados a partir do razão quando o período tem razão importado, agregando as pernas por natureza da conta; sem razão, segue o cálculo atual pelo balancete. A tela de demonstrativos indica qual fonte foi usada.

**6. Agentes**
Novas ferramentas de leitura para o Contador e o CFO: extrato de uma conta, lançamento completo por número, contrapartidas mais frequentes de uma conta, conferência razão × balancete e vínculos pendentes. O Contador ganha a proposta "vincular conta reduzida à conta hierárquica / natureza", aplicada só pelo botão do Admin, como as demais.

## Detalhes técnicos

- Novas tabelas: `ledger_accounts` (de-para, chave `reduced_code`), `journal_legs` (pernas do razão, indexadas por período, conta e número do lançamento), `trial_balance_lines` (espelho do balancete). RLS no padrão do projeto: leitura para autenticados, escrita via `is_admin()`.
- Novas funções no banco: `import_journal_legs` (carga em bloco com diff), `link_reduced_accounts` (casamento automático razão × balancete), `reconcile_journal_vs_trial_balance` (conferência) e ajuste em `recalculate_period_indicators_internal` / `generate_period_statements` para preferirem o razão.
- Parsing do PDF no cliente com `pdfjs-dist`, agrupando itens por coordenada Y e faixas de X; envio em lotes de ~2.000 linhas por chamada de server function, com barra de progresso. Nada de IA nessa etapa — o formato é fixo.
- Volume esperado: dezenas de milhares de pernas por mês; a tela lê sempre por conta (paginada), nunca o mês inteiro de uma vez.

## Ordem de execução

1. Migração das três tabelas e das funções de carga/casamento.
2. Importação do razão (parser + envio + gravação) e do espelho do balancete.
3. Tela `/razao` com extrato, contrapartida, visão por lançamento e conferência.
4. Fila de vínculos pendentes e confirmação por Admin.
5. Cálculo de indicadores e demonstrativos pelo razão.
6. Ferramentas dos agentes.  
teste o fluxo, valide todas as estapas 