# Plano: Alternância de Provedores de IA (Gemini próprio × Lovable AI Gateway)

## Objetivo
Permitir que o Admin escolha, direto na interface, qual IA o sistema usa para leitura de PDFs e geração de sugestões de reclassificação. O sistema deve alternar entre:
- **Gemini direto** (conta própria do Google, chave `GEMINI_API_KEY`);
- **Lovable AI Gateway** (`LOVABLE_API_KEY`, modelo `google/gemini-3.6-flash` via gateway).

Também deve haver **fallback automático**: se o provedor ativo falhar (timeout, cota, erro 4xx/5xx), a chamada é reencaminhada para o outro provedor, registrando o fato no log.

## Escopo
Esta entrega é **apenas a camada de IA**: persistência da escolha, roteador unificado, troca das chamadas existentes e toggle no frontend. Não altera regras de negócio de importação, reclassificação ou demonstrativos.

## Tarefas técnicas

### 1. Banco de dados — tabela `app_settings`
Criar tabela para guardar a configuração ativa de IA (e futuras configurações globais).

```sql
create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

grant select on public.app_settings to authenticated;
grant insert, update, delete on public.app_settings to service_role;
alter table public.app_settings enable row level security;

create policy "app_settings_select" on public.app_settings
  for select to authenticated using (true);
create policy "app_settings_admin_write" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

Inserir chave padrão: `ai_provider` = `gemini`.

### 2. Dependências
Instalar pacotes para usar o Lovable AI Gateway via AI SDK:
- `ai`
- `@ai-sdk/openai-compatible`

### 3. Roteador unificado de IA
Criar `src/lib/ai-router.ts` com uma interface comum para os dois provedores:

- `AiProvider = 'gemini' | 'lovable'`
- `callAi({ parts, systemInstruction, schema, errorContext, maxOutputTokens })` — retorna texto;
- `callAiJson<T>(...)` — retorna JSON parseado;
- Lê o provedor ativo de `app_settings`;
- Se o ativo falhar com erro retryable (timeout, 429, 5xx), tenta o outro provedor automaticamente e registra `activity_log` com ação `fallback_ia`.

Para o provedor **Gemini direto**, reutilizar a lógica atual de `src/lib/ai-model.ts`.
Para o provedor **Lovable AI Gateway**, usar `createLovableAiGatewayProvider` com modelo `google/gemini-3.6-flash`, lendo `LOVABLE_API_KEY` dentro do handler.

### 4. Refatorar chamadas existentes
Atualizar `src/lib/imports.server.ts` e `src/lib/reclass.server.ts` para importar `callAiJson`/`callAi` de `src/lib/ai-router.ts` em vez de chamar `callGeminiJson`/`callGemini` diretamente.

Manter os schemas e prompts inalterados; apenas a função de chamada muda.

### 5. Server Functions de configuração
Criar em `src/lib/ai-settings.functions.ts`:
- `getActiveAiProvider()` — leitura pública (qualquer autenticado);
- `setActiveAiProvider(provider)` — somente Admin; grava em `app_settings` e `activity_log`.

### 6. Toggle no frontend
Adicionar, no header do `AppShell.tsx`, um seletor de provedor de IA visível apenas para Admin. Exibir:
- ícone/label do provedor ativo;
- dropdown para trocar entre "Gemini (próprio)" e "Lovable AI Gateway";
- badge de "fallback" quando a última operação usou o provedor secundário.

Usar `useServerFn` para chamar `getActiveAiProvider` no carregamento e `setActiveAiProvider` na troca.

### 7. Tratamento de erro e fallback
- Erros 400/422 do provedor ativo são **não retryable** (prompt/schema inválido) — não faz fallback;
- Erros 408/429/5xx e exceções de rede são **retryable** — tenta o outro provedor uma vez;
- Se ambos falharem, retorna erro amigável ao usuário;
- Sempre registrar no `activity_log` quando ocorrer fallback, com metadados do provedor ativo e do fallback.

### 8. Testes de ponta a ponta
- Alternar para Gemini e importar um balancete PDF — deve funcionar como hoje;
- Alternar para Lovable AI Gateway e importar o mesmo balancete — deve extrair as mesmas linhas;
- Simular falha no provedor ativo (ex.: chave inválida temporária) e confirmar que o fallback ocorre;
- Verificar que usuários não-Admin não veem o seletor.

## Resultado esperado
O Admin consegue trocar a IA do sistema pela interface, com segurança de que, se o provedor escolhido falhar, o outro assume automaticamente sem perder a operação em andamento.
