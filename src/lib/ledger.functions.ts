import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const NATURES = [
  "ativo_circulante",
  "ativo_nao_circulante",
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
  "receita",
  "custo",
  "despesa",
] as const;

const syncSchema = z.object({ period_id: z.string().uuid() });

const updateEntrySchema = z.object({
  entry_id: z.string().uuid(),
  reviewed_value: z.number().finite().nullable().optional(),
  nature: z.enum(NATURES).nullable().optional(),
});

const revertSchema = z.object({ entry_id: z.string().uuid() });

const natureSchema = z.object({
  account_id: z.string().uuid(),
  nature: z.enum(NATURES),
});

async function assertAdmin(supabase: {
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
}) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) throw new Error("Acesso restrito a administradores.");
}

export const syncChartOfAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { syncAccountsForPeriod } = await import("@/lib/ledger.server");
    const result = await syncAccountsForPeriod(data.period_id);
    await context.supabase.rpc("log_activity", {
      _action: "sincronizou plano de contas",
      _entity_type: "chart_of_accounts",
      _metadata: { period_id: data.period_id, ...result },
    });
    return result;
  });

export const updateLedgerEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateEntrySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: entry, error: readError } = await context.supabase
      .from("ledger_entries")
      .select("id, period_id, source_account_name, raw_value, reviewed_value, nature")
      .eq("id", data.entry_id)
      .single();
    if (readError) throw new Error(readError.message);

    const { data: period, error: periodError } = await context.supabase
      .from("accounting_periods")
      .select("status")
      .eq("id", entry.period_id)
      .single();
    if (periodError) throw new Error(periodError.message);
    if (period.status === "fechado") {
      throw new Error("Período fechado: reabra o período para editar os lançamentos.");
    }

    const patch = {
      is_manually_edited: true,
      updated_by: context.userId,
      ...(data.reviewed_value !== undefined ? { reviewed_value: data.reviewed_value } : {}),
      ...(data.nature !== undefined ? { nature: data.nature } : {}),
    };

    const { error } = await context.supabase
      .from("ledger_entries")
      .update(patch)
      .eq("id", data.entry_id);
    if (error) throw new Error(error.message);

    await context.supabase.rpc("log_activity", {
      _action: "editou lançamento do balancete",
      _entity_type: "ledger_entries",
      _entity_id: data.entry_id,
      _metadata: {
        conta: entry.source_account_name,
        valor_anterior: entry.reviewed_value ?? entry.raw_value,
        valor_novo: data.reviewed_value ?? entry.reviewed_value ?? entry.raw_value,
        natureza_anterior: entry.nature,
        natureza_nova: data.nature ?? entry.nature,
      },
    });

    return { ok: true };
  });

export const revertLedgerEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => revertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: entry, error: readError } = await context.supabase
      .from("ledger_entries")
      .select("id, account_id, source_account_name")
      .eq("id", data.entry_id)
      .single();
    if (readError) throw new Error(readError.message);

    let nature: string | null = null;
    if (entry.account_id) {
      const { data: account } = await context.supabase
        .from("chart_of_accounts")
        .select("nature")
        .eq("id", entry.account_id)
        .maybeSingle();
      nature = account?.nature ?? null;
    }

    const { error } = await context.supabase
      .from("ledger_entries")
      .update({
        reviewed_value: null,
        is_manually_edited: false,
        nature,
        updated_by: context.userId,
      })
      .eq("id", data.entry_id);
    if (error) throw new Error(error.message);

    await context.supabase.rpc("log_activity", {
      _action: "reverteu edição manual do balancete",
      _entity_type: "ledger_entries",
      _entity_id: data.entry_id,
      _metadata: { conta: entry.source_account_name },
    });

    return { ok: true };
  });

export const setAccountNature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => natureSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: account, error: readError } = await supabaseAdmin
      .from("chart_of_accounts")
      .select("id, source_name, nature, times_confirmed")
      .eq("id", data.account_id)
      .single();
    if (readError) throw new Error(readError.message);

    const { error } = await supabaseAdmin
      .from("chart_of_accounts")
      .update({
        nature: data.nature,
        is_confirmed: true,
        times_confirmed: (account.times_confirmed ?? 0) + 1,
        updated_by: context.userId,
      })
      .eq("id", data.account_id);
    if (error) throw new Error(error.message);

    // Propaga para os lançamentos dos períodos ainda não fechados,
    // preservando os ajustes manuais feitos no balancete.
    const { data: openPeriods } = await supabaseAdmin
      .from("accounting_periods")
      .select("id")
      .neq("status", "fechado");
    const openIds = (openPeriods ?? []).map((p) => p.id);

    let updated = 0;
    if (openIds.length) {
      const { data: rows, error: propagateError } = await supabaseAdmin
        .from("ledger_entries")
        .update({ nature: data.nature })
        .eq("account_id", data.account_id)
        .eq("is_manually_edited", false)
        .in("period_id", openIds)
        .select("id");
      if (propagateError) throw new Error(propagateError.message);
      updated = rows?.length ?? 0;
    }

    await context.supabase.rpc("log_activity", {
      _action: "classificou conta do plano de contas",
      _entity_type: "chart_of_accounts",
      _entity_id: data.account_id,
      _metadata: {
        conta: account.source_name,
        natureza_anterior: account.nature,
        natureza_nova: data.nature,
        lancamentos_atualizados: updated,
      },
    });

    return { updated };
  });
