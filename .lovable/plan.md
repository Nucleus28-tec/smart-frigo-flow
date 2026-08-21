# Reorganizar "Fornecedores Pecuaristas" no Passivo Circulante

## O que está acontecendo hoje (verificado no banco)

- `FORNECEDORES PECUARISTAS` (reduzido `000060`) está em `2.01.01.001.`, ou seja, **dentro de EMPRÉSTIMOS E FINANCIAMENTOS** (`2.01.01.`), com 145 contas analíticas de pecuaristas abaixo dela.
- O correto é ela ser um **grupo próprio do Passivo Circulante**, irmão de `2.01.01` (Empréstimos), `2.01.03` (Fornecedores produtos e serviços) etc. — o próximo livre é `2.01.08`. (Observação: `2.02` é *Passivo Não-Circulante*, então mover para lá mudaria a classificação contábil; o lugar certo é `2.01.xx`.)
- A ferramenta **já tem** o botão *Mover* na aba Árvore hierárquica, mas hoje ele não resolve esse caso corretamente por dois motivos:
  1. a numeração gerada é sempre de 5 dígitos (`2.01.00008.`), enquanto o padrão do plano é 2 dígitos no nível 3, 3 dígitos no nível 4 e 5 dígitos no nível 5;
  2. o destino é escolhido num combo simples com 141 grupos, sem busca — difícil achar "PASSIVO CIRCULANTE".

## O que será feito

**1. Numeração correta ao mover (banco)**

A função de movimentação passa a calcular a largura do novo segmento pelo nível do grupo de destino: nível 3 → `08`, nível 4 → `001`, nível 5+ → `00001`. Assim, mover Fornecedores Pecuaristas para o Passivo Circulante gera `2.01.08.` e o ramo inteiro vira `2.01.08.00001.`, `2.01.08.00002.` … O código reduzido de cada conta **não muda** e nenhum lançamento é perdido.

**2. Escolha do destino com busca**

O diálogo *Mover contas de grupo* ganha um campo de busca por código ou nome (mesmo padrão do seletor de contas dos lançamentos), listando só contas sintéticas, com o nível indicado. A prévia "de → para" continua obrigatória antes de confirmar.

**3. Criar grupo novo direto do diálogo**

Se o grupo de destino ainda não existir, o Admin pode criar uma sintética filha na hora (informando só o nome) — o sistema sugere o próximo código livre no ramo e já usa esse grupo como destino da movimentação.

**4. Como você vai usar (caso do Fornecedores Pecuaristas)**

1. `/razao` › aba **Plano de contas** › **Árvore hierárquica**.
2. Marque o checkbox de **FORNECEDORES PECUARISTAS** (`2.01.01.001.`).
3. Clique em **Mover (1)**, busque e selecione **2.01. — PASSIVO CIRCULANTE**.
4. **Ver prévia**: mostrará `2.01.01.001.` → `2.01.08.` com as 145 filhas junto.
5. **Mover e recalcular**. A natureza continua *Passivo circulante*, os saldos do balancete e dos demonstrativos são recalculados e a mudança fica registrada na trilha de auditoria.

## Detalhes técnicos

- Migração alterando `move_ledger_accounts(_ids, _new_parent_hier, _dry_run)`: substituir o `lpad(_seq,5,'0')` fixo por largura derivada de `hier_level(_parent)+1` (2 / 3 / 5), aplicada tanto ao nó movido quanto ao recorte do ramo descendente; o restante (herança de natureza por prefixo, auditoria em `ledger_account_audit`, `recalc_periods_for_accounts`) permanece igual.
- Nova RPC `create_child_account(_parent_hier, _name)` (Admin, `SECURITY DEFINER`) devolvendo o código hierárquico criado, reutilizando a mesma regra de largura e gerando reduzido sequencial livre.
- Frontend: em `src/components/razao/PlanoDeContasArvore.tsx`, trocar o `Select` de destino por um combobox com busca (padrão de `AccountSelect.tsx`) e acrescentar o atalho "Criar grupo aqui"; nova server function `createChildAccount` em `src/lib/razao.functions.ts`.
- Documentação: atualizar `db/schemas.sql` e `docs/FUNCTIONS.md` com a nova regra de numeração.

## Validação

Mover Fornecedores Pecuaristas para `2.01.`, conferir na árvore que virou `2.01.08.` com as 145 filhas renumeradas, checar que os códigos reduzidos e os lançamentos do período seguem intactos, e ver o registro "movimentacao_hierarquia" na trilha de auditoria.
