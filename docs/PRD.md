## 1. Contexto

O **Rotta Financeiro** é um ERP financeiro em versão MVP feito sob medida para o **Frigorífico Rotta das Carnes (Rota Alimentos)**. Hoje o balancete que sai do sistema G2 chega desestruturado — com contas mal classificadas, lançamentos incorretos e sem estrutura para análise — e não existe integração via API com o G2, o que obriga toda a entrada de dados a ser feita por importação manual de arquivos PDF e Excel. A plataforma recebe esses arquivos (balancete, notas fiscais, romaneio de abate, contas a pagar/receber, relatório de vendas e extrato bancário Sicoob), interpreta o conteúdo com apoio de IA, reclassifica as contas para o padrão contábil e monta automaticamente a DRE, o Balanço Patrimonial e o Fluxo de Caixa. O sistema é operado por uma equipe interna de gestores financeiros que dominam processos contábeis mas não têm perfil técnico, num ciclo de fechamento mensal que também admite atualizações semanais ou diárias para análise em ciclo curto.

## 2. Problema

O balancete gerado pelo G2 sai "desestruturado, com contas mal classificadas, lançamentos incorretos e sem estrutura para análise", e como o próprio usuário confirmou, **não há integração via API** — "toda entrada é por importação manual". Além disso, o plano de contas do Rotta "não tem padrão e precisa ser mapeada para o padrão contábil", o que impede a apuração direta de resultados. Na prática, o gestor não consegue, de forma confiável e rápida, transformar os relatórios do G2 em DRE, Balanço e Fluxo de Caixa estruturados. O Rotta Financeiro resolve isso oferecendo importação manual de PDF/Excel, leitura automática por IA, reclassificação de contas por sugestão-com-aprovação (a IA "reajusta e o usuário aprova as mudanças"), edição manual em tabela, um painel de apontamentos para corrigir a origem no G2 e a geração automática dos três demonstrativos com dashboard de indicadores.

## 3. Objetivos

1. **Importar e estruturar um fechamento em uma única sessão:** permitir que o usuário importe um balancete do G2, visualize as contas, reclassifique, edite valores e gere DRE, Balanço e Fluxo de Caixa estruturados sem sair da plataforma (critério de sucesso declarado do MVP).
2. **Padronizar o plano de contas sem padrão:** mapear as contas do G2 para as 8 naturezas contábeis (ativo circulante, ativo não circulante, passivo circulante, passivo não circulante, patrimônio líquido, receita, custo, despesa), com aprendizado incremental a cada aprovação/rejeição.
3. **Reduzir erros de classificação ao longo do tempo:** aumentar a confiança das sugestões da IA usando o histórico de aprovações da empresa, medindo a queda de reclassificações manuais por período.
4. **Suportar ciclos curtos de análise:** permitir atualização mensal, semanal ou diária, recalculando automaticamente e listando os valores alterados a cada nova importação sobre período já processado.
5. **Entregar os demonstrativos em três formas:** visualização em tela, exportação em PDF (com logo) e Excel, além de BI com indicadores e gráficos.

## 4. Personas

### Marcos — Admin (gestor financeiro interno)
- **Papel:** Controle total: gerencia usuários, define o mapeamento do plano de contas, aprova/rejeita reclassificações e gera relatórios.
- **Dor:** Recebe o balancete do G2 desestruturado e gasta horas reclassificando contas manualmente sem garantia de consistência entre períodos.
- **Objetivo:** Fechar o mês com DRE, Balanço e Fluxo de Caixa confiáveis e um BI de indicadores para decisão.
- **Citação:** *"O balancete tem o mesmo padrão, já o plano de contas não tem padrão e precisa ser mapeado para o padrão contábil."*

