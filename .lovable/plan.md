# Corrigir os botões da tela Importar (Janeiro/2026)

## O que está acontecendo

Os três botões (Baixar, Reprocessar, Excluir) chamam funções no servidor que precisam da credencial de serviço do Supabase. Verifiquei o ambiente: a variável `SUPABASE_SERVICE_ROLE_KEY` está ausente — por isso aparece o aviso vermelho "Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY" e as ações falham.

## Correção

1. Refazer o vínculo da credencial de serviço do Supabase no projeto (ferramenta de rebind de segredos). Essa é a causa raiz e destrava Reprocessar e Excluir.
2. Ajustar as funções para não depender da credencial de serviço quando não é necessário:
   - **Baixar**: já usa a sessão do usuário; garantir que o arquivo abre em nova aba e que erro de storage vira mensagem clara.
   - **Excluir**: verificar admin pela sessão e executar a exclusão pela sessão do usuário (RLS já permite ao Admin), usando a credencial de serviço só para remover o objeto do storage; se ela faltar, o registro ainda é excluído e o usuário recebe aviso.
   - **Reprocessar**: usar a sessão autenticada para ler/atualizar `imported_files` e gravar lançamentos, mantendo a credencial de serviço apenas onde a RLS impedir.
3. Mensagens de erro amigáveis em português no lugar do texto técnico do Supabase, com o motivo real (permissão, arquivo ausente no storage, credencial não configurada).

## Validação

Com o período Janeiro/2026 selecionado, testo no navegador o arquivo `BALANCETE JANEIRO 26.pdf`: baixar (URL assinada abre), reprocessar (status volta a "processado" e a contagem de lançamentos é atualizada) e excluir (linha some da lista). Reporto o resultado de cada botão.

## Detalhes técnicos

- `src/lib/imports.functions.ts`: `getFileDownloadUrl`, `deleteImportedFile`, `parseImportedFile` — trocar dependência incondicional de `supabaseAdmin` por `context.supabase`, com import dinâmico do cliente de serviço protegido por try/catch.
- `src/routes/_authenticated/importar.tsx`: apenas tratamento/exibição de erro nas ações da tabela.
- Sem alteração de banco de dados.
