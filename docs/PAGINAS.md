# Documentação de Páginas — Rotta Financeiro (ERP Financeiro MVP)

> Frontend gerado no **Lovable** (React + Tailwind + shadcn/ui) com integração nativa ao **Supabase**. Toda a lógica pesada (parsing de PDF/Excel, reclassificação por IA, geração de demonstrativos) roda em **Supabase Edge Functions**, invisível ao usuário final. Autenticação por email/senha da equipe interna; isolamento por papel (**Admin** e **Usuário**), single-tenant (uma empresa: Rotta).

Convenções de estados usadas em todas as páginas:
- **Vazio:** nenhum registro criado ainda — mostra ilustração/placeholder e chamada para a próxima ação.
- **Carregando:** skeletons (shimmer) nas listas, tabelas e cards enquanto os dados vêm do Supabase.
- **Erro:** banner vermelho com mensagem amigável e botão "Tentar novamente"; erros de permissão redirecionam ou exibem aviso de acesso negado.

---

### /login

- **Rota:** `/login`
- **Propósito:** Autenticar os membros internos do Rotta por email e senha para acessar a plataforma.
- **Seções da tela:**
  - Logo do Rotta / Rota Alimentos e nome da plataforma "Rotta Financeiro".
  - Formulário de login: campo de email, campo de senha, botão "Entrar".
  - Link "Esqueci minha senha" (fluxo de recuperação via email).
  - Rodapé discreto (versão do app / MVP).
- **Estados:**
  - **Vazio:** formulário limpo pronto para preenchimento (estado padrão).
  - **Carregando:** botão "Entrar" com spinner e campos desabilitados durante a validação.
  - **Erro:** mensagem inline "Email ou senha inválidos" ou "Usuário desativado — contate o Admin"; sem revelar qual campo falhou por segurança.
- **Permissões:** Pública (não autenticado). Não há cadastro aberto — contas são criadas apenas pelo Admin em `/usuarios`. Após login, o usuário é redirecionado ao `/dashboard`.

---

### /dashboard

- **Rota:** `/dashboard`
- **Propósito:** Apresentar o painel de resultado e o BI com indicadores financeiros e gráficos do período selecionado.
- **Seções da tela:**
  - Seletor de período contábil (dropdown alimentado por `accounting_periods`) no topo.
  - Cards de indicadores principais: margem bruta, EBITDA, resultado líquido, posição de caixa, receita total, custo total (de `dashboard_indicators`).
  - Gráficos de BI: composição de receita x custo x despesa, evolução da posição de caixa, barras/pizza por natureza contábil.
  - Bloco de status do período: contagem de sugestões pendentes, apontamentos abertos e se os demonstrativos já foram gerados (via `get_period_summary`).
  - Atalhos rápidos: "Importar arquivos", "Revisar balancete", "Gerar demonstrativos".
- **Estados:**
  - **Vazio:** quando o período não tem indicadores calculados ainda — mensagem "Nenhum indicador calculado para este período" com botão "Gerar demonstrativos" (se houver lançamentos) ou "Importar arquivos".
  - **Carregando:** skeletons nos cards e placeholders de gráfico enquanto `dashboard_indicators` e `financial_statements` carregam.
  - **Erro:** banner "Não foi possível carregar os indicadores" com botão "Tentar novamente".
- **Permissões:** Admin e Usuário podem visualizar. Sem diferença de conteúdo por papel — ambos apenas consultam os indicadores e gráficos.

---

### /periodos

- **Rota:** `/periodos`
- **Propósito:** Listar, criar e gerenciar os períodos contábeis de fechamento sobre os quais os arquivos são importados.
- **Seções da tela:**
  - Lista/tabela de períodos: label (ex.: "Janeiro/2026"), mês de referência, status (aberto / em revisão / fechado), data do último recálculo, quem criou.
  - Botão "Novo período" (abre modal com label e mês de referência).
  - Badges de status coloridos e ações por linha: "Selecionar", "Editar status" (Admin), "Ver resumo".
  - Painel lateral/resumo do período selecionado: sugestões pendentes, apontamentos abertos, demonstrativos gerados.
