# Períodos contábeis (/periodos)

A página `/periodos` e o contexto global de período já existem da Fase 1: lista com rótulo, mês de referência, status, último recálculo e botão "Selecionar"; criação e troca de status só aparecem para Admin; o seletor no header e o `localStorage` mantêm o período escolhido em todas as telas. O banco não tem nenhum período cadastrado hoje.

## O que muda

1. **Guarda contra mês duplicado**
   - Ao criar, avisar de forma clara quando já existir período para aquele mês de referência, em vez de mostrar o erro técnico do banco.

2. **Status "fechado" com confirmação**
   - Trocar para "Fechado" pede confirmação, já que fecha o mês para a operação; "Aberto" e "Em revisão" continuam diretos.
   - Linhas de período fechado ganham marcação visual discreta.

3. **Contexto de período mais visível**
   - Além do seletor no header, mostrar o status do período selecionado ao lado do nome (Aberto / Em revisão / Fechado), para o usuário saber em que mês está trabalhando.

4. **Criação do período de partida**
   - Criar "Janeiro/2026" (referência 2026-01) com status Aberto, atribuído ao Admin, e confirmar que ele aparece na lista e no seletor do header.

## Validação

- Login como Admin: criar Janeiro/2026, conferir na lista e no seletor do header, e trocar o status entre Aberto / Em revisão / Fechado.
- Login como Usuário comum: confirmar que vê a lista e consegue selecionar o período, mas não vê "Novo período" nem consegue alterar o status.
- Conferir que o período selecionado permanece após recarregar a página e ao navegar entre telas.

## Notas técnicas

- Guarda de duplicidade: tratar o erro de violação de unicidade (`23505`) do `accounting_periods` em mensagem amigável, mantendo a checagem no banco como fonte de verdade.
- A criação de Janeiro/2026 será feita como inserção de dados atribuída ao perfil Admin existente (as policies já limitam criação/edição a `is_admin()`).
- Nenhuma alteração de esquema é necessária.