### Fernanda — Usuário (operação interna)
- **Papel:** Importa arquivos, revisa e edita lançamentos, acompanha apontamentos e consulta relatórios dentro das permissões concedidas pelo Admin.
- **Dor:** Precisa lançar dados ao longo do mês (extrato hoje, NFs amanhã) e não tem visibilidade do que muda quando reimporta um arquivo sobre um período já processado.
- **Objetivo:** Manter os dados do período sempre atualizados e conferir rapidamente o que foi alterado.
- **Citação:** *"Quero poder atualizar semanal ou até diário, que aí é o melhor cenário de análise diária."*

## 5. Requisitos funcionais

- **RF-01:** O sistema deve permitir que o Admin faça login por email e senha e acesse o painel principal do Rotta Financeiro.
- **RF-02:** O sistema deve permitir que o Admin cadastre, edite e desative usuários internos, definindo o papel Admin ou Usuário.
- **RF-03:** O sistema deve permitir que o Admin defina e valide o mapeamento do plano de contas do Rotta (sem padrão) para uma das 8 naturezas contábeis oficiais.
- **RF-04:** O sistema deve permitir que o Admin crie e selecione um período contábil (ex.: Janeiro/2026) e acompanhe seu status (aberto, em revisão, fechado).
- **RF-05:** O sistema deve permitir que Admin e Usuário importem arquivos PDF e Excel exportados do G2 e do Sicoob (balancete, pedidos de compra, notas fiscais, romaneio de abate, contas a pagar, contas a receber, relatório de vendas e extrato Sicoob).
- **RF-06:** O sistema deve ler e interpretar automaticamente os arquivos importados, extraindo os lançamentos e atualizando o status de processamento de cada arquivo.
- **RF-07:** O sistema deve apresentar as reclassificações de contas como sugestões da IA para o Admin aprovar ou rejeitar, sem aplicá-las silenciosamente.
- **RF-08:** O sistema deve registrar cada aprovação/rejeição de reclassificação e usar esse histórico para aprimorar o padrão de classificação da empresa ao longo do tempo.
- **RF-09:** O sistema deve permitir que Admin e Usuário abram o balancete importado em tabela editável para revisar, corrigir valores, reclassificar contas e ajustar lançamentos manualmente.
- **RF-10:** O sistema deve garantir que valores editados manualmente prevaleçam sobre o dado bruto importado e sejam destacados na interface.
- **RF-11:** O sistema deve detectar inconsistências (contas mal classificadas, lançamentos incorretos, valores divergentes, contas sem natureza, duplicidades) e exibi-las no Painel de Apontamentos com sugestões de correção no G2.
- **RF-12:** O sistema deve permitir que Admin e Usuário marquem apontamentos como resolvidos ou ignorados.
- **RF-13:** O sistema deve gerar automaticamente a DRE, o Balanço Patrimonial e o Fluxo de Caixa a partir das contas classificadas e dos valores revisados/aprovados.
- **RF-14:** O sistema deve exibir um Dashboard de resultado com indicadores financeiros (margem bruta, EBITDA, resultado líquido e posição de caixa) e um BI com gráficos por período.
- **RF-15:** O sistema deve permitir que o usuário visualize os demonstrativos na tela e os exporte em PDF (com logo Rotta) e em Excel.
- **RF-16:** O sistema deve recalcular automaticamente o período quando um arquivo novo for importado sobre um período já processado, preservando as edições manuais anteriores.
- **RF-17:** O sistema deve listar os valores que foram atualizados após um recálculo automático, sinalizando as edições manuais preservadas.
- **RF-18:** O sistema deve suportar ciclos de atualização mensal, semanal e diário, mantendo o fechamento mensal como objetivo padrão.
- **RF-19:** O sistema deve registrar em trilha de auditoria as ações relevantes (aprovações, edições, gerações de demonstrativos) para rastreabilidade interna, acessível ao Admin.

## 6. Requisitos não-funcionais