- **Estados:**
  - **Vazio:** "Nenhum período criado ainda" com botão destacado "Criar primeiro período" (visível a Admin).
  - **Carregando:** skeleton de linhas na tabela.
  - **Erro:** banner de erro com "Tentar novamente".
- **Permissões:** Admin e Usuário podem visualizar e selecionar períodos. Apenas **Admin** pode criar, editar status (aberto/em revisão/fechado) e excluir períodos — para o Usuário os botões de criação/edição de status ficam ocultos ou desabilitados.

---

### /importar

- **Rota:** `/importar`
- **Propósito:** Fazer upload dos arquivos PDF/Excel exportados do G2 e do Sicoob e acompanhar o processamento por IA.
- **Seções da tela:**
  - Seletor de período de destino da importação.
  - Área de upload (drag-and-drop + botão) com seleção do tipo de arquivo: balancete, pedido de compra, nota fiscal, romaneio de abate, contas a pagar, contas a receber, relatório de vendas, extrato Sicoob.
  - Lista de arquivos importados no período: nome original, tipo, status de processamento (pendente / processando / processado / erro), quem subiu, data.
  - Indicador de progresso do parsing (Realtime) e mensagem de recálculo automático quando o arquivo cai sobre período já processado ("Valores atualizados — ver em Atualizações").
  - Detalhe de erro por arquivo (mensagem de `processing_error`) com opção de reenviar.
- **Estados:**
  - **Vazio:** "Nenhum arquivo importado neste período" com área de upload em destaque.
  - **Carregando:** barra de progresso do upload e badge "processando" atualizado em tempo real via Supabase Realtime.
  - **Erro:** linha marcada em vermelho com o motivo do erro de parsing e botão "Reprocessar"; erro de upload exibe banner.
- **Permissões:** Admin e Usuário podem importar arquivos. O Usuário pode atualizar/excluir apenas os arquivos que ele mesmo subiu; o **Admin** pode excluir qualquer arquivo.

---

### /balancete

- **Rota:** `/balancete`
- **Propósito:** Revisar e editar manualmente os lançamentos do balancete importado — valores, natureza e reclassificação de contas.
- **Seções da tela:**
  - Seletor de período.
  - Tabela editável central (de `ledger_entries`): conta de origem, valor bruto importado, valor revisado (editável), natureza aplicada (dropdown com as 8 naturezas), data do lançamento, indicador de edição manual.
  - Destaque visual das linhas com edição manual (`is_manually_edited`) e das linhas sem natureza definida.
  - Filtros e busca: por natureza, por arquivo de origem, por status (editado / sem natureza).
  - Ações em massa: aplicar natureza a várias linhas, exportar seleção.
  - Botão "Gerar demonstrativos" (dispara `generate-statements`).
- **Estados:**
  - **Vazio:** "Nenhum lançamento importado neste período" com botão "Importar arquivos".
  - **Carregando:** skeleton da tabela.
  - **Erro:** banner de erro ao salvar edição (com retry) mantendo o valor digitado; erro geral de carregamento com "Tentar novamente".
- **Permissões:** Admin e Usuário podem visualizar e **editar** valores/lançamentos (a edição manual prevalece sobre o dado bruto). Apenas **Admin** pode excluir lançamentos. Reclassificação de natureza confirmada segue as regras do plano de contas (definição definitiva é do Admin).

---

### /reclassificacoes

