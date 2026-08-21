# Painel de lançamentos dentro de Demonstrativos

Hoje, clicar numa linha da DRE/Balanço/Fluxo tira você da tela e leva para `/razao`. Passa a abrir um **painel lateral** na própria tela de Demonstrativos, com os lançamentos daquela linha prontos para editar — sem perder o número de vista.

## Como fica

```text
+---------------------------+-------------------------------------+
| DRE / Balanço / Fluxo     | Lançamentos: "Despesas operacionais"|
| (linhas clicáveis)        | [busca] [período] [x] ocultos       |
|                           | -----------------------------------|
| Receita bruta   16.791.473| 05/06 023101 ... 1.200,00  [•••]    |
| Despesas oper.    569.879 | 07/06 023410 ... 3.400,00  [•••]    |
|                           | -----------------------------------|
|                           | Editar | Reclassificar | Ocultar    |
|                           | Comentários (3)                     |
+---------------------------+-------------------------------------+
```

- Painel lateral redimensionável, aberto por cima da coluna direita; fecha com Esc.
- Ícone **abrir em nova aba** no cabeçalho do painel, que leva ao `/razao` já filtrado (comportamento atual, agora opcional).
- Seleção de linha na grade; edição em linha para valor, data, documento, histórico e contas de débito/crédito (mesmo motor de gravação já usado no razão).
- Ao gravar, o demonstrativo à esquerda recalcula e destaca a linha alterada.

## Ações disponíveis no painel

1. **Editar** — valor, data, documento, histórico, conta de débito e de crédito (campo com busca por código e nome).
2. **Reclassificar** — trocar a conta do lançamento para outra do plano, com registro na trilha de auditoria.
3. **Ocultar de todos os relatórios** — marca o lançamento como excluído: ele some de DRE, Balanço, Fluxo, indicadores e balancete derivado, e continua visível no razão com selo "Oculto" e motivo. Reversível por um clique.
4. **Comentários** — popup com histórico por lançamento: autor, data/hora e texto; vários comentários por lançamento, sem edição destrutiva.
5. **Cancelar lançamento** — mantém a ação já existente hoje.

Editar, ocultar e cancelar seguem a regra atual: bloqueados em período fechado e restritos a quem já pode editar o razão. Comentar é permitido a qualquer usuário autenticado.

## Banco de dados

Uma migração:

- `journal_legs`: colunas `is_excluded boolean not null default false`, `excluded_reason text`, `excluded_by uuid` → `profiles.id`, `excluded_at timestamptz`.
- Nova tabela `journal_leg_comments` (`id`, `leg_id` → `journal_legs`, `author_id` → `profiles`, `body`, `created_at`), com GRANTs, RLS (leitura para autenticados; escrita/edição só do próprio autor; admin apaga) e índice por `leg_id`.
- Funções de cálculo passam a ignorar lançamentos ocultos: `period_account_balances`, `generate_period_statements`, `recalculate_period_indicators_internal`, `trial_balance_report`, `journal_report_analytic`, `closing_summary` e o fechamento parcial/anual. `journal_entries_grid` e `journal_search` ganham a flag e um filtro opcional "mostrar ocultos", para que o razão continue mostrando tudo.
- Nova RPC `set_journal_leg_excluded(_leg_id, _excluded, _motivo)` gravando trilha em `ledger_account_audit` e `activity_log`, com o mesmo bloqueio de período fechado do ajuste manual.
- RPC `journal_line_legs(_period_id, _codes text[], _from, _to, _kind, _include_hidden)` para alimentar o painel com os lançamentos exatos que compõem a linha clicada.

## Detalhes técnicos

- Novo componente `src/components/razao/PainelLancamentosLinha.tsx` (Sheet do shadcn, largura ajustável, persistida em `localStorage`) reaproveitando `AccountSelect`, formatação e mutações de `src/lib/razao.functions.ts`.
- Novo componente `ComentariosLancamento.tsx` (popover + lista) com server functions `listLegComments` / `addLegComment` em `src/lib/razao.functions.ts`.
- `src/routes/_authenticated/demonstrativos.tsx`: `handleDrill` deixa de navegar e passa a abrir o painel com `{codes, kind, from, to, label}`; o botão de nova aba mantém a navegação atual.
- Server functions novas: `listLineLegs`, `setLegExcluded`, além das de comentário — todas com `requireSupabaseAuth`.
- Invalidações de cache após gravar: `financial_statements`, `conferencia_balanco`, `indicators`, `journal_grid`, `journal_document`.
- `ConferenciaBalanco` e o card de demonstrativo mostram um aviso quando há lançamentos ocultos no período, com contagem e valor total ocultado — nada some sem sinalização.

## Documentação

Atualizar `db/schemas.sql`, `docs/FUNCTIONS.md` e `docs/PAGINAS.md` com a nova coluna, a tabela de comentários, as RPCs e o comportamento do painel.
