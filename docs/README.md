# Rotta Financeiro — ERP Financeiro MVP

## Sobre o projeto

O **Rotta Financeiro** é um ERP financeiro em versão MVP construído sob medida para o **Frigorífico Rotta das Carnes (Rota Alimentos)**. Ele resolve um problema concreto do dia a dia: o balancete exportado do sistema G2 chega desestruturado — com contas mal classificadas, lançamentos incorretos e sem estrutura para análise — e não há integração via API com o G2. O **Rotta Financeiro** recebe por importação manual os arquivos PDF e Excel (balancete, notas fiscais, romaneio de abate, pedidos de compra, contas a pagar/receber, relatório de vendas e extrato bancário Sicoob), usa IA para ler os arquivos, reclassificar contas contra o padrão contábil, apontar inconsistências para correção no G2, e gera de forma estruturada a **DRE**, o **Balanço Patrimonial** e o **Fluxo de Caixa**, além de um **dashboard de indicadores** (margem bruta, EBITDA, resultado líquido e posição de caixa). O objetivo do MVP é permitir que o gestor importe um balancete do G2, visualize, reclassifique, edite valores manualmente e gere os três demonstrativos estruturados em uma única sessão de uso.

## Antes de tudo

> ⚠️ **LEIA O `SKILL.md` ANTES DE ESCREVER QUALQUER LINHA DE CÓDIGO OU CRIAR QUALQUER TABELA.**
>
> O `SKILL.md` é o **guia operacional** de como construir *este* sistema específico — não é documentação genérica. Ele explica as decisões de arquitetura do **Rotta Financeiro**, a ordem correta de construção, os padrões de nomenclatura (tabelas em `snake_case`, Edge Functions em `kebab-case`), como a IA deve reclassificar contas com aprovação humana e aprendizado do padrão da empresa, e como o reprocessamento automático de períodos deve se comportar. Ignorar o `SKILL.md` leva a retrabalho e a inconsistências entre banco, functions e páginas. **Comece por ele, sempre.**

## Mapa de arquivos

| Arquivo | O que contém | Quando consultar |
|---|---|---|
| **SKILL.md** | Guia operacional mestre: como construir o Rotta Financeiro passo a passo, decisões de arquitetura, ordem de build e convenções. | **PRIMEIRO de tudo**, antes de qualquer código ou tabela. |
| **docs/PROCESSO.md** | O processo de negócio do frigorífico: fluxo de importação → reclassificação → aprovação → geração de demonstrativos → apontamentos ao G2. | Para entender o "porquê" de cada regra antes de implementar uma feature. |
| **docs/ESTRUTURA.md** | A estrutura técnica canônica: nomes exatos de tabelas, Edge Functions, RPCs e páginas. Fonte da verdade de nomenclatura. | Sempre que criar/nomear qualquer artefato — evita nomes órfãos. |
| **docs/PRD.md** | Product Requirements: contexto, escopo do MVP, funcionalidades priorizadas e critério de sucesso. | Para saber o que entra (e o que fica fora) do MVP. |
| **docs/PRS.md** | Requisitos de sistema (RS) técnicos e testáveis, rastreando cada RF do Rotta Financeiro. | Ao detalhar uma funcionalidade e ao escrever critérios de aceite/testes. |
| **db/schemas.sql** | Schema completo do Supabase: todas as tabelas, RLS, policies por operação, helper `is_admin()` e triggers. | **Rodar no início** e consultar sempre que mexer em dados. |
| **docs/PLANO.md** | Plano de desenvolvimento por fases, com entregáveis e tabelas envolvidas em cada uma. | Para sequenciar o trabalho — siga fase por fase. |
| **docs/FUNCTIONS.md** | Documentação das Edge Functions (Deno), Postgres Functions (RPC/triggers) e Cron Jobs (pg_cron), com autenticação. | Ao construir a lógica server-side (parsing, reclassificação, geração de relatórios). |
| **docs/PAGINAS.md** | Especificação de cada página do frontend Lovable (React + Tailwind + shadcn/ui), estados e comportamentos. | Ao montar a interface e os fluxos de tela. |
| **docs/DEPARA.md** | Matriz de rastreabilidade: Tabela → Functions/Endpoints → Páginas. | Como checklist final para garantir que nada ficou órfão. |

