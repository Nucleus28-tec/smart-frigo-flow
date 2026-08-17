## 1. Visão geral

O **Rotta Financeiro** é um ERP financeiro (MVP) feito sob medida para o **Frigorífico Rotta das Carnes (Rota Alimentos)**, com o objetivo de organizar e apurar resultados contábeis a partir de dados exportados manualmente do sistema G2. Hoje o balancete que sai do G2 vem desestruturado — com contas mal classificadas, lançamentos incorretos e sem estrutura para análise — e não existe integração via API com o G2, então tudo entra por importação manual de arquivos PDF e Excel. O Rotta Financeiro recebe esses arquivos, interpreta o conteúdo, reclassifica as contas conforme o padrão contábil, aponta inconsistências para correção no próprio G2 e monta automaticamente a DRE, o Balanço Patrimonial e o Fluxo de Caixa. Ele é usado pela equipe interna do frigorífico — gestores de operação que dominam processos financeiros mas não têm perfil técnico — com foco em importar, revisar, corrigir e gerar os relatórios rapidamente, num ciclo de fechamento mensal que também permite atualizações semanais ou diárias.

## 2. Papéis de usuário

- **Admin (gestor financeiro interno):** controla usuários, aprova/rejeita reclassificações sugeridas, define o mapeamento do plano de contas do Rotta para o padrão contábil e tem acesso total a importação, edição e relatórios.
- **Usuário (operação interna):** importa arquivos, revisa e edita lançamentos e valores, acompanha os apontamentos de inconsistência e visualiza os relatórios e o painel de indicadores, dentro das permissões concedidas pelo Admin.

## 3. Processo passo a passo por papel

### Admin (gestor financeiro interno)

1. Faz login e acessa o painel principal do Rotta Financeiro.
2. Cadastra e gerencia os demais usuários internos, definindo quem é Admin e quem é Usuário.
3. Na primeira configuração, define/valida o **mapeamento do plano de contas** do Rotta — que, como você indicou, **não segue padrão** — para as naturezas contábeis oficiais: ativo circulante, ativo não circulante, passivo circulante, passivo não circulante, patrimônio líquido, receita, custo e despesa.
4. Seleciona o período de trabalho (ex.: fechamento de janeiro) e importa os arquivos exportados do G2 e do Sicoob: balancete (PDF/Excel), pedidos de compra, notas fiscais, romaneio de abate, contas a pagar, contas a receber, relatório de vendas e extrato bancário Sicoob.
5. Aguarda a leitura automática dos arquivos, que interpreta o conteúdo e sugere a reclassificação das contas conforme o padrão contábil.
6. Recebe as reclassificações como **sugestões para aprovar** (por exemplo, mover "Caixa e Equivalentes" para Ativo Circulante) — como você indicou, a IA reajusta e o Admin aprova as mudanças, e cada aprovação/rejeição alimenta o aprendizado do padrão da empresa ao longo do tempo.
7. Abre o balancete importado em tabela editável para revisar, corrigir valores, reclassificar contas e ajustar lançamentos manualmente quando necessário.
8. Consulta o **Painel de Apontamentos** com a lista de inconsistências, erros e sugestões de correção — usados para corrigir a origem no G2.
9. Gera automaticamente a DRE, o Balanço Patrimonial e o Fluxo de Caixa estruturados.
10. Visualiza o **Dashboard de resultado** com indicadores (margem bruta, EBITDA, resultado líquido, posição de caixa) e o BI com gráficos.
11. Exporta os relatórios finais em PDF e Excel, além de visualizá-los na tela.
12. Ao longo do mês, reimporta arquivos atualizados (semanal ou até diariamente); o sistema recalcula os dados automaticamente e informa quais valores foram atualizados, listando as mudanças.

### Usuário (operação interna)

1. Faz login e acessa o período de trabalho vigente.
2. Importa os arquivos disponíveis (PDF/Excel) do G2 e do extrato Sicoob, conforme forem sendo exportados ao longo do mês.
3. Acompanha as reclassificações sugeridas e revisa os lançamentos na tabela editável, corrigindo valores e ajustando o que for necessário dentro de suas permissões.
4. Consulta o Painel de Apontamentos para identificar erros e sugestões de correção que precisam voltar ao G2.
5. Visualiza a DRE, o Balanço Patrimonial, o Fluxo de Caixa e o dashboard de indicadores gerados.
6. Exporta ou visualiza os relatórios (PDF, Excel e tela) para uso interno.
7. Sempre que subir um arquivo novo sobre um período já processado, confere a lista de valores atualizados que o sistema informa após o recálculo automático.

## 4. Regras de negócio

