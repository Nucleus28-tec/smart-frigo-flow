# Relatórios do Razão Contábil

Nova aba **Relatórios** dentro de `/razao` (ao lado de Lançamentos e Plano de contas), no mesmo padrão visual das grades já construídas, replicando o comportamento da tela 0173 do G2.

## Como funciona na tela

1. **Painel de filtros (topo)**
   - Tipo de relatório: `Razão Contábil Analítico` ou `Balancete Analítico`.
   - Data movimento: `de` / `até` (pré-preenchido com o período selecionado).
   - Núm. documento (opcional, só no razão).
   - Multi página: Sim/Não — quando Sim, cada conta começa e termina em página própria no PDF (e em aba/seção separada na planilha).

2. **Grade de contas (centro)**
   - Lista todas as contas do plano de contas (`ledger_accounts`), colunas Código, Plano de contas (hierárquico), Descrição — igual ao print do G2.
   - Busca livre por código, código hierárquico ou descrição.
   - Checkbox por linha + "selecionar todas as visíveis" + "limpar seleção". Nenhuma conta marcada = todas as contas com movimento no intervalo.
   - Filtro opcional "somente contas com movimento no período".

3. **Ações**: `Visualizar` (renderiza na tela), `Exportar PDF`, `Exportar Excel`, `Limpar`.

4. **Resultado na tela**
   - *Razão analítico*: por conta — cabeçalho `CONTA: código - nome`, `SALDO ANTERIOR`, linhas com Código, Data, Contra-partida, Histórico, Débito, Crédito, Saldo atual; rodapé com totais de débito/crédito e saldo final; contador "Total de itens".
   - *Balancete analítico*: linhas com Código, Descrição, Saldo anterior, Débito, Crédito, Saldo atual, com totalizadores por grupo/nível e total geral.

## Dados

- Contas: `ledger_accounts` (via RPC `chart_accounts_grid` já existente).
- Razão: nova RPC `journal_report_analytic(_period_id, _codes text[], _from, _to, _doc_number)` que devolve, por conta, saldo anterior calculado (`journal_account_openings` + movimentos anteriores à data inicial), as linhas do intervalo e os totais — mesma lógica já usada em `journal_account_statement`, porém multi-conta e com recorte por data.
- Balancete: nova RPC `trial_balance_report(_period_id, _codes text[], _from, _to)` que consolida `journal_legs` no intervalo por conta e reconcilia com `trial_balance_lines` quando existir.
- Ambas `SECURITY DEFINER`, `search_path` fixo, `EXECUTE` só para `authenticated` e `service_role`.

## Exportação

- Server function `exportLedgerReport` em `src/lib/razao.functions.ts` (padrão de `exportReport`): monta os dados pela RPC, gera o arquivo em `src/lib/razao-report.server.ts` (`pdf-lib` + `xlsx`, cabeçalho da marca Rotta igual a `reports.server.ts`), grava no bucket privado `exports` e devolve signed URL para download.
- PDF: paisagem A4, cabeçalho repetido por página; com **multi página** ligado, cada conta inicia em página nova.
- Excel: uma aba única com todas as contas; com **multi página** ligado, uma aba por conta (nome = código, limite de 31 chars), mais aba Resumo.
- Registra `log_activity` a cada exportação.

## Detalhes técnicos

- Novo componente `src/components/razao/RelatoriosRazao.tsx`; `razao.tsx` ganha a terceira `TabsTrigger`.
- Reaproveita `AccountChip`, modo compacto, colunas redimensionáveis e ordenação já existentes nas grades do razão.
- Estados de carregando (skeleton), vazio e erro conforme padrão `PageState`.
- Visualização/exportação disponível para Admin e Usuário (leitura); nenhuma escrita de dados contábeis nesta tela.
- Migração SQL apenas cria as duas RPCs — nenhuma tabela nova.
