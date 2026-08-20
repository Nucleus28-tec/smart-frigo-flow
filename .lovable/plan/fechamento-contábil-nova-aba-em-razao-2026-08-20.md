# Fechamento Contábil (nova aba em /razao)

Quarta aba de `/razao`, no mesmo padrão visual das telas 0163 do G2: grade dos 12 meses do ano de referência, fechamento parcial mês a mês, fechamento e cancelamento do exercício, e geração do balancete (analítico ou sintético) em tela, PDF e Excel.

## Situação atual verificada

- Existem 3 períodos cadastrados (Janeiro, Maio e Junho/2026), todos com status `aberto`.
- `accounting_periods.status` já aceita `aberto` / `em_revisao` / `fechado`, e o balancete já bloqueia edição em período fechado.
- O razão importado de Junho/2026 **já contém** lançamentos de encerramento vindos do G2 (histórico "Encerramento parcial 06/2026" e "Resultado parcial 06/2026", contra `023511` e `023413`). O fechamento do Rotta precisa detectar e não duplicar esses lançamentos.

## 1. Grade do ano

- Seletor de **Ano de referência** e botões **Jan … Dez** + **Todos**, como no G2.
- Cada mês mostra seu estado: sem período cadastrado, aberto, fechado (com data e quem fechou).
- Meses sem período podem ser criados na hora, ao fechar ou ao gerar balancete.
- Quadro-resumo do mês/período selecionado com as 4 linhas sintéticas (Ativo, Passivo, Custos e Despesas, Receitas) e as colunas Saldo anterior, Débito, Crédito, Saldo do período e Saldo atual, com sufixo D/C.

## 2. Fechamento parcial (mês)

- Zera as contas de resultado do mês contra a **Conta Resultado do Exercício** (padrão `023511`) e leva o resultado apurado para a **Conta Lucro/Prejuízo** (padrão `023413`). As duas contas ficam configuráveis na tela e são lembradas entre sessões.
- Os lançamentos gerados entram no razão marcados como origem "fechamento", agrupados por um identificador único do fechamento, com data no último dia do mês e histórico "Encerramento parcial MM/AAAA".
- Se o mês já vier com encerramento do G2, a tela avisa e oferece: usar o que já existe (só travar) ou gerar o encerramento do Rotta.
- Ao concluir: período vira `fechado`, indicadores e demonstrativos do período são recalculados, e a ação é registrada na trilha de auditoria.
- **Ordem obrigatória:** só fecha o mês N se todos os meses anteriores do ano (que tenham período cadastrado) já estiverem fechados.

## 3. Fechamento do exercício

- Habilitado somente quando os 12 meses do ano estiverem fechados.
- Gera o lançamento de encerramento anual (transferência do saldo de `023511` para `023413`) datado em 31/12 e marca o exercício como fechado.

## 4. Cancelamento (reabertura)

- **Cancelar fechamento do exercício** volta o ano para aberto e estorna o lançamento anual.
- **Cancelar fechamento do mês** só é permitido se o exercício estiver aberto e se todos os meses posteriores já estiverem reabertos. Ex.: para reabrir dezembro/2025 é preciso cancelar o fechamento anual de 2025 e reabrir os meses seguintes ao mês desejado.
- A tela mostra em texto claro o que falta cancelar antes de liberar a reabertura, em vez de só desabilitar o botão.
- O cancelamento anula (não apaga) os lançamentos de encerramento daquele fechamento, mantendo o histórico, e devolve o período para `aberto`.
- Fechar / cancelar é exclusivo do Admin; o Usuário vê a tela e gera relatórios.

## 5. Geração do balancete

- Botão **Gerar balancete** com as opções do G2:
  - **Analítico** (contas analíticas com movimento) ou **Sintético** (totais por grupo).
  - **Data inicial / Data final** (padrão: primeiro e último dia do mês selecionado; no modo "Todos", o ano inteiro).
  - **Exibir plano de contas**: acrescenta a coluna do código hierárquico ao lado do código reduzido; sem a opção, sai só o código reduzido.
- Resultado apresentado em tela e exportável em **PDF** e **Excel**, no mesmo padrão dos relatórios já existentes na aba Relatórios (cabeçalho da empresa, período, colunas Saldo anterior / Débito / Crédito / Saldo atual com D/C e totalizadores).

## Detalhes técnicos

- Migração:
  - Tabela `accounting_closings` (`id`, `year`, `month` nulo para o anual, `period_id`, `kind` mensal/anual, `status` fechado/cancelado, `entry_group`, `closed_by/at`, `reopened_by/at`) com GRANTs e RLS (leitura autenticada, escrita via `is_admin()`).
  - Chaves em `app_settings` para as contas `023511` e `023413`.
  - `journal_legs.origin` passa a aceitar `fechamento`.
- RPCs `SECURITY DEFINER`: `closing_year_grid(_year)`, `close_period_partial(_period_id, _result_code, _profit_code, _mode)`, `close_fiscal_year(_year)`, `reopen_period(_period_id)`, `reopen_fiscal_year(_year)`. Toda a validação de sequência mora no banco; a tela apenas reflete o retorno.
- `trial_balance_report` ganha os parâmetros de modo (analítico/sintético) e de exibição do plano de contas; os construtores de PDF/Excel em `src/lib/razao-report.server.ts` ganham o layout de balancete sintético.
- Server functions novas em `src/lib/razao.functions.ts` (`requireSupabaseAuth`, admin verificado no banco) e componente `src/components/razao/FechamentoContabil.tsx`, plugado como quarta aba em `src/routes/_authenticated/razao.tsx`.
- Bloqueio de edição em período fechado estendido às operações do razão (`upsert_manual_journal_entry`, `cancel_journal_entry`, importação sobre o período).
- `db/schemas.sql` e `docs/ESTRUTURA.md`, `docs/FUNCTIONS.md`, `docs/DEPARA.md`, `docs/PAGINAS.md` atualizados com a nova tabela, RPCs e tela.

## Validação

Com o admin: fechar Janeiro/2026, tentar fechar Junho antes de Maio (deve recusar explicando a ordem), fechar Maio e Junho, conferir os lançamentos de encerramento no razão, cancelar o fechamento de Junho e confirmar que o período volta a aceitar edição, e gerar o balancete analítico e sintético em tela, PDF e Excel com e sem a coluna de plano de contas.
