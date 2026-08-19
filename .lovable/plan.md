# Plano de contas do razão (dentro de Razão contábil)

Nova tela de cadastro do plano de contas, no mesmo padrão visual da grade de Lançamentos, alimentada exclusivamente pelas contas do razão (`ledger_accounts`).

## Situação atual verificada

- `ledger_accounts` tem **1.175 contas** vindas do razão, **todas sem código hierárquico e sem natureza** (0 confirmadas). Hoje não há como saber a que grupo cada conta pertence.
- O PDF anexo traz **1.316 contas** com o de-para completo: código reduzido (6 dígitos), código hierárquico (`1.01.01.002.00006.`), descrição, tipo (SINTÉTICA/ANALÍTICA) e saldo inicial.
- A tela `/plano-de-contas` atual trabalha sobre `chart_of_accounts` (contas do balancete), não sobre o razão.

## 1. Carga do plano de contas oficial

O PDF é lido uma vez e as 1.316 contas são gravadas em `ledger_accounts`, casando pelo código reduzido: as 1.175 existentes recebem código hierárquico, descrição oficial, nível, conta-pai e tipo (sintética/analítica); as demais entram como contas novas.

Classificação automática pelo prefixo hierárquico, conforme a estrutura do próprio plano:

```text
1.01.*  Ativo circulante        3.01.*  Custo (CMV)
1.02.*  Ativo não circulante    3.02.*  Despesa (operacionais)
2.01.*  Passivo circulante      3.03.*  Despesa (não operacionais)
2.02.*  Passivo não circulante  4.01.*  Receita
2.03.*  Patrimônio líquido
```

Contas classificadas assim entram como confirmadas; o que não casar fica pendente para revisão na tela.

## 2. Tela "Plano de contas" dentro de Razão contábil

Mesma linguagem da grade de Lançamentos: cabeçalho com ordenação por clique, colunas redimensionáveis, densidade compacta/confortável (preferências salvas no navegador), busca e paginação.

Colunas: código reduzido (chip colorido por grupo), código hierárquico, descrição, tipo (sintética/analítica), nível, natureza, situação (ativa/inativa) e nº de lançamentos no período.

Filtros: busca por código ou descrição, natureza, tipo, "pendentes de classificação" e "somente ativas".

Comandos na barra superior, no padrão G2 já usado: **Novo**, **Editar**, **Desativar/Reativar**, **Reclassificar selecionadas**, **Exportar** (CSV/PDF).

- **Novo / Editar** — formulário com código reduzido, código hierárquico, descrição, tipo e natureza; valida duplicidade de código e coerência entre natureza e prefixo hierárquico (avisa, não bloqueia).
- **Seleção múltipla** por checkbox, com "selecionar todos os filtrados".
- **Reclassificar em lote** — aplica uma natureza e/ou reancora o ramo hierárquico (ex.: mover contas para `3.02.01.005.`) às contas selecionadas, recalculando nível e conta-pai.
- **Desativar** — a conta some das listas de seleção de novos lançamentos, mas continua exibida no histórico. Não apaga nada.

Edição restrita ao Admin; usuário comum vê em modo leitura, como nas demais telas.

Toda alteração (natureza, hierarquia, descrição, ativação) é gravada em `ledger_account_audit`, que já existe, e aparece na trilha de auditoria.

## 3. Efeito no resto do sistema

Com o de-para preenchido, a grade de Lançamentos passa a mostrar o nome oficial das contas de débito e crédito, e os indicadores/demonstrativos calculados pelo razão passam a agregar corretamente por natureza.

A tela antiga `/plano-de-contas` (contas do balancete) sai do menu; a de razão vira o cadastro oficial.

## Detalhes técnicos

- Migração: `ledger_accounts` ganha `is_active boolean not null default true` e `account_type text` (sintética/analítica derivada de `is_analytic`, mantendo a coluna atual); índice único em `reduced_code` se ainda não existir.
- Carga do PDF: parse offline do texto do PDF (posição fixa de colunas) gerando `INSERT ... ON CONFLICT (reduced_code) DO UPDATE` numa migração de dados, sem IA — o layout é fixo.
- Novas RPCs `SECURITY DEFINER`: `chart_accounts_grid(_period_id, _query, _nature, _type, _only_pending, _only_active, _limit, _offset)` devolvendo linhas + total + contagem de lançamentos; `upsert_ledger_account(...)`; `set_ledger_accounts_nature(_ids uuid[], _nature, _parent_code)`; `set_ledger_account_active(_id, _active)`. Todas gravam em `ledger_account_audit` e checam `is_admin()` para escrita.
- Frontend: `src/components/razao/PlanoDeContasRazao.tsx` reaproveitando os padrões de `GerenciadorLancamentos.tsx` (ordenação, resize, densidade, `AccountChip`), e `src/routes/_authenticated/razao.tsx` passa a ter duas visões — Lançamentos e Plano de contas — com `head()` próprio.
- Server functions em `src/lib/razao.functions.ts` (`listChartAccounts`, `saveLedgerAccount`, `bulkReclassifyAccounts`, `toggleLedgerAccount`).

## Validação

Carregar o plano, abrir a tela, conferir que as contas de banco aparecem como Ativo circulante e as de salário como Despesa, criar uma conta nova, reclassificar três contas de uma vez, desativar uma conta e conferir o registro na trilha de auditoria; depois abrir Lançamentos e ver os nomes das contas na grade.
