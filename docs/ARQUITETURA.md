# Rotta Financeiro — Arquitetura, Dados e Agentes

Documento de referência do ERP Financeiro Inteligente do Frigorífico Rota Alimentos.
Descreve o modelo de dados, a lógica de funcionamento, o papel dos agentes de IA e a
reestruturação em curso.

---

## 1. Objetivo do sistema

O G2 (sistema legado) produz balancetes em PDF/Excel que hoje são conferidos à mão.
O Rotta Financeiro existe para:

1. **Importar** esses balancetes automaticamente (leitura por IA para PDF, parser para Excel).
2. **Classificar** cada conta em uma das oito naturezas contábeis, aprendendo com as decisões.
3. **Corrigir e consolidar** valores em tela, preservando sempre a edição manual.
4. **Gerar** DRE, Balanço Patrimonial e Fluxo de Caixa, com exportação em PDF e Excel.
5. **Auditar** — nada é aplicado silenciosamente: toda alteração vinda da IA passa por aprovação
   de Admin e fica registrada.
6. **Aconselhar** — dois agentes conversacionais (Contador e CFO) que leem os dados reais do
   período e respondem em linguagem natural.

Regra estrutural do produto: **o número final é humano**. A IA propõe, o Admin decide.

---

## 2. Tabelas do banco (schema `public`)

Todas com RLS habilitada. Leitura ampla para autenticados nas tabelas operacionais; escrita
restrita a Admin via `is_admin()`.

| Tabela | Função |
| --- | --- |
| `profiles` | Espelho de `auth.users`. Guarda `full_name`, `email`, `role` (`admin`/`usuario`) e `is_active`. Criada pelo trigger `handle_new_user` — o primeiro usuário vira Admin. |
| `accounting_periods` | Períodos contábeis (`label`, `reference_month`, `status`, `last_recalculated_at`). É o eixo de tudo: toda tela trabalha sobre o período selecionado. |
| `imported_files` | Arquivos enviados ao bucket privado `imports`: tipo, caminho, MIME e `processing_status` (`pendente`/`processado`/`erro`). |
| `ledger_entries` | O balancete em si. `raw_value` (valor original do G2), `reviewed_value` (correção humana, que prevalece), `nature`, `is_manually_edited` e vínculo com `account_id`. |
| `chart_of_accounts` | Plano de contas de-para: nome da conta no G2 → natureza. Guarda `is_confirmed`, `confidence_score` e `times_confirmed` (o aprendizado do padrão). |
| `reclassification_suggestions` | Fila de sugestões da IA: natureza atual, natureza sugerida, `reasoning`, confiança e `status` (`pendente`/`aprovada`/`rejeitada`). |
| `audit_findings` | Apontamentos de inconsistência: tipo, descrição, correção sugerida, severidade e status. |
| `financial_statements` | DRE, Balanço e Fluxo de Caixa gerados, armazenados como JSONB versionado por período e tipo. |
| `dashboard_indicators` | Indicadores calculados por período: receita, custo, margem bruta, EBITDA, resultado líquido e posição de caixa. |
| `recalculation_logs` | Diário de mudanças de reimportação: campo alterado, valor antigo, valor novo e se a edição manual foi preservada. |
| `activity_log` | Trilha de auditoria de ações de usuário (quem, o quê, sobre qual entidade, com metadados). |
| `app_settings` | Configurações globais chave/valor. Hoje guarda `ai_provider` (`gemini` ou `lovable`). |
| `agent_threads` | Conversas com os agentes: usuário, agente (`contador`/`cfo`), período e título. |
| `agent_messages` | Mensagens das conversas, com as partes em JSONB (texto e chamadas de ferramenta). |

### Funções de banco relevantes

- `is_admin()` — verificação de papel usada por todas as políticas de escrita.
- `merge_file_entries()` — reimportação inteligente: compara o arquivo novo com o existente,
  insere/atualiza/remove lançamentos e **preserva `reviewed_value`**, registrando cada diff.
- `sync_accounts_for_period()` — cria contas novas no plano e religa lançamentos às naturezas.
- `recalculate_period_indicators()` — recalcula os indicadores do período.
- `generate_period_statements()` — monta DRE, Balanço e Fluxo de Caixa.
- `apply_reclassification_decision()` — aplica ou rejeita sugestão, propagando a natureza e
  incrementando `times_confirmed`.
- `nightly_refresh_periods()` — rotina noturna que recalcula períodos abertos com arquivos novos.
- `get_period_summary()` — contadores para o dashboard.

---

## 3. Lógica do sistema (fluxo operacional)

```text
Seleciona período
   ↓
Importar arquivo  →  imports (bucket privado)
   ↓
Leitura           →  PDF pela IA / Excel por parser
   ↓
merge_file_entries →  ledger_entries (+ recalculation_logs se reimportação)
   ↓
sync_accounts     →  chart_of_accounts (contas novas) + natureza herdada
   ↓
Sugestões da IA   →  reclassification_suggestions (fila pendente)
   ↓
Admin aprova      →  natureza aplicada + conta confirmada (aprendizado)
   ↓
Balancete         →  correção humana de valores (reviewed_value prevalece)
   ↓
Indicadores + Demonstrativos → dashboard, DRE/BP/FC, exportação PDF/Excel
```

Regras invioláveis:

- `reviewed_value` sempre prevalece sobre `raw_value`.
- Reimportar **nunca** apaga correção manual — apenas registra o diff.
- Nenhuma sugestão de IA entra no resultado sem aprovação de Admin.
- Toda decisão relevante gera registro em `activity_log` ou `recalculation_logs`.

