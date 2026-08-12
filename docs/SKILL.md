## Convenções

Este é o guia operacional para construir o **Rotta Financeiro** — ERP financeiro MVP do **Frigorífico Rotta das Carnes (Rota Alimentos)**. Leia antes de escrever qualquer linha de código ou prompt de geração.

**Stack (não negociável):**
- **Backend: sempre Supabase** — PostgreSQL gerenciado + RLS + Auth (email/senha da equipe interna) + Storage (arquivos PDF/Excel importados do G2 e Sicoob) + Edge Functions em Deno (parsing de PDF/Excel, reclassificação por IA, geração de DRE/Balanço/Fluxo de Caixa) + Realtime (atualizar a tela quando um reprocessamento termina) + Cron (pg_cron) para recálculos e limpezas agendadas.
- **Frontend: Lovable** (React + Tailwind + shadcn/ui, integração nativa com Supabase). **Por quê Lovable e não Claude Code:** o usuário-alvo é o **gestor de operações do frigorífico, com domínio de processos financeiros mas sem perfil técnico**, e não há time de TI dedicado descrito no dossiê. O Lovable entrega interface de tabelas editáveis, upload e dashboards no caminho mais rápido do zero ao ar, com deploy e preview. Toda a lógica pesada fica escondida em Edge Functions — o gestor só importa, revisa, corrige e gera relatório.

**Nomenclatura (obrigatória, o pacote inteiro depende disso):**
- Banco de dados (tabelas, colunas, RPCs): **inglês, `snake_case`** — ex.: `chart_of_accounts`, `ledger_entries`, `reclassification_suggestions`, `financial_statements`.
- Edge Functions e rotas HTTP: **`kebab-case`** — ex.: `import-file`, `reclassify-accounts`, `generate-statements`.
- A fonte canônica de nomes é **db/schemas.sql** (tabelas/colunas) e **docs/FUNCTIONS.md** (functions). O **docs/DEPARA.md** é o checklist que amarra os três (DB → Functions → Páginas). Se um nome divergir entre documentos, o DEPARA vence — corrija a divergência, não crie um nome novo.

**Modelo de acesso:** single-tenant (uma empresa: Rotta). Isolamento **por papel**, não por organização — dois papéis: **Admin** e **Usuário**, ambos internos (confirmado na resposta 1). O helper `is_admin()` (`SECURITY DEFINER`, lê `profiles.role`) governa as RLS policies.

**IA (modelos por tarefa):** a leitura/interpretação de PDF e Excel do balancete G2 e o mapeamento de plano de contas exigem qualidade e contexto longo — use **Gemini 2.5 Pro** (1M tokens, multimodal nativo, ótimo custo para documentos grandes) como motor de parsing e reclassificação. Para as sugestões interativas e apontamentos de inconsistência de volume menor, **Claude Sonnet 4.6** equilibra qualidade e custo. Todas as chamadas de IA passam por Edge Functions — nunca do frontend.

## Ordem de implementação recomendada

Siga as fases de **docs/PLANO.md**. Sequência concreta:

1. **Fundação (Fase 1 do PLANO):** criar projeto no Lovable + subir **todo** o `db/schemas.sql` no Supabase de uma vez (todas as tabelas: `profiles`, `accounting_periods`, `imported_files`, `chart_of_accounts`, `ledger_entries`, `reclassification_suggestions`, `audit_findings`, `financial_statements`, `dashboard_indicators`, `recalculation_logs`, `activity_log`), com **RLS habilitada e policies em cada tabela** + helper `is_admin()` + triggers de `updated_at`. Configurar Auth email/senha e o layout base (menu lateral, header, controle de acesso Admin/Usuário).
2. **Auth + gestão de usuários:** cadastro interno de Admin/Usuário, `profiles` espelhando `auth.users`, roteamento protegido por papel.
3. **Períodos + Upload:** gestão de `accounting_periods` (abrir/selecionar/fechar) e a página de upload gravando em Storage + `imported_files`. Sem parsing ainda — só receber e listar arquivos.
4. **Parsing (Edge Functions):** `import-file` lê PDF/Excel, extrai lançamentos para `ledger_entries`. Como o balancete tem **layout constante** (resposta 3), calibre o parser para esse layout fixo.
5. **Mapeamento + Reclassificação:** `reclassify-accounts` mapeia o plano de contas próprio do Rotta (sem padrão — resposta 3) para as naturezas contábeis e grava **sugestões** em `reclassification_suggestions` para o usuário aprovar. Aprovações alimentam o padrão da empresa (resposta 2).
6. **Demonstrativos:** `generate-statements` produz DRE, Balanço Patrimonial e Fluxo de Caixa em `financial_statements`; `audit_findings` para o painel de apontamentos.
7. **Dashboard + Exportação:** indicadores (`dashboard_indicators`: margem bruta, EBITDA, resultado líquido, posição de caixa), BI com gráficos, exportação PDF/Excel (resposta 4).
8. **Reprocessamento automático + Cron:** ao subir arquivo sobre período já processado, recalcular automaticamente e **listar os valores atualizados** (resposta 5); `recalculation_logs` registra o diff. Cron para consolidação diária/semanal (cenário de análise diária desejado).
9. **Polimento:** estados vazio/erro/loading, Realtime na conclusão de processamento, revisão de RLS.

## Como usar cada documento durante o desenvolvimento

