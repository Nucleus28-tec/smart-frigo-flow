/** Ferramentas (somente leitura) dos agentes de IA. */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { RECLASS_NATURES } from "@/lib/reclass.server";
import type { AgentKey } from "./personas";

type Db = SupabaseClient<Database>;

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type EntryRow = {
  account_id: string | null;
  source_account_name: string;
  raw_value: number | string;
  reviewed_value: number | string | null;
  nature: string | null;
  is_manually_edited: boolean;
};

async function loadEntries(supabase: Db, periodId: string): Promise<EntryRow[]> {
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("account_id, source_account_name, raw_value, reviewed_value, nature, is_manually_edited")
    .eq("period_id", periodId)
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EntryRow[];
}

const valueOf = (row: EntryRow) =>
  Number(row.reviewed_value ?? row.raw_value ?? 0) || 0;

function aggregate(entries: EntryRow[]) {
  const byNature = new Map<string, { total: number; count: number }>();
  for (const row of entries) {
    const key = row.nature ?? "sem_natureza";
    const current = byNature.get(key) ?? { total: 0, count: 0 };
    current.total += valueOf(row);
    current.count += 1;
    byNature.set(key, current);
  }
  return Array.from(byNature.entries())
    .map(([nature, v]) => ({ nature, total: v.total, total_formatado: brl(v.total), lancamentos: v.count }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/** Ferramentas de leitura disponíveis para os dois agentes. */
export function buildAgentTools(options: {
  supabase: Db;
  periodId: string | null;
  agent: AgentKey;
}): ToolSet {
  const { supabase, periodId, agent } = options;

  const requirePeriod = () => {
    if (!periodId) throw new Error("Nenhum período contábil selecionado.");
    return periodId;
  };

  const tools: ToolSet = {
    resumo_periodo: tool({
      description:
        "Resumo do período selecionado: totais por natureza, conferência ativo x passivo+PL, " +
        "sugestões pendentes, apontamentos abertos e status dos demonstrativos.",
      inputSchema: z.object({}),
      execute: async () => {
        const id = requirePeriod();
        const [{ data: summary }, entries] = await Promise.all([
          supabase.rpc("get_period_summary", { _period_id: id }),
          loadEntries(supabase, id),
        ]);
        const groups = aggregate(entries);
        const totalOf = (n: string) => groups.find((g) => g.nature === n)?.total ?? 0;
        const ativo = totalOf("ativo_circulante") + totalOf("ativo_nao_circulante");
        const passivoPl =
          totalOf("passivo_circulante") + totalOf("passivo_nao_circulante") + totalOf("patrimonio_liquido");
        const receita = totalOf("receita");
        const custo = totalOf("custo");
        const despesa = totalOf("despesa");
        return {
          resumo_banco: summary ?? null,
          totais_por_natureza: groups,
          conferencia: {
            ativo: brl(ativo),
            passivo_mais_pl: brl(passivoPl),
            diferenca: brl(ativo - passivoPl),
            fecha: Math.abs(ativo - passivoPl) < 0.01,
          },
          resultado: {
            receita: brl(receita),
            custo: brl(custo),
            despesa: brl(despesa),
            resultado: brl(receita - custo - despesa),
          },
          lancamentos: entries.length,
        };
      },
    }),

    balancete_por_natureza: tool({
      description:
        "Detalha as maiores contas de uma natureza contábil no período (subtotal e top contas).",
      inputSchema: z.object({
        natureza: z.enum(RECLASS_NATURES),
        limite: z.number().describe("Quantas contas retornar (máximo 30)"),
      }),
      execute: async ({ natureza, limite }) => {
        const id = requirePeriod();
        const entries = (await loadEntries(supabase, id)).filter((e) => e.nature === natureza);
        const byAccount = new Map<string, { nome: string; total: number; editado: boolean }>();
        for (const row of entries) {
          const key = row.account_id ?? row.source_account_name;
          const current = byAccount.get(key) ?? {
            nome: row.source_account_name,
            total: 0,
            editado: false,
          };
          current.total += valueOf(row);
          current.editado = current.editado || row.is_manually_edited;
          byAccount.set(key, current);
        }
        const contas = Array.from(byAccount.values())
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
          .slice(0, Math.min(Math.max(1, Math.round(limite || 10)), 30))
          .map((c) => ({ ...c, total_formatado: brl(c.total) }));
        const subtotal = entries.reduce((acc, e) => acc + valueOf(e), 0);
        return { natureza, subtotal: brl(subtotal), contas };
      },
    }),

    contas_sem_natureza: tool({
      description:
        "Lista as contas do plano de contas usadas no período que ainda não têm natureza definida ou confirmada.",
      inputSchema: z.object({ limite: z.number().describe("Máximo de contas (até 60)") }),
      execute: async ({ limite }) => {
        requirePeriod();
        const { data, error } = await supabase
          .from("chart_of_accounts")
          .select("id, source_code, source_name, nature, is_confirmed, confidence_score")
          .or("nature.is.null,is_confirmed.eq.false")
          .order("source_name")
          .limit(Math.min(Math.max(1, Math.round(limite || 30)), 60));
        if (error) throw new Error(error.message);
        return { contas: data ?? [] };
      },
    }),

    indicadores: tool({
      description: "Indicadores calculados do período (dashboard).",
      inputSchema: z.object({}),
      execute: async () => {
        const id = requirePeriod();
        const { data, error } = await supabase
          .from("dashboard_indicators")
          .select("indicator_key, indicator_value, calculated_at")
          .eq("period_id", id);
        if (error) throw new Error(error.message);
        return { indicadores: data ?? [] };
      },
    }),

    demonstrativos: tool({
      description: "Demonstrativos gerados do período (DRE, balanço patrimonial e outros).",
      inputSchema: z.object({}),
      execute: async () => {
        const id = requirePeriod();
        const { data, error } = await supabase
          .from("financial_statements")
          .select("statement_type, content, generated_at")
          .eq("period_id", id);
        if (error) throw new Error(error.message);
        return { demonstrativos: data ?? [] };
      },
    }),

    apontamentos: tool({
      description: "Apontamentos (achados de auditoria) registrados no período.",
      inputSchema: z.object({
        status: z.enum(["aberto", "resolvido", "todos"]).describe("Filtro de status"),
      }),
      execute: async ({ status }) => {
        const id = requirePeriod();
        let query = supabase
          .from("audit_findings")
          .select("id, finding_type, description, suggested_fix, severity, status, created_at")
          .eq("period_id", id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (status !== "todos") query = query.eq("status", status);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return { apontamentos: data ?? [] };
      },
    }),

    comparar_periodos: tool({
      description:
        "Compara os totais por natureza do período selecionado com outro período informado pelo rótulo.",
      inputSchema: z.object({ periodo: z.string().describe('Rótulo do outro período, ex: "Dezembro/2025"') }),
      execute: async ({ periodo }) => {
        const id = requirePeriod();
        const { data: periods, error } = await supabase
          .from("accounting_periods")
          .select("id, label")
          .ilike("label", `%${periodo}%`)
          .limit(1);
        if (error) throw new Error(error.message);
        const other = periods?.[0];
        if (!other) return { erro: `Período "${periodo}" não encontrado.` };
        const [atual, anterior] = await Promise.all([
          loadEntries(supabase, id),
          loadEntries(supabase, other.id),
        ]);
        return {
          periodo_comparado: other.label,
          atual: aggregate(atual),
          comparado: aggregate(anterior),
        };
      },
    }),

    periodos_disponiveis: tool({
      description: "Lista os períodos contábeis cadastrados no sistema.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("accounting_periods")
          .select("id, label, status, reference_month")
          .order("reference_month", { ascending: false })
          .limit(24);
        if (error) throw new Error(error.message);
        return { periodos: data ?? [] };
      },
    }),
    razao_extrato_conta: tool({
      description:
        "Extrato do razão de uma conta no período: saldo anterior, débitos, créditos e os lançamentos com contrapartida. Use o código reduzido da conta.",
      inputSchema: z.object({
        codigo_reduzido: z.string().describe("Código reduzido da conta no razão"),
        limite: z.number().describe("Quantos lançamentos retornar (até 200)"),
      }),
      execute: async ({ codigo_reduzido, limite }) => {
        const id = requirePeriod();
        const { data, error } = await supabase.rpc("journal_account_statement", {
          _period_id: id,
          _reduced_code: codigo_reduzido,
          _limit: Math.min(Math.max(1, Math.round(limite || 50)), 200),
          _offset: 0,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    razao_lancamento: tool({
      description:
        "Abre um lançamento completo do razão pelo número do documento, com todas as pernas (partida e contrapartida) e a conferência débito × crédito.",
      inputSchema: z.object({ numero: z.string().describe("Número do lançamento") }),
      execute: async ({ numero }) => {
        const id = requirePeriod();
        const { data, error } = await supabase.rpc("journal_document", {
          _period_id: id,
          _doc_number: numero,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    razao_contrapartidas: tool({
      description:
        "Contrapartidas mais frequentes de uma conta no razão, com percentual. Use para justificar a natureza proposta de uma conta.",
      inputSchema: z.object({
        codigo_reduzido: z.string(),
        limite: z.number().describe("Quantas contrapartidas (até 20)"),
      }),
      execute: async ({ codigo_reduzido, limite }) => {
        const id = requirePeriod();
        const { data, error } = await supabase.rpc("journal_top_counterparts", {
          _period_id: id,
          _reduced_code: codigo_reduzido,
          _limit: Math.min(Math.max(1, Math.round(limite || 10)), 20),
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    razao_conferencia: tool({
      description: "Conferência razão × balancete do período, conta a conta, com as divergências.",
      inputSchema: z.object({}),
      execute: async () => {
        const id = requirePeriod();
        const { data, error } = await supabase.rpc("reconcile_journal_vs_trial_balance", {
          _period_id: id,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    razao_pendencias: tool({
      description:
        "Relatório de pendências do razão: contas sem vínculo com o balancete, sem natureza ou com diferença de valor, com a causa provável de cada uma.",
      inputSchema: z.object({}),
      execute: async () => {
        const id = requirePeriod();
        const { data, error } = await supabase.rpc("journal_pending_report", { _period_id: id });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    razao_buscar_lancamentos: tool({
      description:
        "Busca livre nos lançamentos do razão do período (histórico, documento, conta). Retorna o id de cada lançamento, necessário para propor um ajuste.",
      inputSchema: z.object({
        texto: z.string().describe("Texto livre: histórico, documento ou código/nome de conta"),
        limite: z.number().describe("Quantos lançamentos retornar (até 100)"),
      }),
      execute: async ({ texto, limite }) => {
        const id = requirePeriod();
        const { data, error } = await supabase.rpc("journal_search", {
          _period_id: id,
          _query: texto,
          _limit: Math.min(Math.max(1, Math.round(limite || 30)), 100),
          _offset: 0,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    razao_lancamento_detalhe: tool({
      description:
        "Detalhe de um lançamento específico do razão pelo id: conta, contrapartida, valor, documento, histórico, status e período. Use antes de propor qualquer ajuste.",
      inputSchema: z.object({ leg_id: z.string().describe("id (uuid) do lançamento no razão") }),
      execute: async ({ leg_id }) => {
        const { data, error } = await supabase.rpc("journal_leg_detail", { _leg_id: leg_id });
        if (error) throw new Error(error.message);
        return data;
      },
    }),
  };


  if (agent === "contador") {
    tools["propor_classificacao"] = tool({
      description:
        "Cria uma PROPOSTA de classificação de contas (não grava). Um administrador precisa clicar em Aplicar. " +
        "Sempre consulte antes 'razao_contrapartidas' e cite as contrapartidas que sustentam a natureza proposta.",
      inputSchema: z.object({
        natureza: z.enum(RECLASS_NATURES),
        contas: z
          .array(z.object({ id: z.string().describe("id da conta no plano de contas"), nome: z.string() }))
          .describe("Contas que receberão a natureza"),
        justificativa: z.string(),
        evidencias: z
          .array(z.string())
          .describe(
            'Contrapartidas que justificam a proposta, ex: "94% dos créditos têm contrapartida em Fornecedores"',
          ),
      }),
      execute: async ({ natureza, contas, justificativa, evidencias }) => ({
        proposta: "classificacao",
        natureza,
        contas: contas.slice(0, 50),
        justificativa,
        evidencias: (evidencias ?? []).slice(0, 10),
        status: "aguardando aprovação do administrador",
      }),
    });

    tools["propor_apontamento"] = tool({
      description:
        "Cria uma PROPOSTA de apontamento de auditoria (não grava). Um administrador precisa clicar em Aplicar.",
      inputSchema: z.object({
        tipo: z.string().describe("Tipo do achado, ex: divergencia_saldo"),
        descricao: z.string(),
        correcao_sugerida: z.string(),
        severidade: z.enum(["baixa", "media", "alta"]),
      }),
      execute: async ({ tipo, descricao, correcao_sugerida, severidade }) => ({
        proposta: "apontamento",
        tipo,
        descricao,
        correcao_sugerida,
        severidade,
        periodo_id: periodId,
        status: "aguardando aprovação do administrador",
      }),
    });
  }

  return tools;
}
