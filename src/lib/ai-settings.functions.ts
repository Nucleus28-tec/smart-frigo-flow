import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const providerSchema = z.enum(["gemini", "lovable"]);

export const getAiProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_provider")
      .single();

    if (error || !data) {
      return { provider: "gemini" as const };
    }

    const parsed = providerSchema.safeParse(data.value);
    return { provider: parsed.success ? parsed.data : ("gemini" as const) };
  });

export const setAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: "gemini" | "lovable" }) =>
    providerSchema.parse(input.provider),
  )
  .handler(async ({ data, context }) => {
    const provider = providerSchema.parse(data);

    const { error } = await context.supabase
      .from("app_settings")
      .upsert(
        {
          key: "ai_provider",
          value: provider,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );

    if (error) {
      throw new Error(`Erro ao salvar provedor de IA: ${error.message}`);
    }

    await context.supabase.rpc("log_activity", {
      _action: "ai_provider_changed",
      _entity_type: "ai_provider",
      _metadata: {
        provider,
        changed_by: context.userId,
      },
    });

    return { provider };
  });