- **Rota:** `/reclassificacoes`
- **Propósito:** Exibir as sugestões de reclassificação geradas pela IA para o Admin aprovar ou rejeitar, alimentando o padrão da empresa.
- **Seções da tela:**
  - Seletor de período.
  - Lista de sugestões (`reclassification_suggestions`): conta, natureza atual → natureza sugerida, justificativa da IA (`reasoning`), score de confiança, status (pendente / aprovada / rejeitada).
  - Botões por linha: "Aprovar" e "Rejeitar" (dispara `apply-reclassification-decision`).
  - Ações em massa: aprovar/rejeitar várias sugestões de uma vez.
  - Filtro por status e por faixa de confiança.
  - Aviso explicativo: "Cada decisão treina o padrão de classificação do Rotta".
- **Estados:**
  - **Vazio:** "Nenhuma sugestão pendente" (quando tudo foi decidido ou ainda não houve parsing).
  - **Carregando:** skeleton das linhas de sugestão.
  - **Erro:** banner ao falhar a aprovação/rejeição, mantendo a sugestão como pendente e permitindo nova tentativa.
- **Permissões:** Admin e Usuário podem **visualizar** as sugestões. Apenas **Admin** pode aprovar/rejeitar (os botões de decisão ficam ocultos/desabilitados para o Usuário) — regra: só o Admin define o mapeamento e alimenta o aprendizado.

---

### /plano-de-contas

- **Rota:** `/plano-de-contas`
- **Propósito:** Mapear cada conta do plano do Rotta (sem padrão) para uma das oito naturezas contábeis oficiais.
- **Seções da tela:**
  - Tabela do plano de contas (`chart_of_accounts`): código de origem, descrição original do G2, natureza mapeada (dropdown), status confirmado, vezes confirmado (`times_confirmed`), confiança da última sugestão.
  - Filtros: contas não confirmadas, por natureza, busca por nome/código.
  - Ação por linha: definir/alterar natureza e marcar como confirmada.
  - Indicador de progresso do mapeamento (ex.: "42 de 60 contas confirmadas").
- **Estados:**
  - **Vazio:** "Nenhuma conta mapeada ainda — importe um balancete para começar" com atalho para `/importar`.
  - **Carregando:** skeleton da tabela.
  - **Erro:** banner de erro ao salvar mapeamento, com retry.
- **Permissões:** Admin e Usuário podem **visualizar**. Apenas **Admin** pode criar, editar e confirmar o mapeamento (INSERT/UPDATE/DELETE restritos a Admin por RLS) — para o Usuário a tabela é somente leitura.

---

### /apontamentos

- **Rota:** `/apontamentos`
- **Propósito:** Listar inconsistências e erros detectados, com sugestões de correção na origem (G2), para marcação de resolvido/ignorado.
- **Seções da tela:**
  - Seletor de período.
  - Lista de apontamentos (`audit_findings`): tipo (conta mal classificada, lançamento incorreto, valor divergente, conta sem natureza, duplicidade), descrição, sugestão de correção no G2, severidade (baixa/média/alta), status.
  - Filtros por tipo, severidade e status (aberto / resolvido / ignorado).
  - Ações por item: "Marcar como resolvido", "Ignorar".
  - Contadores/resumo por severidade no topo.
- **Estados:**
  - **Vazio:** "Nenhuma inconsistência encontrada neste período" (mensagem positiva) — indica que os dados estão consistentes ou que ainda não houve detecção.
  - **Carregando:** skeleton da lista.
  - **Erro:** banner com retry ao carregar; erro ao atualizar status mantém o item no estado anterior.
- **Permissões:** Admin e Usuário podem visualizar e **marcar resolvido/ignorado**. Apenas **Admin** pode excluir apontamentos. Sem diferença relevante de conteúdo por papel além da exclusão.

---

### /demonstrativos

