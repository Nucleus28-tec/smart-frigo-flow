# Corrigir erro "Missing SUPABASE_SERVICE_ROLE_KEY"

## O que está acontecendo

O botão "Gerar sugestões" (e outras rotinas administrativas: importação, recálculo, apontamentos, exportações) roda no servidor usando uma credencial privilegiada do Supabase, a chave de serviço.

Verifiquei o ambiente do servidor deste projeto agora: a URL do Supabase e a chave pública estão presentes, mas a **chave de serviço está ausente**. Por isso o servidor lança exatamente a mensagem que aparece na tela em vermelho. Não é um bug de código nem de permissão do seu usuário — é uma variável de ambiente que se perdeu na conexão com o Supabase.

## Como resolver

1. Re-vincular as credenciais do Supabase ao ambiente do projeto, o que reinsere a chave de serviço.
2. Reiniciar o servidor de desenvolvimento para que ele leia a credencial nova.
3. Testar novamente "Gerar sugestões" no período selecionado e confirmar que a mensagem de erro some.
4. Se a re-vinculação falhar (autorização do Supabase revogada), o próximo passo é reconectar o Supabase nas configurações do projeto — nesse caso eu aviso e explico onde clicar.

## Detalhes técnicos

- `src/integrations/supabase/client.server.ts` exige `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; a segunda está indefinida no sandbox.
- Correção via `supabase--rebind_secrets` (re-deriva e regrava `SUPABASE_*`); o prefixo `SUPABASE_` é reservado e não pode ser gravado como secret manual.
- Nenhuma alteração de código é necessária. Não haverá downgrade das operações de service role para cliente com RLS.