- Regra: todo acesso é de usuário interno com um de dois perfis — Admin ou Usuário; não há usuário externo no MVP.
- Regra: apenas o Admin cadastra/gerencia usuários e define o mapeamento do plano de contas para o padrão contábil.
- Regra: a entrada de dados é sempre manual por importação de arquivos PDF e Excel — não há integração via API com o G2 nem com o Sicoob.
- Regra: reclassificações identificadas pela leitura dos arquivos são apresentadas como **sugestões** e só passam a valer após aprovação do usuário — nada é aplicado silenciosamente.
- Regra: cada aprovação ou rejeição de reclassificação alimenta o padrão de classificação da empresa, para que sugestões futuras fiquem mais precisas.
- Regra: o balancete do G2 chega em layout padronizado (mesmo formato entre exportações), mas o plano de contas do Rotta não tem padrão e precisa ser mapeado para as naturezas contábeis.
- Regra: as contas devem ser classificadas em uma das oito naturezas: ativo circulante, ativo não circulante, passivo circulante, passivo não circulante, patrimônio líquido, receita, custo e despesa.
- Regra: valores e lançamentos podem ser editados manualmente na tabela, e essas edições prevalecem sobre o dado bruto importado.
- Regra: DRE, Balanço Patrimonial e Fluxo de Caixa são gerados a partir das contas já classificadas e dos valores revisados/aprovados.
- Regra: o objetivo padrão é o fechamento mensal, mas o sistema aceita atualizações semanais ou diárias para análise em ciclo mais curto.
- Regra: ao importar um arquivo novo sobre um período já processado, o sistema recalcula automaticamente e informa ao usuário a lista dos valores que foram atualizados.
- Regra: o Painel de Apontamentos lista inconsistências e sugestões de correção, cuja finalidade é orientar o ajuste na origem (G2), não corrigir automaticamente o sistema de origem.
- Regra: os relatórios finais devem estar disponíveis em três formas — visualização na tela, exportação em PDF e exportação em Excel — além do painel de BI com indicadores e gráficos.

## 5. Suposições assumidas

- SUPOSIÇÃO: os perfis "admin" e "usuários" foram detalhados como Admin = controle total (usuários, mapeamento de plano de contas, aprovações) e Usuário = importação/revisão/consulta, já que a resposta indicou apenas "usuários internos com perfis de admin e usuários" sem descrever cada permissão.
- SUPOSIÇÃO: o mapeamento do plano de contas do Rotta para o padrão contábil é definido/validado pelo Admin uma vez e reaproveitado nos períodos seguintes, ajustando-se conforme as aprovações — a resposta confirmou a necessidade de mapear, mas não quem faz nem com que frequência.
- SUPOSIÇÃO: o BI "bem estruturado com indicadores e gráficos" reutiliza os mesmos indicadores do dashboard de resultado (margem bruta, EBITDA, resultado líquido, posição de caixa), já que a resposta pediu o BI mas não especificou quais métricas adicionais.
- SUPOSIÇÃO: quando o recálculo automático altera valores após uma nova importação, as edições manuais previamente feitas pelo usuário são preservadas e destacadas na lista de valores atualizados — a resposta confirmou o recálculo e a listagem, mas não o tratamento de edições manuais anteriores.

---

## 6. Razão contábil — a nova fonte do movimento

A partir da inclusão do **Gerenciador do Razão**, o fluxo de apuração muda de fonte:

- **Razão contábil** = fonte do movimento. Cada linha é uma "perna" de lançamento (data, número do documento, conta reduzida, contrapartida, histórico, débito, crédito, saldo acumulado). É de onde os indicadores e os demonstrativos são calculados.
- **Balancete do G2** = fonte da estrutura (árvore hierárquica de contas) e espelho oficial para conferência. Não alimenta o cálculo quando há razão importado.

### Fluxo revisado

1. Selecionar o período em `/periodos`.
2. Importar o **balancete** em `/importar` — grava a árvore oficial (código hierárquico, descrição, nível, saldo anterior, débito, crédito, saldo atual).
3. Importar o **razão** em `/importar` (PDF, CSV, XLSX ou XLS). Em planilha, o sistema abre o **mapeamento de colunas**, pré-seleciona por semelhança de nome, converte valores em Real e datas, e mostra a pré-visualização com o resumo "X linhas válidas / Y com problema" antes de gravar.
4. **Casamento automático** razão × balancete: nome normalizado, nome sem sufixo de filial, confronto de débito/crédito, saldo final coincidente e natureza derivada do código hierárquico. Só casa quando o par é único dos dois lados.
5. Revisar em `/razao` as abas **Conferência** (razão × balancete conta a conta) e **Pendências** (causa provável por linha: conta nova no razão, conta só no balancete, vários candidatos, diferença de valor, natureza indefinida).
6. Confirmar os **Vínculos** pendentes (somente Admin) — reduzido → hierárquico → natureza.
7. Reclassificações sugeridas pela IA seguem a mesma regra de aprovação; o Agente Contador cita as contrapartidas que justificam a proposta.
8. Recalcular indicadores e gerar DRE, Balanço e Fluxo de Caixa — a tela indica a fonte usada (`razao` ou `balancete`).
9. Exportar extrato, lançamento e pendências em CSV/PDF; demonstrativos em PDF/Excel.

### Regras de negócio adicionais

- Regra: quando o período tem razão importado, indicadores e demonstrativos são calculados pelo razão; sem razão, pelo balancete.
- Regra: o **código reduzido** é o identificador estável da conta; o prefixo do reduzido não permite derivar o grupo (há contas reparentadas), por isso o de-para reduzido → hierárquico é obrigatório.
- Regra: nenhuma linha de planilha é gravada enquanto houver erro bloqueante; avisos podem ser aceitos e as linhas correspondentes são ignoradas.
- Regra: reimportar o razão do mesmo arquivo substitui o movimento daquele arquivo e registra o diff, no mesmo padrão da reimportação de balancete.
- Regra: toda alteração de vínculo, natureza ou classificação aplicada é registrada em trilha de auditoria com usuário, data/hora, valor anterior, valor novo e origem (casamento automático, confirmação manual, proposta do agente aprovada). O histórico não pode ser editado nem excluído.
- Regra: o agente nunca grava — propõe, e só o botão "Aplicar" do Admin efetiva.
