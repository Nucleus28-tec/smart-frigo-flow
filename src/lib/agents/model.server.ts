/** Resolve o modelo de IA dos agentes conforme o provedor ativo do sistema. */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AI_MODEL } from "@/lib/ai-model";

export type AgentProvider = "gemini" | "lovable";

/** Cria o modelo de linguagem do provedor indicado. */
export function resolveAgentModel(provider: AgentProvider): {
  model: LanguageModel;
  provider: AgentProvider;
} {
  if (provider === "lovable") {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY não configurada.");
    const gateway = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      supportsStructuredOutputs: true,
      headers: {
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
    });
    return { model: gateway("google/gemini-3.6-flash"), provider };
  }

  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY não configurada.");
  const google = createOpenAICompatible({
    name: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: { Authorization: `Bearer ${key}` },
  });
  return { model: google(AI_MODEL), provider };
}
