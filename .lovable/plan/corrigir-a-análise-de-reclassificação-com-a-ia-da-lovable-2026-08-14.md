# Corrigir a análise de reclassificação com a IA da Lovable

## O problema

Ao rodar as sugestões de reclassificação com o provedor "Lovable", o sistema falha com
"não foi possível interpretar o JSON retornado". Com o Gemini próprio funciona.

Causa confirmada no código: o schema das sugestões é escrito no dialeto do Gemini
(um objeto JSON Schema simples). O cliente da Lovable só ativa o modo de saída
estruturada quando o schema é um schema Zod; como não é, ele ignora o schema e faz
uma chamada de texto livre. O modelo responde em texto/markdown, e o interpretador
de JSON quebra.

## O que será feito

1. **Saída estruturada real no caminho Lovable**: aceitar também schemas em JSON Schema,
   convertendo-os com o helper `jsonSchema()` do AI SDK e aplicando-os como saída
   estruturada — o mesmo contrato que o Gemini já usa.
2. **Ajuste de compatibilidade estrita** do schema no envio (todos os campos em `required`,
   `additionalProperties: false` nos objetos), sem alterar a definição usada pelo Gemini.
3. **Interpretação tolerante**: antes de falhar, remover cercas de markdown (```json) e
   extrair o primeiro objeto JSON da resposta, tanto no cliente Lovable quanto no
   roteador de IA.
4. **Mensagem de erro útil**: quando ainda assim não for possível interpretar, mostrar o
   provedor usado e um trecho da resposta, para diagnóstico rápido.
5. **Teste**: rodar a geração de sugestões com o provedor Lovable forçado e confirmar
   que as sugestões são criadas, e depois confirmar que o Gemini continua funcionando.

## Detalhes técnicos

- `src/lib/ai-lovable.server.ts`: detectar schema Zod ou JSON Schema; no segundo caso usar
  `jsonSchema()` do pacote `ai` com `Output.object`; normalizar o schema para o modo estrito.
- `src/lib/ai-router.server.ts`: `callAiJson` passa a usar um parser tolerante compartilhado
  e mensagens de erro com provedor + trecho do retorno.
- `src/lib/reclass.server.ts`: sem mudança de regra de negócio; o schema atual continua válido.
