/** Roteador unificado de IA: alterna entre Gemini próprio e Lovable AI Gateway,
 *  com fallback automático quando o provedor ativo falha. */
import { callLovableAi, type AiPart as LovableAiPart } from "./ai-lovable.server";
import { callGemini, callGeminiJson } from "./ai-model";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AiProvider = "gemini" | "lovable";

export type AiPart =
  | { type: "text"; text: string }
  | { type: "file"; mimeType: string; data: string };

export type AiCallOptions = {
  parts: AiPart[];
  systemInstruction?: string;
  schema?: unknown;
  maxOutputTokens?: number;
  errorContext?: string;
  /** Força um provedor específico, ignorando a configuração global. */
  forceProvider?: AiProvider;
};

const ACTIVE_PROVIDER_KEY = "ai_provider";
const DEFAULT_PROVIDER: AiProvider = "gemini";

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

async function getActiveProvider(): Promise<AiProvider> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", ACTIVE_PROVIDER_KEY)
      .single();
    if (error) throw error;
    const value = data?.value;
    if (value === "lovable") return "lovable";
    return "gemini";
  } catch {
    return DEFAULT_PROVIDER;
  }
}

async function logFallback(
  failedProvider: AiProvider,
  fallbackProvider: AiProvider,
  context: string,
  errorMessage: string,
): Promise<void> {
  try {
    await supabaseAdmin.rpc("log_activity", {
      _action: "ai_fallback",
      _entity_type: "ai_provider",
      _metadata: {
        failed_provider: failedProvider,
        fallback_provider: fallbackProvider,
        context,
        error: errorMessage,
      },
    });
  } catch {
    // Não quebra o fluxo se a auditoria falhar.
  }
}

function toGeminiParts(parts: AiPart[]) {
  return parts.map((p) => {
    if (p.type === "text") {
      return { text: p.text };
    }
    return {
      inline_data: { mime_type: p.mimeType, data: p.data },
    };
  });
}

function toLovableParts(parts: AiPart[]): LovableAiPart[] {
  return parts.map((p) => {
    if (p.type === "text") {
      return { type: "text", text: p.text };
    }
    return { type: "file", mimeType: p.mimeType, data: p.data };
  });
}

function buildLovableOptions(options: AiCallOptions): Record<string, unknown> {
  const base: Record<string, unknown> = {
    parts: toLovableParts(options.parts),
    schema: options.schema,
    maxOutputTokens: options.maxOutputTokens,
    errorContext: options.errorContext,
  };
  if (options.systemInstruction) {
    base["systemInstruction"] = options.systemInstruction;
  }
  return base;
}

function buildGeminiOptions(
  options: AiCallOptions,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    parts: toGeminiParts(options.parts),
    maxOutputTokens: options.maxOutputTokens,
    errorContext: options.errorContext,
  };
  if (options.systemInstruction) {
    base["systemInstruction"] = options.systemInstruction;
  }
  if (options.schema) {
    base["schema"] = options.schema;
  }
  return base;
}

async function callProvider(
  provider: AiProvider,
  options: AiCallOptions,
): Promise<string> {
  if (provider === "lovable") {
    return callLovableAi(buildLovableOptions(options) as Parameters<typeof callLovableAi>[0]);
  }

  const geminiOpts = buildGeminiOptions(options);
  if (options.schema) {
    return callGeminiJson<string>(
      geminiOpts as Parameters<typeof callGeminiJson>[0],
    ).then((r) => JSON.stringify(r));
  }

  return callGemini(geminiOpts as Parameters<typeof callGemini>[0]);
}

/** Executa a chamada de IA no provedor ativo, com fallback automático. */
export async function callAi(options: AiCallOptions): Promise<string> {
  const primary = options.forceProvider ?? (await getActiveProvider());
  const fallback: AiProvider = primary === "gemini" ? "lovable" : "gemini";
  const context = options.errorContext ?? "ai_router";

  try {
    return await callProvider(primary, options);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    if (!isRetryableError(error)) {
      throw new Error(`${context} [${primary}]: ${errorMessage}`);
    }

    await logFallback(primary, fallback, context, errorMessage);

    try {
      return await callProvider(fallback, options);
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new Error(
        `${context}: falha em ${primary} e ${fallback}. ${fallbackMessage}`,
      );
    }
  }
}

/** Executa a chamada de IA e devolve o JSON interpretado. */
export async function callAiJson<T>(
  options: AiCallOptions & { schema: unknown },
): Promise<T> {
  const provider = options.forceProvider ?? (await getActiveProvider());
  const context = `${options.errorContext ?? "ai_router"} [${provider}]`;
  const text = await callAi(options);
  if (!text.trim()) {
    throw new Error(`${context}: resposta vazia.`);
  }
  return parseAiJson<T>(text, context);
}

/** Retorna o provedor ativo sem executar chamada. */
export async function getActiveAiProvider(): Promise<AiProvider> {
  return getActiveProvider();
}
