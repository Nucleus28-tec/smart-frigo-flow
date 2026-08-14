# Configurar e testar o Gemini no Rotta

O código já está trocado: as duas chamadas de IA (leitura de PDF em `/importar` e sugestões em `/reclassificacoes`) usam `google/gemini-3.6-flash` pelo gateway da Lovable, definido em `src/lib/ai-model.ts`. Falta só destravar os créditos e ter uma forma simples de testar dentro do sistema.

## Passo 1 — Liberar os créditos (você faz, fora do código)

Hoje o gateway responde **403 — Workspace credit limit reached**. Nenhuma chamada de IA funciona até isso ser resolvido:

1. Abrir as configurações do workspace na Lovable > **Billing / Usage**.
2. Ajustar (ou remover) o limite de créditos de IA do workspace, ou adicionar créditos.
3. Só o dono/admin do workspace consegue fazer isso.

Não há nada a alterar no app: a `LOVABLE_API_KEY` já está configurada e o modelo já é válido (o erro é de limite, não de chave nem de modelo).

## Passo 2 — Tela de diagnóstico da IA

Para você conseguir testar sem depender de importar um PDF, será criada uma seção **"Status da IA"** dentro de `/atualizacoes` (visível só para Admin):

- Mostra o modelo em uso (`google/gemini-3.6-flash`).
- Botão **"Testar conexão com a IA"** que faz uma chamada mínima ao gateway e mostra o resultado:
  - **OK** — resposta do modelo e tempo de resposta.
  - **403** — "Limite de créditos do workspace atingido" com a orientação do Passo 1.
  - **429** — "Limite de uso momentâneo, tente de novo".
  - Outros — status e mensagem do gateway, sem expor a chave.

Assim, a qualquer momento dá para saber se o problema é crédito, chave ou o próprio arquivo.

## Passo 3 — Teste de ponta a ponta

Com os créditos liberados:

1. `/importar` — subir um balancete PDF no período Janeiro/2026 e acompanhar o `processing_status` até `concluido`.
2. `/balancete` — conferir que as linhas foram criadas com contas e valores corretos.
3. `/reclassificacoes` — clicar em "Gerar sugestões" e conferir natureza, justificativa e confiança preenchidas.
4. Aprovar uma sugestão e verificar que a conta fica confirmada no plano de contas.

## Detalhes técnicos

- Nova server function `testAiConnection` em `src/lib/ai.functions.ts`, protegida por `requireSupabaseAuth` + checagem de `is_admin()`, chamando `AI_GATEWAY_CHAT_URL` com `AI_MODEL`, `stream: true` e um prompt curto ("responda OK"), reaproveitando `readChatStream`.
- Retorna DTO simples: `{ ok, model, latencyMs, message }` — nunca a chave nem o corpo bruto de erro completo (apenas os primeiros 300 caracteres, como nas demais chamadas).
- Componente de status renderizado em `src/routes/_authenticated/atualizacoes.tsx`, usando os mesmos cards e badges já existentes no app.
- Sem timeout artificial na chamada ao gateway.