- **Rota:** `/demonstrativos`
- **Propósito:** Visualizar DRE, Balanço Patrimonial e Fluxo de Caixa estruturados e exportá-los em PDF e Excel.
- **Seções da tela:**
  - Seletor de período.
  - Abas ou navegação entre os três demonstrativos: DRE, Balanço Patrimonial, Fluxo de Caixa (renderizados a partir do JSON de `financial_statements`).
  - Tabela hierárquica de grupos/linhas/valores para cada demonstrativo, com subtotais e totais.
  - Botão "Gerar/Atualizar demonstrativos" (dispara `generate-statements`) e data da última geração.
  - Botões "Exportar PDF" (com logo do Rotta) e "Exportar Excel" (dispara `export-report`, download via signed URL do bucket `exports`).
- **Estados:**
  - **Vazio:** "Demonstrativos ainda não gerados para este período" com botão "Gerar demonstrativos" (habilitado quando há lançamentos classificados).
  - **Carregando:** skeleton das tabelas; botões de exportação com spinner durante a geração do arquivo.
  - **Erro:** banner "Falha ao gerar/exportar" com retry; caso não haja lançamentos suficientes, aviso orientando revisar o balancete.
- **Permissões:** Admin e Usuário podem visualizar, gerar e exportar os demonstrativos. Sem diferença de conteúdo por papel.

---

### /atualizacoes

- **Rota:** `/atualizacoes`
- **Propósito:** Mostrar a lista de valores que foram atualizados após reimportações sobre um período já processado, sinalizando edições manuais preservadas.
- **Seções da tela:**
  - Seletor de período.
  - Lista de diffs (`recalculation_logs`): lançamento afetado, campo alterado (valor bruto, natureza), valor anterior → novo valor, arquivo de origem da atualização, data.
  - Destaque para linhas onde a edição manual foi **preservada** (`manual_edit_preserved`).
  - Filtro por arquivo de origem e por data do recálculo.
  - Resumo no topo: "X valores atualizados na última reimportação".
- **Estados:**
  - **Vazio:** "Nenhuma atualização registrada — nada foi reprocessado ainda neste período".
  - **Carregando:** skeleton da lista.
  - **Erro:** banner com retry.
- **Permissões:** Admin e Usuário podem visualizar (registro imutável, somente leitura). Sem diferença de conteúdo por papel.

---

### /usuarios

- **Rota:** `/usuarios`
- **Propósito:** Cadastrar, editar e desativar usuários internos e definir o papel de cada um (Admin ou Usuário).
- **Seções da tela:**
  - Tabela de usuários (`profiles`): nome completo, email, papel (Admin/Usuário), status ativo/inativo, data de criação.
  - Botão "Novo usuário" (abre modal com nome, email e papel; dispara `manage-user`, que envia convite por email via Resend).
  - Ações por linha: editar papel, ativar/desativar, reenviar convite.
  - Filtros por papel e status.
- **Estados:**
  - **Vazio:** "Nenhum usuário cadastrado além de você" com botão "Adicionar usuário".
  - **Carregando:** skeleton da tabela.
  - **Erro:** banner ao falhar a criação/edição (ex.: email já existente) com mensagem clara e retry.
- **Permissões:** **Somente Admin** acessa esta página. O Usuário que tentar acessar recebe aviso de acesso negado e é redirecionado ao `/dashboard`. Todas as operações de gestão de contas são exclusivas do Admin (RLS + Edge Function `manage-user` com service role).

---

### /razao

