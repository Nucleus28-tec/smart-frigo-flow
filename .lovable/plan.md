# Usar o Gemini como IA do Rotta

Primeiro, um esclarecimento importante: **MCP não é o caminho para isso**. MCP serve para expor as ferramentas do Rotta para um assistente externo (Gemini, Claude, ChatGPT) conversar com o sistema. Para o Rotta *usar* o Gemini nas funções internas (leitura de PDF e sugestões de reclassificação), basta trocar o modelo no gateway de IA da Lovable, que já está configurado e já cobre a família Gemini — sem chave nova, sem MCP, sem custo extra de setup.

## O que muda na prática

1. A leitura automática de balancetes em PDF (`/importar`) passa a usar o Gemini.
2. As sugestões de natureza contábil (`/reclassificacoes`) passam a usar o Gemini.
3. Uma única constante define o modelo usado em todo o app, então trocar de modelo depois é uma linha.
4. Comportamento, telas e mensagens de erro continuam iguais — só o motor muda.

## Detalhes técnicos

- Novo módulo `src/lib/ai-model.ts` exportando `AI_MODEL = "google/gemini-3-flash"` (multimodal, lê PDF nativamente e é rápido/barato para lotes de contas).
- `src/lib/imports.server.ts` e `src/lib/reclass.server.ts` passam a importar essa constante em vez do literal `openai/gpt-5.6-sol`.
- Modelos Gemini não usam a rota `/v1/responses` (que é OpenAI-only). As duas chamadas migram para `https://ai.gateway.lovable.dev/v1/chat/completions`, mantendo `stream: true` e o parsing SSE que já existe, com estas adaptações:
  - PDF: o arquivo vai como parte de mensagem multimodal (`file` com data URL base64), no lugar de `input_file`.
  - Saída estruturada: `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` — os schemas atuais (`EXTRACTION_SCHEMA` e `SUGGESTION_SCHEMA`) já são strict-compatíveis e continuam valendo.
  - Leitura do stream: acumular `choices[0].delta.content` em vez de `response.output_text.delta`.
- Tratamento de 429/402/403 e os limites de crédito do workspace permanecem como estão.
- Sem timeouts artificiais nas chamadas ao gateway (regra já seguida hoje).

## Validação

- Reimportar um balancete PDF em Janeiro/2026 e conferir que os `ledger_entries` são criados com os mesmos valores.
- Gerar sugestões em `/reclassificacoes` e conferir natureza, justificativa e confiança preenchidas.

## Se o objetivo for o outro MCP

Se em algum momento você quiser o inverso — abrir o Gemini/Claude e pedir "qual foi a margem bruta de janeiro no Rotta?" — aí sim entra o servidor MCP do app com login OAuth, que é um trabalho separado e pode ser feito depois.
