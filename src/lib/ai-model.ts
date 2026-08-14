/** Cliente direto da API do Google Gemini (sem gateway da Lovable). */

export const AI_MODEL = "gemini-2.5-flash";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type GeminiCallOptions = {
  parts: GeminiPart[];
  systemInstruction?: string;
  /** Schema no dialeto `responseSchema` do Gemini; quando presente força saída JSON. */
  schema?: unknown;
  model?: string;
  /** Prefixo usado nas mensagens de erro mostradas ao usuário. */
  errorContext?: string;
};

function geminiApiKey(): string {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY não configurada. Cadastre a chave do Google AI Studio nas configurações do projeto.",
    );
  }
  return key;
}

function describeError(status: number, detail: string, context: string): Error {
  if (status === 400) {
    return new Error(
      `${context}: requisição recusada pelo Google (400). Verifique a chave e o modelo. ${detail.slice(0, 300)}`,
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      `${context}: chave do Gemini inválida ou sem permissão (${status}). Gere uma nova chave no Google AI Studio. ${detail.slice(0, 300)}`,
    );
  }
  if (status === 429) {
    return new Error(
      `${context}: cota do Gemini excedida (429). Aguarde alguns instantes ou habilite faturamento no projeto Google.`,
    );
  }
  if (status >= 500) {
    return new Error(`${context}: instabilidade no serviço do Google (${status}). Tente novamente.`);
  }
  return new Error(`${context}: falha na chamada ao Gemini (${status}). ${detail.slice(0, 300)}`);
}

/** Chama o Gemini e devolve o texto da resposta. */
export async function callGemini(options: GeminiCallOptions): Promise<string> {
  const apiKey = geminiApiKey();
  const model = options.model ?? AI_MODEL;
  const context = options.errorContext ?? "IA";

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: options.parts }],
  };
  if (options.systemInstruction) {
    body["systemInstruction"] = { parts: [{ text: options.systemInstruction }] };
  }
  if (options.schema) {
    body["generationConfig"] = {
      responseMimeType: "application/json",
      responseSchema: options.schema,
    };
  }

  const response = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw describeError(response.status, detail, context);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };

  if (payload.promptFeedback?.blockReason) {
    throw new Error(`${context}: conteúdo bloqueado pelo Gemini (${payload.promptFeedback.blockReason}).`);
  }

  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");

  return text;
}

/** Chama o Gemini com schema e devolve o JSON já interpretado. */
export async function callGeminiJson<T>(options: GeminiCallOptions & { schema: unknown }): Promise<T> {
  const context = options.errorContext ?? "IA";
  const text = await callGemini(options);
  if (!text.trim()) throw new Error(`${context}: a IA não retornou conteúdo.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${context}: não foi possível interpretar o retorno da IA.`);
  }
}
