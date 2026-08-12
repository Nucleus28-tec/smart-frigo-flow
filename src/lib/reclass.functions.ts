import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const suggestSchema = z.object({ period_id: z.string().uuid() });
const decisionSchema = z.object({
  suggestion_id: z.string().uuid(),
  decision: z.enum(["aprovada", "rejeitada"]),
});

async function assertAdmin(supabase: {
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
}) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) throw new Error("Acesso restrito a administradores.");
}

/** Gera sugestões de natureza para as contas do período ainda não confirmadas. */
export const suggestReclassifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => suggestSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateSuggestions } = await import("@/lib/reclass.server");

    // Contas usadas no período que ainda não têm natureza confirmada.
    const { data: entryRows, error: entriesError } = await supabaseAdmin
      .from("ledger_entries")
      .select(
        "account_id, chart_of_accounts!inner(id, source_code, source_name, nature, is_confirmed)",
      )
      .eq("period_id", data.period_id)
      .eq("chart_of_accounts.is_confirmed", false)
      .limit(5000);
    if (entriesError) throw new Error(entriesError.message);

    const uniqueAccounts = new Map<
      string,
      { id: string; source_code: string | null; source_name: string; nature: string | null }
    >();
    for (const row of entryRows ?? []) {
      const account = (row as unknown as { chart_of_accounts: unknown }).chart_of_accounts as {
        id: string;
        source_code: string | null;
        source_name: string;
        nature: string | null;
      } | null;
      if (account && !uniqueAccounts.has(account.id)) uniqueAccounts.set(account.id, account);
    }
    const accounts = Array.from(uniqueAccounts.values())
      .sort((a, b) => a.source_name.localeCompare(b.source_name))
      .slice(0, 60);
    if (!accounts.length) {
      return { created: 0, skipped: 0, analyzed: 0 };
    }


    // Sugestões pendentes já existentes no período (evita duplicar).
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("reclassification_suggestions")
      .select("account_id")
      .eq("period_id", data.period_id)
      .eq("status", "pendente")
      .limit(2000);
    if (pendingError) throw new Error(pendingError.message);
    const pendingIds = new Set((pending ?? []).map((p) => p.account_id as string));

    const targets = (accounts ?? []).filter((a) => !pendingIds.has(a.id));
    if (!targets.length) {
      return { created: 0, skipped: pendingIds.size, analyzed: 0 };
    }

    // Padrão aprendido: contas já confirmadas pela equipe.
    const { data: confirmed } = await supabaseAdmin
      .from("chart_of_accounts")
      .select("source_name, nature")
      .eq("is_confirmed", true)
      .not("nature", "is", null)
      .order("times_confirmed", { ascending: false })
      .limit(120);

    const suggestions = await generateSuggestions(
      targets.map((a) => ({
        id: a.id,
        source_code: a.source_code,
        source_name: a.source_name,
        nature: a.nature,
      })),
      (confirmed ?? []).map((c) => ({
        source_name: c.source_name as string,
        nature: c.nature as string,
      })),
    );

    if (!suggestions.length) {
      return { created: 0, skipped: pendingIds.size, analyzed: targets.length };
    }

    const byId = new Map(targets.map((a) => [a.id, a]));
    const rows = suggestions.map((s) => ({
      period_id: data.period_id,
      account_id: s.account_id,
      current_nature: byId.get(s.account_id)?.nature ?? null,
      suggested_nature: s.suggested_nature,
      reasoning: s.reasoning,
      confidence_score: s.confidence_score,
      status: "pendente",
    }));

    const { error: insertError } = await supabaseAdmin
      .from("reclassification_suggestions")
      .insert(rows);
    if (insertError) throw new Error(insertError.message);

    await context.supabase.rpc("log_activity", {
      _action: "gerou sugestões de reclassificação",
      _entity_type: "reclassification_suggestions",
      _metadata: { period_id: data.period_id, criadas: rows.length },
    });

    return { created: rows.length, skipped: pendingIds.size, analyzed: targets.length };
  });

/** Aplica (ou descarta) a decisão do Admin sobre uma sugestão. */
export const applyReclassificationDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => decisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);

    const { data: result, error } = await (
      context.supabase as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("apply_reclassification_decision", {
      _suggestion_id: data.suggestion_id,
      _decision: data.decision,
    });
    if (error) throw new Error(error.message);

    const parsed = (result ?? {}) as { entries_updated?: number };

    await context.supabase.rpc("log_activity", {
      _action:
        data.decision === "aprovada"
          ? "aprovou sugestão de reclassificação"
          : "rejeitou sugestão de reclassificação",
      _entity_type: "reclassification_suggestions",
      _entity_id: data.suggestion_id,
      _metadata: { lancamentos_atualizados: parsed.entries_updated ?? 0 },
    });

    return { decision: data.decision, entries_updated: parsed.entries_updated ?? 0 };
  });