---

## 4. Camada de IA

A IA opera em dois modos, sobre a mesma infraestrutura de provedor.

**Provedor único e alternável.** `app_settings.ai_provider` define se as chamadas vão para o
Gemini da conta própria ou para o Lovable AI Gateway. Há fallback automático: erro de cota,
timeout ou 5xx no provedor ativo reencaminha a chamada para o outro e registra o evento.

### 4.1 IA pontual (a base já existente)

Chamadas isoladas, com prompt fixo e resultado gravado em tabela:

- leitura do balancete em PDF → linhas do `ledger_entries`;
- sugestão de natureza por conta → `reclassification_suggestions`;
- detecção de inconsistências → `audit_findings`.

Não conversa, não tem memória, não consulta o banco por conta própria.

### 4.2 Agentes conversacionais

Os agentes reaproveitam o mesmo roteador e o mesmo fallback, mas invertem o controle: em vez de
receber um texto pronto, o agente **decide quais dados buscar** por meio de ferramentas.

---

## 5. Como os agentes operam o sistema

### Ferramentas (todas somente leitura)

| Ferramenta | O que devolve |
| --- | --- |
| `resumo_periodo` | Contagens de sugestões pendentes, apontamentos abertos, lançamentos e arquivos. |
| `balancete_por_natureza` | Subtotais agregados por natureza e as contas de maior peso. |
| `indicadores` | Receita, custo, margem, EBITDA, resultado e caixa do período. |
| `demonstrativos` | DRE, Balanço e Fluxo de Caixa já gerados. |
| `contas_sem_natureza` | Contas do plano ainda não classificadas. |
| `apontamentos` | Inconsistências abertas do período. |

As ferramentas devolvem **dados agregados**, não linhas cruas — é isso que mantém a resposta
rápida e o custo previsível mesmo com milhares de lançamentos.

### Agente Contador

- Horizonte operacional, conta a conta.
- Ferramentas de leitura + duas de **proposta**: `propor_classificacao` e `propor_apontamento`.
- Proposta **não grava nada**. Ela renderiza um cartão no chat com a mudança sugerida e um botão
  "Aplicar", visível apenas para Admin.
- Ao clicar em Aplicar, a server function `applyAgentAction` valida o papel via `is_admin()`,
  executa a alteração (natureza no plano + propagação aos lançamentos, ou criação do apontamento)
  e registra em `activity_log`.
- O modelo nunca tem credencial de escrita: o caminho de gravação é sempre o botão humano.

### Agente CFO

- Horizonte consolidado e executivo.
- Somente ferramentas de leitura. Nenhuma capacidade de escrita, nem mesmo de proposta.
- Estrutura a resposta em: leitura do número → o que explica → recomendação.
- Se o usuário pedir alteração, ele encaminha ao Agente Contador.

### Contexto e segurança

- O agente sempre trabalha no período selecionado no topo do sistema.
- O acesso ao banco usa o token do próprio usuário, então **a RLS continua valendo**: o agente
  não enxerga nada que o usuário não enxergaria.
- Conversas ficam em `agent_threads`/`agent_messages`, com RLS por `auth.uid()` e leitura ampla
  para Admin. Cada conversa tem URL própria (`/agentes/<id>`) e histórico recarregável.
- Resposta em streaming, com limite de passos por turno e aviso claro em erro de cota.

---

## 6. A reestruturação

O que mudou em relação à concepção original e por quê:

| Antes | Agora | Motivo |
| --- | --- | --- |
| Edge Functions do Supabase para toda a lógica | TanStack server functions (`createServerFn`) | Mesma linguagem do frontend, tipagem ponta a ponta, sem deploy separado. |
| Claude via provedor externo | Gemini próprio **ou** Lovable Gateway, alternável em tela | Controle de custo e continuidade operacional via fallback. |
| Envio de convite por e-mail | Link de definição de senha | Menos dependência externa no fluxo de entrada. |
| Balancete como tabela plana | Estrutura contábil real: grupos, subtotais, seções recolhíveis e conferência Ativo × Passivo+PL | A tela é onde o resultado é consolidado; precisa parecer um balancete. |
| IA pontual em cada tela | Camada de agentes com ferramentas sobre a mesma base | Permite perguntas transversais sem multiplicar telas. |
| Visual genérico | Design system Synetica: fundo claro `#F9F9F9`, acento verde, modo noite, iluminação verde no hover | Identidade própria e leitura confortável em jornada longa de conferência. |

O que **não** mudou, e não deve mudar: a soberania do dado humano, a aprovação explícita de
Admin e a rastreabilidade completa de cada alteração.

---

## 7. Páginas

| Rota | Função | Acesso |
| --- | --- | --- |
| `/dashboard` | Indicadores e gráficos do período | Todos |
| `/periodos` | Criar, selecionar e fechar períodos | Ver: todos · Editar: Admin |
| `/importar` | Upload e processamento de balancetes | Todos |
| `/balancete` | Consolidação: correção de valores e naturezas | Todos |
| `/plano-de-contas` | De-para de contas do G2 | Ver: todos · Editar: Admin |
| `/reclassificacoes` | Fila de sugestões da IA | Aprovar: Admin |
| `/apontamentos` | Inconsistências detectadas | Todos |
| `/demonstrativos` | DRE, Balanço, Fluxo + exportação | Todos |
| `/atualizacoes` | Diffs de reimportação | Todos |
| `/agentes` | Conversas com Contador e CFO | Todos · Aplicar: Admin |
| `/usuarios` | Gestão de usuários internos | Admin |
