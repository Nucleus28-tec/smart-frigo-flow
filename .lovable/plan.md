# Documentação do Razão Contábil + validação ponta a ponta

Duas entregas: (1) atualizar toda a documentação do pacote para incluir o razão contábil como fonte do movimento; (2) rodar uma validação real do fluxo importação → processamento → resultado, com geração dos documentos.

## 1. Atualização dos documentos

| Documento | O que muda |
|---|---|
| `docs/README.md` | Descrição do sistema passa a citar o razão como fonte do movimento e o balancete como estrutura/espelho; mapa de arquivos ganha as novas telas e o `ARQUITETURA.md`. |
| `docs/SKILL.md` | Ordem de construção inclui a etapa "importar razão → casar com balancete → calcular"; regra: cálculo prefere razão quando existe. |
| `docs/PROCESSO.md` | Fluxo de negócio revisado: seleção de período → importar balancete (estrutura) → importar razão (PDF/CSV/Excel com mapeamento) → casamento automático → fila de vínculos e pendências → reclassificação → demonstrativos → apontamentos. Inclui a regra de auditoria (nada aplicado silenciosamente, tudo registrado). |
| `docs/ESTRUTURA.md` | Tabelas `ledger_accounts`, `journal_legs`, `journal_account_openings`, `trial_balance_lines`, `ledger_account_audit`, `agent_threads`, `agent_messages`; rotas `/razao` e `/agentes`. |
| `docs/FUNCTIONS.md` | RPCs novas (`import_journal_legs`, `import_trial_balance_lines`, `link_reduced_accounts`, `reconcile_journal_vs_trial_balance`, `journal_pending_report`, `journal_account_statement`, `journal_document`, `journal_top_counterparts`, `set_account_link`) e as server functions de `razao.functions.ts`. Substitui a linguagem de "Edge Functions" pela de server functions, que é o que o projeto usa. |
| `docs/PAGINAS.md` | Especificação da tela `/razao` (Extrato, Lançamento, Conferência, Pendências, Vínculos, Histórico) e do passo de mapeamento de colunas em `/importar`. |
| `docs/DEPARA.md` | Matriz atualizada: cada tabela nova → funções → páginas. |
| `docs/PLANO.md` | Nova fase concluída: "Razão contábil e auditoria". |
| `docs/ARQUITETURA.md` | Revisão da lógica de cálculo (razão preferido, balancete como fallback) e das ferramentas de razão dos agentes. |
| `db/schemas.sql` | Passa a refletir o schema atual, incluindo as tabelas do razão, da auditoria e dos agentes, com GRANTs e RLS no padrão do projeto. |

`docs/PRD.md` e `docs/PRS.md` recebem apenas os requisitos novos referentes ao razão (importação por planilha, casamento, auditoria, exportação).

## 2. Validação do fluxo

Executada no navegador contra o app rodando, autenticado, no período de referência:

1. **Importação** — subir o razão (PDF e planilha) e o balancete em `/importar`, passar pelo mapeamento de colunas, conferir contagem de linhas válidas × com problema e confirmar a gravação em blocos.
2. **Processamento** — verificar o casamento automático razão × balancete, quantas contas foram vinculadas por cada regra, e o que restou em Pendências/Vínculos com a causa provável.
3. **Resultado** — conferir em `/razao` o extrato de uma conta com contrapartida, o lançamento completo (débito = crédito), a conferência contra o balancete, e em `/dashboard` e `/demonstrativos` que os indicadores e a DRE/BP/FC indicam fonte "razão".
4. **Documentos** — exportar extrato e pendências em CSV e PDF, e a DRE em PDF e Excel; abrir os arquivos gerados para confirmar cabeçalho, colunas e valores.
5. **Auditoria** — confirmar que os vínculos aplicados aparecem na aba Histórico com usuário, data e antes → depois.

Cada etapa é reportada com o que foi observado; qualquer falha encontrada é corrigida antes de seguir.

## Detalhes técnicos

- Validação com Playwright sobre `localhost:8080`, com sessão Supabase restaurada; consultas de conferência direto no banco (contagens de `journal_legs`, `trial_balance_lines`, `ledger_accounts` sem vínculo, `dashboard_indicators`).
- Se não houver arquivo de razão disponível no ambiente para o upload, a validação usa os dados já importados do período existente e o passo 1 é verificado pelos registros de `imported_files` e `recalculation_logs`.
- Documentação sem alteração de código de produto; correções de código só se a validação apontar defeito.