- **docs/PRD.md** — leia primeiro e sempre que dúvida de escopo surgir. Define o que é MVP (upload, edição do balancete, classificação por natureza, DRE/Balanço/Fluxo, painel de apontamentos, dashboard) e o que é **futuro** (comparativo entre períodos, exportação para Power BI/Looker, integrações). Não construa nada da lista "futuro" no MVP.
- **db/schemas.sql** — **antes de criar qualquer tabela ou coluna**, confira aqui. Toda tabela do sistema já está definida. Se acha que precisa de uma tabela nova, quase certamente ela já existe com outro nome — procure primeiro.
- **docs/DEPARA.md** — **antes de nomear uma function, tabela ou página**, use como checklist de rastreabilidade (DB → Functions → Páginas). Garante que nada fica órfão e que os nomes batem entre camadas. Consulte também ao terminar uma etapa, para confirmar que a tabela/function nova está ligada a uma página.
- **docs/FUNCTIONS.md** — **antes de escrever qualquer Edge Function, RPC ou Cron Job**. Traz assinaturas, autenticação (público / usuário logado / admin) e itens marcados **[EXTENSÃO]**. Não invente endpoints fora daqui.
- **docs/PAGINAS.md** — **antes de gerar qualquer tela no Lovable**, releia a seção da página específica. Define layout, estados (vazio/erro/loading) e quais dados/funções a página consome.
- **docs/PLANO.md** — seu roteiro de fases. Consulte no início de cada etapa para saber o entregável e as tabelas envolvidas.
- **docs/PRS.md** — quando precisar validar um comportamento técnico testável. Cada RS rastreia um RF (RF-01 auth, RF-02 períodos, RF-03 upload, RF-04 parsing, RF-05 mapeamento de plano de contas…). Use para escrever critérios de aceite.

## Gates de qualidade

Antes de considerar qualquer etapa "pronta", verifique:

- [ ] **RLS habilitada** em toda tabela nova, com policies explícitas por operação (select/insert/update/delete) usando `is_admin()` onde a operação for restrita a Admin. Nenhuma tabela sai sem RLS.
- [ ] **Nomenclatura bate com docs/DEPARA.md** — tabela/coluna em `snake_case` inglês, Edge Function/rota em `kebab-case`. Sem divergências entre camadas.
- [ ] **Estados vazio, erro e loading** implementados em toda página (convenção do docs/PAGINAS.md) — especialmente na tela de upload e nas tabelas editáveis de balancete.
- [ ] **Papéis respeitados** — Admin e Usuário conforme resposta 1; nenhuma ação de Admin exposta ao Usuário.
- [ ] **Fluxo de aprovação da IA** — reclassificação entra como **sugestão** em `reclassification_suggestions`, o usuário aprova/rejeita, e a decisão realimenta o padrão da empresa (resposta 2). A IA **nunca** aplica reclassificação direto sem aprovação.
- [ ] **Reprocessamento** — ao importar arquivo sobre período já processado, o sistema recalcula automaticamente **e lista quais valores mudaram** (resposta 5), registrando em `recalculation_logs`.
- [ ] **Tabelas editáveis** de fato editáveis — o gestor precisa ajustar valores, reclassificar contas e corrigir lançamentos manualmente (critério de sucesso do MVP).
- [ ] **Exportação** disponível em PDF, Excel e visualização em tela para DRE/Balanço/Fluxo (resposta 4).
- [ ] **Chamadas de IA e parsing rodam em Edge Functions**, nunca no frontend; chaves de API nunca no cliente.
- [ ] **Critério de sucesso do MVP validado de ponta a ponta:** importar balancete G2 → visualizar contas → reclassificar → editar valores → gerar DRE, Balanço e Fluxo, tudo em uma única sessão.

## O que NÃO fazer

- **Não trocar o banco.** É Supabase/PostgreSQL. Nada de Firebase, MongoDB, PlanetScale ou planilha como "banco".
- **Não criar tabela fora de db/schemas.sql.** Se falta algo, confira DEPARA e schemas antes — o nome provavelmente já existe. Só estenda com justificativa e atualize o DEPARA.
- **Não pular RLS "por enquanto".** Dado financeiro do frigorífico não fica sem policy nem em ambiente de teste.
- **Não misturar os papéis** Admin e Usuário definidos na resposta 1 — não dê poder de Admin ao Usuário nem esconda do Admin o que ele precisa gerenciar.
- **Não deixar a IA aplicar reclassificação automaticamente sem aprovação** — o padrão é sugerir → aprovar → treinar (resposta 2).
- **Não assumir plano de contas padrão CFC/CPC no import.** O plano de contas do Rotta **não tem padrão** e precisa ser mapeado (resposta 3); o padrão contábil é o destino, não a origem.
- **Não construir funcionalidades "futuras"** no MVP: comparativo entre períodos, exportação nativa para Power BI/Looker, integração com outros sistemas ou API com o G2. **Não há API do G2** — toda entrada é importação manual de arquivo.
- **Não recomendar Next.js/Vue/Angular** — o frontend é React gerado pelo Lovable.
- **Não usar N8N nem Zapier** para automação. Se precisar de automação: Make (no-code) ou Edge Functions + Cron (pg_cron).
- **Não colocar parsing de PDF/Excel nem chamadas de IA no frontend** — isso vive em Edge Functions.
- **Não usar linguagem genérica** ("o sistema", "a plataforma") nos artefatos entregáveis quando o nome real é **Rotta Financeiro**.