- **Performance:** A leitura de um balancete e a exibição das contas em tabela editável devem ocorrer em tempo compatível com "uma única sessão de uso"; o parsing pesado de PDF/Excel roda de forma assíncrona em Edge Functions, com feedback de status (pendente → processando → processado).
- **Disponibilidade:** Plataforma web publicada via Lovable com backend Supabase gerenciado; alvo de disponibilidade adequado a uso interno em horário comercial, com recálculo noturno via Cron para períodos com arquivos novos não consolidados.
- **Segurança:** Autenticação por email/senha sem cadastro aberto (apenas Admin cria contas); RLS habilitado em todas as tabelas com isolamento por papel (Admin/Usuário); chaves de APIs de IA e integrações nunca expostas no frontend, sempre em Edge Functions; buckets de Storage privados com acesso por signed URL.
- **Integridade contábil:** Nada é reclassificado sem aprovação; edições manuais são imutáveis frente ao recálculo automático; logs de recálculo e trilha de auditoria são registros imutáveis (sem update/delete).
- **LGPD / dados pessoais:** O sistema não gerencia dados de clientes finais; os dados pessoais tratados limitam-se aos usuários internos (nome, email, papel). Ainda assim, aplicam-se controle de acesso por papel, trilha de auditoria e armazenamento em provedor gerenciado. Documentos financeiros ficam em Storage privado, restrito a usuários autenticados.

## 7. Métricas de sucesso

1. **Fechamento em sessão única:** ≥ 90% dos períodos têm balancete importado, revisado e DRE/Balanço/Fluxo de Caixa gerados sem sair da plataforma na mesma sessão.
2. **Precisão crescente da IA:** redução mês a mês do percentual de sugestões de reclassificação rejeitadas, tendendo a ≤ 15% após 3 fechamentos (efeito do aprendizado do padrão da empresa).
3. **Cobertura de classificação:** 100% das contas do período classificadas em uma das 8 naturezas antes da geração dos demonstrativos.
4. **Rastreabilidade de recálculo:** 100% das reimportações sobre período processado geram lista de valores atualizados com edições manuais preservadas e sinalizadas.
5. **Adoção de ciclo curto:** pelo menos 1 atualização semanal ou diária por período de fechamento, comprovando o uso do cenário de análise em ciclo mais curto.

## 8. Fora de escopo

- **Integração via API com o G2 ou com o Sicoob** — confirmado que não há API; toda entrada é manual por importação de arquivos.
- **Relatórios de manutenção e ajuste periódico** — listado como funcionalidade futura.
- **Comparativo entre períodos** — funcionalidade futura (o MVP foca em um período por vez, embora armazene o histórico).
- **Exportação para ferramentas de BI externas (Power BI, Looker)** — futuro; o MVP entrega BI interno com indicadores e gráficos.
- **Integração com outros sistemas** de gestão além do fluxo de importação manual.
- **Correção automática na origem (G2):** o Painel de Apontamentos apenas orienta o ajuste no G2, não altera o sistema de origem.
- **Usuários externos** (contador/auditor externo com acesso à plataforma): no MVP o acesso é exclusivamente da equipe interna com papéis Admin e Usuário.

---

## Extensão do escopo — Razão contábil

- **RF-R1:** importar o razão contábil do período por PDF, CSV, XLSX ou XLS, com mapeamento de colunas, validação e pré-visualização antes de gravar.
- **RF-R2:** manter um plano unificado de-para (código reduzido → código hierárquico → natureza), reaproveitado entre períodos.
- **RF-R3:** casar automaticamente razão × balancete e apresentar as pendências com causa provável e ação sugerida.
- **RF-R4:** visualizar o extrato da conta com contrapartida nomeada e o lançamento completo com conferência débito = crédito.
- **RF-R5:** calcular indicadores e demonstrativos a partir do razão quando houver razão importado, indicando a fonte.
- **RF-R6:** registrar em trilha imutável toda alteração de vínculo, natureza e classificação aplicada.
- **RF-R7:** exportar extrato, lançamento e pendências em CSV e PDF, respeitando filtros e permissões.
- **RF-R8:** disponibilizar os Agentes Contador e CFO com ferramentas de leitura do razão; o Contador propõe e apenas o Admin aplica.
