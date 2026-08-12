/** Geração de sugestões de reclassificação via IA (Lovable AI Gateway). */

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

const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sugestoes"],
  properties: {
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
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

async function readGatewayJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  // A rota /v1/responses pode responder em SSE quando stream=true; aqui usamos
  // resposta única, mas mantemos tolerância a ambos os formatos.
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("data:") || trimmed.startsWith("event:")) {
    let text = "";
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: unknown;
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        }
      } catch {
        /* ignora fragmentos inválidos */
      }
    }
    return JSON.parse(text);
  }
  const parsed = JSON.parse(raw) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text =
    parsed.output_text ??
    parsed.output?.flatMap((item) => item.content ?? []).find((c) => c.text)?.text;
  if (!text) throw new Error("Resposta da IA sem conteúdo.");
  return JSON.parse(text);
}

async function suggestBatch(
  apiKey: string,
  accounts: PendingAccount[],
  patterns: ConfirmedPattern[],
): Promise<AiSuggestion[]> {
  const patternText = patterns.length
    ? patterns.map((p) => `- ${p.source_name} => ${p.nature}`).join("\n")
    : "(ainda não há contas confirmadas pela equipe)";

  const accountsText = accounts
    .map((a) => `- id=${a.id} | código=${a.source_code ?? "-"} | conta="${a.source_name}"`)
    .join("\n");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      stream: true,
      instructions:
        "Você é um contador brasileiro que classifica contas de um balancete do sistema G2 " +
        "de um frigorífico. Para cada conta informada, escolha exatamente uma natureza entre: " +
        `${RECLASS_NATURES.join(", ")}. ` +
        "Respeite o padrão já aprovado pela empresa quando a conta for semelhante. " +
        "A justificativa deve ter no máximo duas frases, em português. " +
        "A confiança é um número entre 0 e 1. Não invente contas: responda apenas os ids recebidos.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Padrão já confirmado pela empresa:\n${patternText}\n\n` +
                `Contas a classificar:\n${accountsText}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "reclassificacoes",
          strict: true,
          schema: SUGGESTION_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) throw new Error("Limite de uso da IA atingido. Tente novamente.");
    if (response.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
    throw new Error(`Falha ao gerar sugestões (${response.status}). ${detail.slice(0, 300)}`);
  }

  const parsed = (await readGatewayJson(response)) as {
    sugestoes?: Array<{
      id?: string;
      natureza?: string;
      justificativa?: string;
      confianca?: number;
    }>;
  };

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
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada para as sugestões de IA.");

  const batchSize = 20;
  const results: AiSuggestion[] = [];
  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    results.push(...(await suggestBatch(apiKey, batch, patterns)));
  }
  return results;
}
