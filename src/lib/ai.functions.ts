import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: {
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
}) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) throw new Error("Acesso restrito a administradores.");
}

export type AiConnectionStatus = {
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
};

/** Testa a conexão com a API do Gemini usando a chave configurada no projeto. */
export const testAiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiConnectionStatus> => {
    await assertAdmin(context.supabase as never);
    const { AI_MODEL, callGemini } = await import("@/lib/ai-model");

    const startedAt = Date.now();
    try {
      const text = await callGemini({
        errorContext: "Teste de conexão",
        parts: [{ text: "Responda apenas: OK" }],
      });
      return {
        ok: true,
        model: AI_MODEL,
        latencyMs: Date.now() - startedAt,
        message: text.trim() || "Resposta vazia, mas a conexão funcionou.",
      };
    } catch (error) {
      return {
        ok: false,
        model: AI_MODEL,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Falha desconhecida na chamada à IA.",
      };
    }
  });
