# Layout base do Rotta Financeiro

O shell (menu lateral + header) e as 10 páginas já existem da Fase 1. Este plano fecha as lacunas de permissão pedidas e valida a navegação.

## O que muda

1. **Plano de Contas vira área de Admin**
   - Mover `/plano-de-contas` para dentro do grupo protegido de Admin (mesmo grupo de `/usuarios`), que já redireciona não-Admin para o Dashboard.
   - No menu lateral, o item "Plano de Contas" passa a aparecer só para Admin, junto de "Usuários".

2. **Reclassificações: visível para todos, aprovação só de Admin**
   - A página continua acessível a qualquer usuário autenticado (leitura das sugestões).
   - Os botões "Aprovar" / "Rejeitar" só aparecem para Admin; para Usuário, um aviso de "somente leitura — aprovação restrita ao Admin".

3. **Placeholders padronizados**
   - Cada página não implementada mantém título, descrição curta do propósito (conforme docs/PAGINAS.md) e aviso "Em breve — Fase 2/3".

4. **Header e menu**
   - Header já traz nome do usuário, papel, seletor de período e logout; confirmar rótulos e o menu mobile.
   - Ordem final do menu: Dashboard, Períodos, Importar, Balancete, Reclassificações, Plano de Contas (Admin), Apontamentos, Demonstrativos, Atualizações, Usuários (Admin).

## Validação

Teste automatizado de navegação com dois logins:
- Admin: percorre todos os itens do menu e confirma que cada rota abre.
- Usuário comum: confirma que "Plano de Contas" e "Usuários" não aparecem no menu, que o acesso direto às URLs redireciona ao Dashboard, e que em Reclassificações não há botões de aprovar/rejeitar.

## Notas técnicas

- `src/routes/_authenticated/plano-de-contas.tsx` passa para `src/routes/_authenticated/_admin/plano-de-contas.tsx` (a string de `createFileRoute` acompanha o caminho).
- A lista `NAV` em `src/components/AppShell.tsx` ganha uma marcação `adminOnly` em vez do append manual de "Usuários".
- Gate de ação em Reclassificações usa `useProfile()` no frontend; as policies de UPDATE já restringem a Admin no banco.
