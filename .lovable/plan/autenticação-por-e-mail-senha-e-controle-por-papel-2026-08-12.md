# Autenticação por e-mail + senha e controle por papel

## Situação atual (verificada)

Boa parte já existe da Fase 1:

- `/login` com e-mail + senha (sem OAuth, sem tela de cadastro) já está no projeto.
- Área protegida `_authenticated` já redireciona para `/login` sem sessão.
- `profiles` existe com `id`, `full_name`, `email`, `role`, `is_active`, e a trigger `handle_new_user` cria o perfil automaticamente quando uma conta nasce no Auth (o primeiro usuário vira `admin`).
- O papel já é lido no frontend (`useProfile`): o menu "Usuários" só aparece para Admin e a página `/usuarios` bloqueia não-admins.
- O banco tem hoje 1 usuário, já com perfil de Admin.

Faltam três coisas para fechar o que foi pedido.

## O que será feito

### 1. Fechar o cadastro aberto de verdade
Desativar o auto-cadastro no Supabase Auth (só o Admin cria contas pela tela `/usuarios`) e ligar a confirmação de e-mail conforme o documento de estrutura. Contas criadas pelo Admin já nascem confirmadas, então isso não atrapalha o fluxo interno.

### 2. Bloquear usuário inativo e perfil ausente
Hoje um usuário com `is_active = false` ainda conseguiria entrar. Passa a valer:
- Ao autenticar, se o perfil estiver inativo, a sessão é encerrada e aparece a mensagem "Acesso desativado. Fale com o administrador."
- Se por algum motivo o perfil não existir para uma conta válida, ele é criado/reconciliado no primeiro acesso a partir dos dados da conta (nome e e-mail), com papel `usuario`.
- Um guard de área administrativa passa a proteger as telas exclusivas de Admin, em vez de depender só da checagem dentro da página.

### 3. Confirmar com um Admin de teste
Criar uma conta de teste Admin, fazer o login real no app e verificar: entrada bem-sucedida, redirecionamento para o painel, papel "Administrador" exibido no cabeçalho, menu "Usuários" visível e a tela de usuários acessível. Também será testado o caminho negativo (senha errada e usuário inativo). Ao final informo o e-mail e a senha da conta de teste, e ela pode ser removida em seguida.

## Detalhes técnicos

- `supabase--configure_auth`: `disable_signup = true`, `auto_confirm_email` mantido para contas criadas via Admin API.
- Reconciliação de perfil: server function autenticada (`requireSupabaseAuth`) chamada no `beforeLoad`/carregamento do layout protegido; usa o cliente admin apenas para o `upsert` do próprio perfil do chamador.
- `is_active` verificado no `login.tsx` (pós `signInWithPassword`) e no layout `_authenticated`, com `supabase.auth.signOut()` em caso de bloqueio.
- Novo layout `src/routes/_authenticated/_admin/route.tsx` com `beforeLoad` checando `role = 'admin'`; `/usuarios` passa a viver sob ele.
- Teste do login executado via Playwright contra o app rodando localmente, com captura de tela como evidência.
