/** Geração de sugestões de reclassificação via IA (roteador unificado). */
import { callAiJson } from "./ai-router.server";

export const RECLASS_NATURES = [
  "ativo_circulante",
  "ativo_nao_circulante",
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
  "receita",
  "custo",
  "despesa",
] as const;

export type ReclassNature = (typeof RECLASS_NATURES)[number];

export type PendingAccount = {
  id: string;
  source_code: string | null;
  source_name: string;
  nature: string | null;
};

export type ConfirmedPattern = {
  source_name: string;
  nature: string;
};

export type AiSuggestion = {
  account_id: string;
  suggested_nature: ReclassNature;
  reasoning: string;
  confidence_score: number;
};

/** Schema no dialeto responseSchema do Gemini. */
const SUGGESTION_SCHEMA = {
  type: "object",
  required: ["sugestoes"],
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "natureza", "justificativa", "confianca"],
        properties: {
          id: { type: "string" },
          natureza: { type: "string", enum: [...RECLASS_NATURES] },
          justificativa: { type: "string" },
          confianca: { type: "number" },
        },
      },
    },
  },
} as const;

function isNature(value: unknown): value is ReclassNature {
  return typeof value === "string" && (RECLASS_NATURES as readonly string[]).includes(value);
}

async function suggestBatch(
  accounts: PendingAccount[],
  patterns: ConfirmedPattern[],
): Promise<AiSuggestion[]> {
  const patternText = patterns.length
    ? patterns.map((p) => `- ${p.source_name} => ${p.nature}`).join("\n")
    : "(ainda não há contas confirmadas pela equipe)";

  const accountsText = accounts
    .map((a) => `- id=${a.id} | código=${a.source_code ?? "-"} | conta="${a.source_name}"`)
    .join("\n");

  const parsed = await callAiJson<{
    sugestoes?: Array<{
      id?: string;
      natureza?: string;
      justificativa?: string;
      confianca?: number;
    }>;
  }>({
    errorContext: "Sugestões de reclassificação",
    schema: SUGGESTION_SCHEMA,
    systemInstruction:
      "Você é um contador brasileiro que classifica contas de um balancete do sistema G2 " +
      "de um frigorífico. Para cada conta informada, escolha exatamente uma natureza entre: " +
      `${RECLASS_NATURES.join(", ")}. ` +
      "Respeite o padrão já aprovado pela empresa quando a conta for semelhante. " +
      "A justificativa deve ter no máximo duas frases, em português. " +
      "A confiança é um número entre 0 e 1. Não invente contas: responda apenas os ids recebidos.",
    parts: [
      {
        type: "text",
        text:
          `Padrão já confirmado pela empresa:\n${patternText}\n\n` +
          `Contas a classificar:\n${accountsText}`,
      },
    ],
  });

  const validIds = new Set(accounts.map((a) => a.id));
  const out: AiSuggestion[] = [];
  for (const item of parsed.sugestoes ?? []) {
    if (!item.id || !validIds.has(item.id)) continue;
    if (!isNature(item.natureza)) continue;
    const confidence = Number(item.confianca);
    out.push({
      account_id: item.id,
      suggested_nature: item.natureza,
      reasoning: (item.justificativa ?? "").slice(0, 600),
      confidence_score: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.5,
    });
  }
  return out;
}

/** Gera sugestões para todas as contas pendentes, em lotes. */
export async function generateSuggestions(
  accounts: PendingAccount[],
  patterns: ConfirmedPattern[],
): Promise<AiSuggestion[]> {
  const batchSize = 20;
  const results: AiSuggestion[] = [];
  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    results.push(...(await suggestBatch(batch, patterns)));
  }
  return results;
}
