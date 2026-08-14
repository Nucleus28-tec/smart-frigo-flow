/** Cliente do Lovable AI Gateway usando AI SDK (OpenAI-compatible). */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { z } from "zod";

const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export type AiPart =
  | { type: "text"; text: string }
  | { type: "file"; mimeType: string; data: string };

export type LovableCallOptions = {
  parts: AiPart[];
  systemInstruction?: string;
  schema?: unknown;
  maxOutputTokens?: number;
  errorContext?: string;
};

export function createLovableAiGatewayRunIdFetch(initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (value: string | undefined) => void = () => {};
  let runIdResolved = false;
  const runIdReady = new Promise<string | undefined>((resolve) => {
    resolveRunId = resolve;
  });

  const publishRunId = (value?: string) => {
    const nextRunId = value?.trim() || undefined;
    if (!runId && nextRunId) {
      runId = nextRunId;
    }
    if (!runIdResolved) {
      runIdResolved = true;
      resolveRunId(runId);
    }
  };
  if (runId) publishRunId(runId);

  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) {
        headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      }
      try {
        const response = await fetch(input, { ...init, headers });
        publishRunId(response.headers.get(LOVABLE_AIG_RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (error) {
        publishRunId(undefined);
        throw error;
      }
    },
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : runIdReady),
  };
}

export function createLovableAiGatewayProvider(
  lovableApiKey: string,
  initialRunId?: string,
) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(initialRunId);

  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    supportsStructuredOutputs: false,
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });

  return Object.assign(provider, {
    getRunId: runIdFetch.getRunId,
    waitForRunId: runIdFetch.waitForRunId,
  });
}

function lovableApiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    throw new Error(
      "LOVABLE_API_KEY não configurada. Verifique as configurações do projeto.",
    );
  }
  return key;
}

function describeError(status: number, detail: string, context: string): Error {
  if (status === 400) {
    return new Error(
      `${context}: requisição recusada pelo gateway (${status}). Verifique o modelo e o schema. ${detail.slice(0, 300)}`,
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      `${context}: chave do Lovable AI Gateway inválida ou sem permissão (${status}). ${detail.slice(0, 300)}`,
    );
  }
  if (status === 402) {
    return new Error(
      `${context}: créditos do Lovable AI Gateway esgotados (${status}). Recarregue ou alterne para o Gemini próprio.`,
    );
  }
  if (status === 429) {
    return new Error(
      `${context}: cota do Lovable AI Gateway excedida (${status}). Aguarde alguns instantes.`,
    );
  }
  if (status >= 500) {
    return new Error(
      `${context}: instabilidade no Lovable AI Gateway (${status}). Tente novamente.`,
    );
  }
  return new Error(
    `${context}: falha no Lovable AI Gateway (${status}). ${detail.slice(0, 300)}`,
  );
}

function partsToMessages(parts: AiPart[]) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mimeType?: string }
  > = [];
  for (const part of parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else {
      content.push({
        type: "image",
        image: `data:${part.mimeType};base64,${part.data}`,
        mimeType: part.mimeType,
      });
    }
  }
  return [{ role: "user" as const, content }];
}

function isZodSchema(schema: unknown): schema is z.ZodType {
  return schema != null && typeof schema === "object" && "_def" in schema;
}

/** Chama o Lovable AI Gateway e devolve o texto da resposta. */
export async function callLovableAi(options: LovableCallOptions): Promise<string> {
  const key = lovableApiKey();
  const context = options.errorContext ?? "IA";
  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-3.6-flash");

  const messages = partsToMessages(options.parts);

  try {
    if (options.schema && isZodSchema(options.schema)) {
      const result = await generateText({
        model,
        messages,
        temperature: 0,
        maxOutputTokens: options.maxOutputTokens ?? 65536,
        output: Output.object({ schema: options.schema }),
      });
      return JSON.stringify(result.output);
    }

    const result = await generateText({
      model,
      messages,
      ...(options.systemInstruction
        ? { system: options.systemInstruction }
        : {}),
      temperature: 0,
      maxOutputTokens: options.maxOutputTokens ?? 65536,
    });
    return result.text;
  } catch (error) {
    if (error instanceof Error && error.message) {
      const statusMatch = error.message.match(/\b(\d{3})\b/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      throw describeError(status, error.message, context);
    }
    throw new Error(`${context}: falha inesperada no Lovable AI Gateway.`);
  }
}

/** Chama o Lovable AI Gateway com schema e devolve o JSON já interpretado. */
export async function callLovableAiJson<T>(
  options: LovableCallOptions & { schema: unknown },
): Promise<T> {
  const context = options.errorContext ?? "IA";
  const text = await callLovableAi(options);
  if (!text.trim()) throw new Error(`${context}: a IA não retornou conteúdo.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${context}: não foi possível interpretar o retorno da IA.`);
  }
}
