# Busca livre de lançamentos no Razão

Hoje a aba "Lançamento" de `/razao` só abre um documento quando o usuário já sabe o número exato. Vou acrescentar a busca livre por texto, no espírito da tela 0161 do G2, sem tocar nas demais abas.

## O que será feito

**1. Busca no banco (nova RPC `journal_search`)**

Uma função nova no Postgres recebe período, termo, limite e deslocamento e devolve os lançamentos que combinam com o termo em qualquer um destes campos:

- número do documento
- código reduzido e nome da conta (via `ledger_accounts`)
- código reduzido e nome da contrapartida
- texto do histórico

A comparação ignora maiúsculas/minúsculas e acentos ("jose" acha "JOSÉ"). Resultado ordenado por data decrescente (e por número do lançamento), paginado, sempre restrito ao período selecionado. Retorna também o total de linhas encontradas para a paginação.

Para não pesar em períodos com dezenas de milhares de pernas, crio índices de texto (trigram/GIN) sobre histórico, número do documento e nomes de conta já normalizados sem acento, além do índice por período.

**2. Nova sub-visão "Buscar" dentro da aba Lançamento**

A aba passa a ter dois modos: **Buscar** (padrão) e **Abrir por número** (o comportamento atual, intacto).

No modo Buscar: um único campo de texto ("Núm. doc., conta, contrapartida, histórico ou valor"), com resultado em tabela única — Data, Núm. Doc., Conta Débito, Conta Crédito, Valor, Histórico — paginada, ordenada da mais recente para a mais antiga, seguindo o design system do projeto.

Cada linha é clicável e abre o lançamento completo já existente (a mesma visão por número de documento), com um botão "voltar à busca". Os botões de exportar CSV/PDF já usados nas outras visões também ficam disponíveis para o resultado da busca.

Se o termo for exatamente um número de documento existente, a busca continua trazendo esse lançamento normalmente — o fluxo atual não regride.

**3. Documentação**

Acrescento `journal_search` e a server function `searchJournalLegs` ao `docs/FUNCTIONS.md` e ao `docs/DEPARA.md`, no mesmo padrão das entradas do razão já documentadas.

## Detalhes técnicos

- Migração: extensões `unaccent` e `pg_trgm`; função imutável de normalização (minúsculas + sem acento); coluna gerada/índices GIN trigram em `journal_legs` (`historico`, `doc_number`) e em `ledger_accounts` (`name`, `reduced_code`); RPC `journal_search(_period_id uuid, _query text, _limit int, _offset int)` como `SECURITY DEFINER` com `search_path = public`, retornando `jsonb` — mesmo padrão e mesma regra de leitura (autenticado) das demais RPCs do razão.
- A busca casa também valor numérico quando o termo se parece com um número (débito ou crédito), como no campo único do G2.
- `src/lib/razao.functions.ts`: nova `searchJournalLegs` com `requireSupabaseAuth`, validação Zod (período uuid, termo com mínimo de 2 caracteres, limite máx. 200) chamando a RPC pelo helper `callRpc` já existente.
- `src/routes/_authenticated/razao.tsx`: apenas o conteúdo da aba `lancamento` muda; nenhuma outra aba é alterada. Busca com debounce (~300 ms) e `useQuery` por termo/página.

## Fora desta etapa

Tela de Fechamento Contábil / balancete mensal por grupo, e qualquer mudança nas abas Extrato, Conferência, Pendências, Vínculos e Histórico.
