# Painel de lançamentos: visão agrupada por conta

Hoje o painel lateral lista os lançamentos um a um (a linha "Receita bruta" de abril tem 1.701 deles). Vamos acrescentar uma visão **Agrupado por conta**, com os totais por conta e a possibilidade de abrir cada grupo para editar os lançamentos ali dentro.

## Como fica

No topo do painel, ao lado da busca, um seletor com duas visões:

- **Lista** — exatamente o que existe hoje.
- **Por conta** — uma linha por conta, com: código, nome, quantidade de lançamentos e valor total (mais o total oculto, quando houver). Ordenado do maior valor para o menor.

Na visão "Por conta" há ainda um segundo seletor de qual conta usar no agrupamento:

- **Conta da linha** (padrão) — a conta do demonstrativo que originou o clique (útil quando a linha soma várias contas, ex.: 7 contas de receita).
- **Contrapartida** — a conta do outro lado do lançamento (mostra, por exemplo, quais clientes/fornecedores compõem o valor).

Clicar em um grupo expande e carrega os lançamentos daquela conta dentro do próprio painel, com os mesmos recursos já existentes: editar, reclassificar, ocultar/reexibir, cancelar e comentar. Editar dentro do grupo atualiza os totais na hora.

Os filtros de busca, período e "Mostrar ocultos" valem para as duas visões, e a visão escolhida fica salva no navegador.

```text
Por conta ▾   contrapartida ▾        [buscar]  [x] mostrar ocultos
─────────────────────────────────────────────────────────────────
▸ 041121 VENDAS DE CARNES              1.204 lçtos   R$ 12.980.114,20
▾ 041133 VENDAS DE MIUDOS                312 lçtos    R$ 1.102.440,07
     30/04 doc 101074  D 011203 ... × C 041133 ...   R$ 244,73  [editar]
     ...
▸ 041140 VENDAS DE SEBO                  185 lçtos    R$   250.999,80
```

## Detalhes técnicos

- **Banco**: nova RPC `journal_line_accounts(_period_id, _codes text[], _from, _to, _query, _include_hidden, _side text)` — agrega `journal_legs` sobre **todos** os lançamentos que compõem a linha (não só os 300 carregados na lista), retornando por conta: `reduced_code`, `name`, `qtd`, `total`, `qtd_oculta`, `total_oculto`. `_side = 'linha' | 'contrapartida'`. Mesmos filtros e mesma regra de status da `journal_line_legs`, `security definer`, leitura para autenticados.
- **Backend**: server function `listLineAccounts` em `src/lib/razao.functions.ts`, no mesmo padrão de `listLineLegs`.
- **Frontend**: `src/components/razao/PainelLancamentosLinha.tsx` ganha o estado de visão/lado (persistido em `localStorage`) e um bloco de grupos com expansão. Ao expandir, reaproveita `listLineLegs` passando a conta do grupo como filtro adicional; a lista de linhas de um grupo usa exatamente o mesmo componente de linha da visão em lista, sem duplicar a lógica de edição.
- **Documentação**: `docs/FUNCTIONS.md`, `docs/PAGINAS.md` e `db/schemas.sql` atualizados com a nova RPC e a visão agrupada.
