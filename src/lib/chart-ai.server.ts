/** Analista de IA do plano de contas: sugere posição hierárquica, natureza e tipo da conta. */
import { callAiJson } from "./ai-router.server";

export const CHART_NATURES = [
  "ativo_circulante",
  "ativo_nao_circulante",
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
  "receita",
  "custo",
  "despesa",
] as const;

export type ChartAccountInput = {
  id: string;
  reduced_code: string;
  name: string;
  hierarchical_code: string | null;
  nature: string | null;
  is_analytic: boolean;
  legs_count: number;
};

export type ChartGroupInput = {
  hierarchical_code: string;
  name: string;
  nature: string | null;
};

export type ChartAiSuggestion = {
  account_id: string;
  reduced_code: string;
  account_name: string;
  kind: "mover" | "natureza" | "tipo_conta";
  current_value: string | null;
  suggested_value: string;
  suggested_parent: string | null;
  suggested_nature: string | null;
  suggested_is_analytic: boolean | null;
  reasoning: string;
  confidence: number;
};

const SCHEMA = {
  type: "object",
  required: ["sugestoes"],
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "acao", "justificativa", "confianca"],
        properties: {
          id: { type: "string" },
          acao: { type: "string", enum: ["mover", "natureza", "tipo_conta"] },
          grupo_destino: { type: "string" },
          natureza: { type: "string", enum: [...CHART_NATURES] },
          tipo: { type: "string", enum: ["analitica", "sintetica"] },
          justificativa: { type: "string" },
          confianca: { type: "number" },
        },
      },
    },
  },
} as const;

type RawSuggestion = {
  id?: string;
  acao?: string;
  grupo_destino?: string;
  natureza?: string;
  tipo?: string;
  justificativa?: string;
  confianca?: number;
};

async function analyzeBatch(
  accounts: ChartAccountInput[],
  groups: ChartGroupInput[],
): Promise<ChartAiSuggestion[]> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const groupSet = new Set(groups.map((g) => g.hierarchical_code));

  const groupText = groups
    .map((g) => `- ${g.hierarchical_code} ${g.name}${g.nature ? ` [${g.nature}]` : ""}`)
    .join("\n");

  const accountText = accounts
    .map(
      (a) =>
        `- id=${a.id} | reduzido=${a.reduced_code} | hierárquico=${a.hierarchical_code ?? "sem posição"}` +
        ` | tipo=${a.is_analytic ? "analítica" : "sintética"} | natureza=${a.nature ?? "não definida"}` +
        ` | lançamentos=${a.legs_count} | nome="${a.name}"`,
    )
    .join("\n");

  const parsed = await callAiJson<{ sugestoes?: RawSuggestion[] }>({
    errorContext: "Análise do plano de contas",
    schema: SCHEMA,
    systemInstruction:
      "Você é um contador brasileiro auditando o plano de contas de um frigorífico migrado de um " +
      "sistema legado. Regras do plano: contas sintéticas apenas agregam e nunca recebem lançamento; " +
      "contas analíticas são as únicas que recebem lançamento. O código hierárquico segue " +
      "1.* ativo, 2.* passivo e patrimônio líquido, 3.01.* custo, 3.02.*/3.03.* despesa, 4.* receita. " +
      "Para cada conta indicada, sugira no máximo uma ação: 'mover' (informe grupo_destino, " +
      "exatamente um dos códigos hierárquicos de grupo listados), 'natureza' (informe natureza) ou " +
      "'tipo_conta' (informe tipo). Só sugira quando houver ganho contábil claro; omita a conta " +
      "quando ela já estiver correta. Justificativa em português, no máximo duas frases. " +
      "Confiança entre 0 e 1. Nunca invente ids nem grupos fora da lista.",
    parts: [
      {
        type: "text",
        text: `Grupos sintéticos disponíveis:\n${groupText}\n\nContas a auditar:\n${accountText}`,
      },
    ],
  });

  const out: ChartAiSuggestion[] = [];
  for (const item of parsed.sugestoes ?? []) {
    const acc = item.id ? byId.get(item.id) : undefined;
    if (!acc) continue;
    const confidence = Number(item.confianca);
    const base = {
      account_id: acc.id,
      reduced_code: acc.reduced_code,
      account_name: acc.name,
      reasoning: (item.justificativa ?? "").slice(0, 600),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    };

    if (item.acao === "mover") {
      const dest = (item.grupo_destino ?? "").trim();
      if (!dest || !groupSet.has(dest)) continue;
      if (acc.hierarchical_code && acc.hierarchical_code.startsWith(dest)) continue;
      out.push({
        ...base,
        kind: "mover",
        current_value: acc.hierarchical_code,
        suggested_value: dest,
        suggested_parent: dest,
        suggested_nature: null,
        suggested_is_analytic: null,
      });
      continue;
    }

    if (item.acao === "natureza") {
      const nature = item.natureza;
      if (!nature || !(CHART_NATURES as readonly string[]).includes(nature)) continue;
      if (acc.nature === nature) continue;
      out.push({
        ...base,
        kind: "natureza",
        current_value: acc.nature,
        suggested_value: nature,
        suggested_parent: null,
        suggested_nature: nature,
        suggested_is_analytic: null,
      });
      continue;
    }

    if (item.acao === "tipo_conta") {
      if (item.tipo !== "analitica" && item.tipo !== "sintetica") continue;
      const isAnalytic = item.tipo === "analitica";
      if (acc.is_analytic === isAnalytic) continue;
      if (!isAnalytic && acc.legs_count > 0) continue;
      out.push({
        ...base,
        kind: "tipo_conta",
        current_value: acc.is_analytic ? "analitica" : "sintetica",
        suggested_value: item.tipo,
        suggested_parent: null,
        suggested_nature: null,
        suggested_is_analytic: isAnalytic,
      });
    }
  }
  return out;
}

/** Analisa as contas em lotes e devolve as sugestões válidas. */
export async function analyzeChartAccounts(
  accounts: ChartAccountInput[],
  groups: ChartGroupInput[],
): Promise<ChartAiSuggestion[]> {
  const batchSize = 25;
  const results: ChartAiSuggestion[] = [];
  for (let i = 0; i < accounts.length; i += batchSize) {
    results.push(...(await analyzeBatch(accounts.slice(i, i + batchSize), groups)));
  }
  return results;
}

/** Chave estável da proposta, para não repetir o que já foi decidido. */
export function proposalHash(s: ChartAiSuggestion): string {
  return `${s.reduced_code}|${s.kind}|${s.suggested_value}`;
}
