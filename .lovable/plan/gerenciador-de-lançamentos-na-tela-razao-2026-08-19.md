# Gerenciador de Lançamentos na tela /razao

A aba **Lançamento** passa a ser um gerenciador no espírito da tela do G2 (grade de lançamentos + barra de comandos + tela de detalhe), mas com o tema oficial do sistema (Synetica). Nada do que já existe — Extrato, Conferência, Pendências, Vínculos, Histórico — é recriado.

## Situação atual verificada

- A tabela `journal_legs` está **vazia nos três períodos** (Janeiro, Maio e Junho/2026): 0 pernas, 0 documentos.
- Ao mesmo tempo existem 281 contas em `ledger_accounts` e 281 saldos anteriores em `journal_account_openings` gravados pelo mesmo import do arquivo "razao contabil junho 26.xls".
- Ou seja: o arquivo foi lido, as contas e os saldos entraram, mas nenhuma perna foi gravada. A gravação só aceita linhas com débito **ou** crédito diferente de zero, então as linhas chegaram com valor zerado. A causa exata (mapeamento de colunas do .xls, ou o arquivo ter sido enviado como tipo "balancete" em vez de "razão") ainda não está confirmada — confirmar isso é a primeira tarefa.
- Sem pernas, o gerenciador abriria vazio. Por isso a importação vem antes da tela.

## Etapa 1 — Fazer os dados chegarem à tela

1. Reproduzir a importação do razão de junho pelo caminho `/importar` › Razão contábil, inspecionando o que o parser produz por linha (débito, crédito, conta, contrapartida, documento, data, histórico) antes do envio.
2. Corrigir o que estiver quebrado no mapeamento/validação e reimportar, com `reset` para não duplicar.
3. Critério: `journal_legs` com dezenas de milhares de pernas no período, débito total = crédito total, e a conferência razão × balancete abrindo com números.

## Etapa 2 — Grade do gerenciador

A aba Lançamento abre já com a **lista do período** (não exige buscar antes), paginada, ordenada por data e documento, com as colunas do G2:

```text
CÓD. MOV. | DOC | CONTA DÉBITO | CONTA CRÉDITO | DATA | VALOR | HISTÓRICO
```

- Campo de busca livre no topo (a `journal_search` já existente), filtros por data e por conta.
- Uma linha = um movimento (par débito/crédito). Linha selecionável; duplo clique ou "Principal" abre o detalhe.
- Rodapé com contagem e soma dos valores exibidos.

## Etapa 3 — Barra de comandos

Barra fixa no rodapé da grade, no estilo dos botões do G2 mas com os componentes do sistema:

- **Novo** — abre o formulário em branco.
- **Editar** — abre o formulário com o movimento selecionado.
- **Cancelar reg.** — cancela o movimento selecionado, com confirmação.
- **Principal** — abre a tela de detalhe do lançamento (todas as pernas do documento + conferência débito = crédito, que já existe).
- **Relatório** — botão presente e desabilitado, com aviso "em breve" (tela futura).
- **Sair** — volta para a grade.

Novo, Editar e Cancelar só ficam habilitados para Admin e em período que não esteja fechado.

## Etapa 4 — Formulário do lançamento

Espelha o formulário do G2, em campos do sistema: Cód. Mov. (só leitura), Conta Débito e Conta Crédito (busca por código reduzido ou nome, com o nome exibido ao lado), Data, Núm. Doc., Valor e Histórico.

Validações antes de salvar: as duas contas existem e são diferentes, data dentro do período, valor maior que zero, histórico obrigatório. Salvar grava as **duas pernas** (débito numa conta, crédito na outra, apontando uma para a outra como contrapartida) e recalcula os indicadores do período.

## Etapa 5 — Cancelamento e rastreabilidade

Cancelar **não apaga**: marca o movimento como cancelado, some dos cálculos e da grade padrão (visível com o filtro "incluir cancelados", em cinza e riscado). Toda criação, edição e cancelamento grava usuário, data e valores anteriores na trilha de auditoria, aparecendo na aba Histórico.

## Etapa 6 — Teste ponta a ponta

Com os dados de junho carregados: buscar, abrir o detalhe, criar um lançamento novo, conferir que ele aparece no extrato das duas contas e nos indicadores, editá-lo, cancelá-lo e confirmar que sai dos cálculos e que as três ações aparecem no Histórico.

## Detalhes técnicos

- Migração em `journal_legs`: colunas `status` (`ativo`/`cancelado`, default `ativo`), `origin` (`importado`/`manual`), `created_by`, `updated_by`, `cancelled_by`, `cancelled_at`, e índice por `(period_id, status, entry_date)`. Todas as leituras existentes (`journal_account_statement`, `journal_search`, `journal_document`, `journal_top_counterparts`, `reconcile_journal_vs_trial_balance`, `recalculate_period_indicators_internal`, `generate_period_statements`) passam a filtrar `status = 'ativo'`.
- Novas RPCs `security definer` com verificação `is_admin()`: `upsert_manual_journal_entry` (cria/edita o par de pernas de forma atômica, cria a conta em `ledger_accounts` se faltar) e `cancel_journal_entry`. Ambas gravam em `ledger_account_audit` e chamam o recálculo do período.
- Nova RPC `journal_entries_grid(_period_id, _query, _from, _to, _account, _include_cancelled, _limit, _offset)` devolvendo linha por movimento (par casado por `doc_number` + valor), com total para a paginação.
- Server functions novas em `src/lib/razao.functions.ts` (`listJournalEntries`, `saveManualJournalEntry`, `cancelJournalEntry`), no mesmo padrão das atuais, com `requireSupabaseAuth`.
- A aba Lançamento em `src/routes/_authenticated/razao.tsx` sai para um componente próprio em `src/components/razao/GerenciadorLancamentos.tsx` (a rota já está grande), com máquina de estado `lista | detalhe | novo | edicao`.
- Documentação: atualizar `docs/FUNCTIONS.md`, `docs/ESTRUTURA.md`, `docs/PAGINAS.md` e `docs/DEPARA.md` com as novas RPCs, colunas e comandos da tela.
