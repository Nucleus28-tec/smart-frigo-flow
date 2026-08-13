import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({ period_id: z.string().uuid() });

export const recalculateIndicators = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc(
      "recalculate_period_indicators",
      { _period_id: data.period_id },
    );
    if (error) throw new Error(error.message);
    await context.supabase.rpc("log_activity", {
      _action: "recalculou indicadores",
      _entity_type: "dashboard_indicators",
      _metadata: { period_id: data.period_id },
    });
    return result as Record<string, number>;
  });