## Primeiros passos no Lovable

> Caminho recomendado para o **Rotta Financeiro**, porque o usuário final é um gestor de operações de frigorífico **sem perfil técnico**: o Lovable gera React + Tailwind + shadcn/ui com integração nativa ao Supabase e deploy com preview, entregando o app no ar pelo caminho mais rápido, sem exigir um time de TI para manter.

1. **Leia o `SKILL.md` inteiro** (e depois `docs/PROCESSO.md` e `docs/ESTRUTURA.md`). Não pule esta etapa.
2. **Crie o projeto** no Lovable com o nome **Rotta Financeiro**.
3. **Conecte o Supabase**: ative a integração nativa Supabase dentro do Lovable e vincule/ crie o projeto Supabase do Rotta.
4. **Rode `db/schemas.sql`**: abra o SQL Editor do Supabase, cole o conteúdo completo de `db/schemas.sql` e execute. Confirme que todas as tabelas, o helper `is_admin()`, as policies de RLS e os triggers foram criados sem erro.
5. **Configure a autenticação**: habilite email/senha no Supabase Auth (single-tenant, equipe interna, papéis Admin/Usuário). Nenhum cadastro aberto.
6. **Cole o prompt inicial** no Lovable referenciando os documentos, por exemplo:

   > "Construa o **Rotta Financeiro** seguindo `SKILL.md` como guia mestre. O banco Supabase já está criado a partir de `db/schemas.sql` — não recrie tabelas. Implemente as páginas conforme `docs/PAGINAS.md`, as Edge Functions conforme `docs/FUNCTIONS.md`, e respeite os nomes exatos de `docs/ESTRUTURA.md`. Siga a ordem de `docs/PLANO.md`, começando pela Fase 1 (fundação: auth por papel, layout base com menu lateral). Use `docs/DEPARA.md` para não deixar nada órfão."

7. **Guarde as chaves de IA** (OpenAI/Anthropic/Gemini) como secrets do Supabase — nunca no frontend. Elas são usadas dentro das Edge Functions de parsing e reclassificação.

## Primeiros passos no Claude Code

> Use este caminho **apenas se houver time de TI** que consiga codar e manter o sistema. Ele é mais flexível, mas exige capacidade técnica. Na dúvida, prefira o Lovable acima.

1. **Aponte o Claude Code para ler o `SKILL.md` PRIMEIRO** — antes de gerar qualquer código. Em seguida `docs/PROCESSO.md` e `docs/ESTRUTURA.md`. Instrua explicitamente: *"Leia SKILL.md e siga-o como fonte de verdade operacional."*
2. **Inicie o projeto**: crie o repositório do **Rotta Financeiro** e a stack sobre Supabase que o time escolher (mantendo o backend sempre Supabase).
3. **Configure o Supabase CLI**: instale a CLI, faça `supabase login`, `supabase link` ao projeto e defina as credenciais/secrets (URL, anon key, service role, chaves de IA) via `supabase secrets set` — nunca commitadas.
4. **Rode `db/schemas.sql`**: aplique o schema com `supabase db push` ou executando `db/schemas.sql` no banco. Valide tabelas, RLS, `is_admin()` e triggers.
5. **Implemente as Edge Functions** conforme `docs/FUNCTIONS.md` (parsing de PDF/Excel, reclassificação por IA com aprovação, geração de DRE/Balanço/Fluxo de Caixa, cron de reprocessamento). Deploy com `supabase functions deploy`.
6. **Construa o frontend** seguindo `docs/PAGINAS.md` e siga o sequenciamento de `docs/PLANO.md`, fase por fase.
7. **Feche o loop com `docs/DEPARA.md`**: valide que cada tabela tem suas functions e páginas correspondentes, sem artefatos órfãos.
