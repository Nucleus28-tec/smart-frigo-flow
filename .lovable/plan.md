# Gestão de usuários internos (Admin) — fechamento

## Situação atual (verificada)

Boa parte do que o documento chama de `manage-user` já existe neste projeto:

- A tela `/usuarios` existe, é acessível apenas para Admin (área protegida `_admin`) e já faz listagem, criação, troca de papel e ativação/desativação.
- As funções de servidor `createTeamUser` e `updateTeamUser` já usam a chave de serviço para operar em `auth.users` e sincronizar `profiles.role`, e cada ação grava trilha de auditoria.
- As políticas de acesso já usam `is_admin()`, e o frontend também lê o papel para esconder o menu.

Observação de arquitetura: neste stack a lógica de servidor roda como *server functions* do TanStack, que é o equivalente direto da Edge Function `manage-user` descrita no documento. Não vou criar uma Edge Function Deno em paralelo — seria uma segunda porta de entrada para a mesma operação privilegiada, com mais superfície de risco e nenhuma vantagem.

## O que será feito

### 1. Convite por link de definição de senha
Ao criar um usuário, o Admin não digita mais uma senha inicial. O sistema gera um link seguro de convite (definição de senha) e o exibe na tela para o Admin copiar e repassar pelo canal que preferir. Sem envio de e-mail por enquanto — o Resend fica documentado como próximo passo e pode ser ligado depois sem mudar a tela.

Também será possível gerar um novo link de definição de senha para um usuário já existente, direto na listagem ("Reenviar convite").

### 2. Página para definir a senha
Nova página pública `/definir-senha`, para onde o link do convite leva. O usuário abre, escolhe a senha, e é levado ao painel já autenticado.

### 3. Ajustes finos na tela `/usuarios`
- Coluna de status (Ativo / Desativado) mais explícita e confirmação antes de desativar alguém.
- Mensagens de erro do servidor exibidas de forma legível.
- Continua bloqueado rebaixar ou desativar a própria conta.

### 4. Teste real
Crio um usuário de teste com papel "usuario", uso o link de convite para definir a senha, faço login e confirmo: entra no painel, não vê o menu "Usuários" e é barrado ao tentar abrir `/usuarios` diretamente. Depois informo os dados da conta de teste para você remover se quiser.

## Detalhes técnicos

- `src/lib/users.functions.ts`: `createTeamUser` passa a criar a conta sem senha (`email_confirm: true`) e a devolver um link gerado por `supabaseAdmin.auth.admin.generateLink({ type: 'recovery' })` com `redirectTo` para `/definir-senha`; nova função `resendInvite` faz o mesmo para usuário existente. Ambas mantêm `assertAdmin` via `is_admin()` e `log_activity`.
- Nova rota pública `src/routes/definir-senha.tsx`: consome o token do link (`supabase.auth` já trata o hash de recuperação), aplica `updateUser({ password })` e redireciona para `/dashboard`.
- `src/routes/_authenticated/_admin/usuarios.tsx`: remove o campo de senha, mostra o link gerado com botão de copiar, adiciona confirmação de desativação e a ação "Reenviar convite".
- Sem mudanças de schema; políticas atuais (`is_admin()`) permanecem.
- Validação com Playwright no app local, incluindo o caminho negativo de acesso a `/usuarios` como "usuario".
