# Fase 1 — Fundação (Rotta Financeiro)

Entregável: banco Supabase completo, login por email/senha, layout base com menu lateral e controle de acesso Admin/Usuário, além das páginas `/usuarios` e `/periodos` funcionais. As demais páginas entram como telas-placeholder navegáveis, para serem preenchidas na Fase 2.

## 1. Banco de dados

Aplicar todo o `db/schemas.sql` em uma única migração: as 11 tabelas (`profiles`, `accounting_periods`, `imported_files`, `chart_of_accounts`, `ledger_entries`, `reclassification_suggestions`, `audit_findings`, `financial_statements`, `dashboard_indicators`, `recalculation_logs`, `activity_log`), índices, triggers de `updated_at`, RLS habilitada e todas as policies, mais o helper `is_admin()`.

Complementos necessários que o arquivo não traz e que sem eles o app não funciona:
- GRANTs por tabela para `authenticated` e `service_role` (o Supabase não concede por padrão; sem isso toda leitura falha com erro de permissão).
- Trigger em `auth.users` para criar automaticamente a linha em `profiles` no primeiro acesso de um usuário convidado (o schema exige `profiles` espelhando `auth.users`).
- Função `log_activity()` para gravar na trilha de auditoria.
- Bucket privado `imports` no Storage, já previsto para a Fase 2.

Primeiro Admin: o primeiro usuário que se cadastrar recebe papel `admin` automaticamente; a partir daí não há cadastro aberto — novos usuários só pelo Admin em `/usuarios`.

## 2. Autenticação

- Rota pública `/login` com email + senha, mensagens de erro genéricas ("Email ou senha inválidos" / "Usuário desativado — contate o Admin"), estado de carregando no botão e link de recuperação de senha.
- Sem tela de cadastro público (exceto o bootstrap do primeiro Admin, exibido apenas enquanto não existir nenhum usuário).
- `/` redireciona para `/dashboard` quando logado e para `/login` quando não.
- Todas as páginas internas ficam sob a área protegida; usuário com `is_active = false` é deslogado com aviso.

## 3. Layout base

- Menu lateral com: Dashboard, Períodos, Importar, Balancete, Reclassificações, Plano de Contas, Apontamentos, Demonstrativos, Atualizações, Usuários (visível só para Admin).
- Header com nome da plataforma, seletor de período contábil ativo (compartilhado entre as páginas) e menu do usuário (nome, papel, sair).
- Identidade visual sóbria de ERP financeiro, tokens semânticos no design system, responsivo.
- Rotas protegidas por papel: Usuário que abrir `/usuarios` vê aviso de acesso negado e volta ao `/dashboard`.

## 4. Página `/usuarios` (somente Admin)

Tabela de `profiles` (nome, email, papel, ativo/inativo, criado em), filtros por papel e status, modal "Novo usuário" (nome, email, papel), ações por linha para trocar papel e ativar/desativar. Estados vazio, carregando e erro.

## 5. Página `/periodos`

Lista de períodos com label, mês de referência, status colorido, último recálculo e criador. Admin cria período (modal com label e mês) e altera status entre aberto / em revisão / fechado; Usuário apenas visualiza e seleciona. Botão "Selecionar" define o período ativo do app. Estados vazio, carregando e erro.

## 6. Placeholders navegáveis

`/dashboard`, `/importar`, `/balancete`, `/reclassificacoes`, `/plano-de-contas`, `/apontamentos`, `/demonstrativos`, `/atualizacoes` entram com o cabeçalho da página e um estado vazio explicando que a funcionalidade chega na Fase 2 — assim o menu inteiro já navega sem link morto.

## Nota técnica

Este projeto Lovable roda em TanStack Start, cuja camada de servidor própria substitui as Supabase Edge Functions. A lógica de servidor (equivalente a `manage-user`, e depois `parse-imported-file`, `suggest-reclassification`, `generate-statements` etc.) será implementada como server functions do TanStack, com service role no servidor e chaves de IA nunca no frontend. Os nomes, contratos de entrada/saída e regras de autenticação de `docs/FUNCTIONS.md` são mantidos integralmente; muda apenas onde o código executa. Nomenclatura de banco em `snake_case` inglês, conforme o SKILL.md.

Aviso ao concluir cada tarefa da checklist, conforme pedido.