- **Rota:** `/razao`
- **Propósito:** Gerenciar os lançamentos do razão contábil do período — a fonte do movimento. Desde 08/2026 a tela é **única** (sem abas): apenas o gerenciador de Lançamentos.
- **Seções da tela:**
  - **Grade de lançamentos:** um movimento por linha (cód. mov., documento, conta débito, conta crédito, data, valor, histórico), com busca livre, filtros por data/conta, paginação e totais no rodapé. Exporta CSV e PDF.
  - **Abertura leve:** a grade abre já filtrada pelo **último dia com lançamento** do período (data inicial = data final = esse dia). O usuário amplia ou reduz o volume apenas mudando as datas nos filtros.
  - **Ordenação na tela:** clicar no cabeçalho (Doc, Conta débito, Conta crédito, Data, Valor, Histórico) reordena as linhas já carregadas, sem nova consulta ao banco; a seta indica o sentido.
  - **Cabeçalho ajustável:** cada coluna pode ser redimensionada arrastando a borda direita (duplo clique volta ao padrão) e a preferência fica salva no navegador, junto com a densidade.
  - **Densidade:** botão Compacto/Confortável altera a altura das linhas — o modo compacto exibe cerca de 40% mais lançamentos por tela.
  - **Partida e contrapartida:** a conta de débito recebe chip âmbar e a de crédito chip verde, tornando imediata a leitura dos dois lados de cada lançamento.
  - **Comandos:** Novo, Editar, Cancelar reg. (habilitados para Admin em período aberto) e Principal, que abre o documento inteiro com todas as pernas e a conferência débito = crédito.
- **Desativado na interface:** as antigas abas Extrato, Conferência, Pendências, Vínculos e Histórico foram retiradas. As RPCs correspondentes (`journal_account_statement`, `reconcile_journal_vs_trial_balance`, `journal_pending_report`, `link_reduced_accounts`, `set_account_link`, `journal_top_counterparts`) permanecem no banco e nas server functions, usadas pela importação, pelo recálculo e pelos Agentes de IA.
- **Estados:** vazio ("Nenhum razão importado neste período" com atalho para `/importar`), skeleton no carregamento e banner de erro com retry.
- **Permissões:** todos os autenticados visualizam e exportam; apenas Admin cria, edita e cancela lançamentos.


---

### /importar — passo de mapeamento de colunas (razão em planilha)

Ao escolher o tipo "Razão contábil" e enviar `.csv`, `.xlsx` ou `.xls`, aparece a tela de **mapeamento**: cada campo do razão (conta reduzida, nome, saldo anterior, data, número do lançamento, contrapartida, histórico, débito, crédito, saldo acumulado) é associado a uma coluna do arquivo, com pré-seleção por semelhança de nome. Conta reduzida, débito e crédito são obrigatórios. Segue a pré-visualização paginada com valores em Real e datas normalizadas, e o resumo de validação "X linhas válidas / Y com problema" com a lista dos erros e a linha original. O mapeamento fica lembrado para as próximas importações.

---

### /agentes

- **Rota:** `/agentes` e `/agentes/{threadId}`
- **Propósito:** Conversar com o **Agente Contador** (operacional, classificação e conferência) e o **Agente CFO** (leitura executiva, somente leitura).
- **Seções:** lista de conversas na lateral, chat com streaming e markdown, blocos indicando qual ferramenta foi consultada, atalhos rápidos e cartões de proposta com evidência de contrapartida e botão "Aplicar" visível apenas para Admin.
- **Permissões:** todos conversam; apenas Admin aplica propostas, e toda aplicação é registrada em `activity_log` e na trilha de auditoria.

## /demonstrativos — painel lateral de lançamentos

Clicar em uma linha da DRE, do Balanço ou do Fluxo abre um painel lateral redimensionável na própria tela (largura salva no navegador, fecha com Esc), listando os lançamentos que compõem a linha. No painel: busca livre, alternar "Mostrar ocultos", editar (data, documento, valor, histórico), reclassificar trocando as contas de débito/crédito, ocultar/reexibir o lançamento em todos os relatórios (com motivo), cancelar o lançamento e comentar (histórico com autor e data). O ícone de link externo abre o razão filtrado em uma nova aba. Um aviso no topo mostra quantos lançamentos estão ocultos no período e o valor total.

Cada linha da DRE, do Balanço e do Fluxo com contas vinculadas é expansível: abre a hierarquia do plano de contas (4 → 4.01 → 4.01.01 → conta analítica) com o valor de cada nível. Clicar na conta analítica abre o painel de lançamentos filtrado nela; o ícone de árvore ao lado de um grupo abre o painel com todas as contas do grupo somadas.
