# Conectar o Gemini direto, com a sua própria chave

Sai o gateway da Lovable: as duas funções de IA do Rotta passam a chamar a API do Google (Gemini) diretamente, com a sua chave do Google AI Studio. Isso resolve também o bloqueio atual de créditos do workspace Lovable, que hoje impede qualquer chamada.

## O que você precisa fornecer

1. Uma chave em https://aistudio.google.com/apikey (botão "Create API key", vinculada ao seu projeto do Google Cloud com faturamento, se quiser sair do nível gratuito).
2. Vou abrir um formulário seguro para você colar a chave; ela é gravada como o segredo `GEMINI_API_KEY` e fica só no servidor — nunca aparece no navegador nem no código.

## O que muda no sistema

1. Leitura de balancete em PDF (`/importar`) passa a chamar a API do Google direto.
2. Sugestões de natureza contábil (`/reclassificacoes`) idem.
3. O modelo continua num único ponto de configuração, fácil de trocar depois.
4. Nada muda nas telas nem no fluxo de trabalho — só o provedor por trás.
5. Uma seção "Status da IA" em `/atualizacoes` (só Admin) com botão **"Testar conexão"**, que faz uma chamada mínima ao Gemini e mostra: sucesso com o tempo de resposta, ou o erro tratado (chave inválida, cota excedida, projeto sem faturamento).

## Detalhes técnicos

- `src/lib/ai-model.ts` vira o cliente direto do Google:
  - Endpoint `https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent`, com a chave no header `x-goog-api-key` (nunca na URL, para não vazar em log).
  - Modelo padrão `gemini-2.5-flash` (multimodal, lê PDF nativamente, bom custo/latência para lotes de contas). Trocar de modelo é uma linha.
  - Helper `callGemini({ parts, schema, systemInstruction })` que monta o corpo nativo do Gemini: `contents[].parts`, `systemInstruction`, e `generationConfig: { responseMimeType: "application/json", responseSchema }` para saída estruturada.
  - A chave é lida com `process.env["GEMINI_API_KEY"]` **dentro** do handler, nunca no topo do módulo.
- `src/lib/imports.server.ts`: o PDF vai como `{ inline_data: { mime_type, data: base64 } }` no lugar do formato OpenAI; o MIME vem do arquivo real, não fixo. Sem streaming (o `generateContent` responde de uma vez) e sem timeout artificial.
- `src/lib/reclass.server.ts`: mesmo padrão, com o prompt de contas pendentes + padrão aprovado; segue processando em lotes de 20 contas.
- Os schemas atuais (`EXTRACTION_SCHEMA`, `SUGGESTION_SCHEMA`) são convertidos para o dialeto de `responseSchema` do Gemini: tipos suportados, `enum` mantido nas naturezas, sem `additionalProperties` (não suportado lá) — com a validação de enum já existente no código servindo de rede de proteção.
- Tratamento de erro traduzido para português: 400/403 (chave inválida ou API não habilitada), 429 (cota), 5xx (instabilidade do Google), sempre com os primeiros 300 caracteres da resposta para diagnóstico.
- Nova server function `testAiConnection` em `src/lib/ai.functions.ts`, protegida por autenticação + `is_admin()`, usada pela seção "Status da IA".

## Validação

1. Testar a conexão pelo botão em `/atualizacoes` e obter sucesso.
2. Importar um balancete PDF em Janeiro/2026 e conferir os lançamentos criados em `/balancete`.
3. Gerar sugestões em `/reclassificacoes` e conferir natureza, justificativa e confiança.
