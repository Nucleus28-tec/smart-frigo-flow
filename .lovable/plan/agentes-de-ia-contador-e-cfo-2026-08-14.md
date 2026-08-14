# Agentes de IA: Contador e CFO

## Como a IA funciona hoje (e o que muda)

Hoje a IA do Rotta é **pontual**: cada tela chama uma função no servidor que faz
uma pergunta única ao modelo e devolve um resultado (ler PDF do balancete, sugerir
reclassificação). Não há conversa, não há memória e o modelo não consulta o banco —
ele só recebe o texto que a função montou. O roteador (`ai-router.server.ts`) escolhe
entre Gemini próprio e Lovable AI Gateway, com fallback automático.

Os agentes reaproveitam exatamente essa base: mesmo roteador, mesmo fallback, mesma
troca de provedor no cabeçalho. A diferença é que o agente **conversa** e tem
**ferramentas**: em vez de receber um texto pronto, ele decide sozinho quais dados do
período buscar (balancete, plano de contas, indicadores, demonstrativos, apontamentos)
e responde com base neles.

## Os dois agentes

| | Agente Contador | Agente CFO |
| --- | --- | --- |
| Foco | Classificação contábil, plano de contas, conferência, obrigações | Leitura estratégica: DRE gerencial, indicadores, risco, recomendação |
| Horizonte | Operacional, conta a conta | Consolidado e executivo |
| Autonomia | Sugere e propõe ações; só grava com o botão "Aplicar" | Somente leitura — nunca grava |
| Dados | Balancete, plano de contas, sugestões, apontamentos | Demonstrativos, indicadores, comparação entre períodos |

## Nova tela `/agentes`

- Lista de conversas (threads) na lateral, com botão "Nova conversa" e escolha do
  agente (Contador ou CFO) na criação.
- Cada conversa tem URL própria (`/agentes/{id}`) — recarregar mantém o histórico.
- Chat com streaming, indicador de digitação, markdown e blocos mostrando qual
  ferramenta o agente consultou ("consultou o balancete de Janeiro/2026").
- O agente sempre trabalha no período selecionado no topo do sistema.
- Atalhos rápidos: "Conferir o fechamento", "Contas sem natureza", "Resumo executivo
  do mês", "O que mudou vs. mês anterior".

## Ações com aprovação (só Contador)

Quando o agente propõe uma alteração, ele **não grava**. Aparece um cartão no chat com
a mudança proposta e um botão "Aplicar" (visível apenas para Admin). Ações previstas:

1. Classificar contas em massa (definir natureza).
2. Criar sugestões de reclassificação para a fila existente.
3. Abrir apontamento (audit finding) sobre uma inconsistência.

Toda aplicação é registrada em `activity_log`, mantendo a regra "nada é aplicado
silenciosamente".

## Alta performance

- Ferramentas devolvem dados **agregados** (subtotais por natureza, top contas,
  indicadores) em vez de despejar milhares de linhas no modelo.
- Consultas paginadas e limitadas por período; nada de varredura global.
- Respostas em streaming, para o usuário ver o texto surgindo.
- Cache do resumo do período por conversa, evitando reconsultar o banco a cada turno.
- Limite de passos do agente por resposta, com aviso claro em erro de cota/crédito.

## Detalhes técnicos

- Banco: novas tabelas `agent_threads` (usuário, agente, período, título) e
  `agent_messages` (papel, partes da mensagem em JSONB), com RLS por usuário
  (`auth.uid()`) e leitura ampla para Admin; GRANTs para `authenticated` e
  `service_role`.
- Servidor: rota de streaming `src/routes/api/agents/chat.ts` usando AI SDK
  (`streamText` + `toUIMessageStreamResponse`), com o provedor resolvido pelo mesmo
  ajuste global de IA já existente (Gemini próprio ou Lovable Gateway).
- Ferramentas em `src/lib/agents/tools/*.server.ts`, todas somente leitura, chamando
  as RPCs já existentes (`get_period_summary`, `generate_period_statements`,
  indicadores) e consultas ao balancete/plano de contas via cliente autenticado (RLS).
- Prompts de sistema separados por agente em `src/lib/agents/personas.ts`, com as
  regras do quadro acima (CFO sem ferramentas de escrita).
- Escrita: server functions dedicadas com `requireSupabaseAuth` + verificação de Admin,
  chamadas apenas pelo botão "Aplicar" do cartão — nunca pelo modelo diretamente.
- Rotas `/_authenticated/agentes/index.tsx` e `/_authenticated/agentes/$threadId.tsx`,
  item "Agentes" no menu lateral, seguindo o design Synetica (claro/noite + hover verde).
