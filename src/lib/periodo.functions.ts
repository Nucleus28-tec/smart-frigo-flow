import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function callRpc<T>(
  supabase: unknown,
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (supabase as Rpc).rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type ResetPeriodReport = {
  ok: boolean;
  label: string;
  journal_legs: number;
  ledger_entries: number;
  trial_balance_lines: number;
  aberturas: number;
  demonstrativos: number;
  indicadores: number;
  contas_ocultas: number;
  sugestoes: number;
  apontamentos: number;
  contas_removidas: number;
};

/** Zera o movimento do período (Admin). Opcionalmente remove contas sem uso. */
export const resetPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ period_id: z.string().uuid(), include_accounts: z.boolean().default(false) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const report = await callRpc<ResetPeriodReport>(context.supabase, "reset_period", {
      _period_id: data.period_id,
      _include_accounts: data.include_accounts,
    });

    // Remove os arquivos do armazenamento junto com os registros já apagados.
    try {
      const { data: objetos } = await context.supabase.storage
        .from("imports")
        .list(`periodo/${data.period_id}`, { limit: 1000 });
      if (objetos?.length) {
        const admin = await import("@/integrations/supabase/client.server")
          .then((m) => m.supabaseAdmin)
          .catch(() => null);
        const client = (admin ?? context.supabase) as typeof context.supabase;
        await client.storage
          .from("imports")
          .remove(objetos.map((o) => `periodo/${data.period_id}/${o.name}`));
      }
    } catch {
      // Armazenamento é acessório: o banco já foi zerado.
    }

    return report;
  });

export type PeriodHealthItem = Record<string, string | number | null>;

export type PeriodHealth = {
  period_id: string;
  label: string;
  legs: number;
  files: number;
  openings: number;
  reconciliation: { total: number; items: PeriodHealthItem[] };
  gaps: { total: number; items: PeriodHealthItem[] };
  anchors: { total: number; items: PeriodHealthItem[] };
  chain: { total: number; items: PeriodHealthItem[] };
};

/** Conferência de saúde do período: reconciliação, lacunas, âncoras e cadeia. */
export const getPeriodHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<PeriodHealth>(context.supabase, "period_health", { _period_id: data.period_id }),
  );

/** Recalcula a cadeia de saldos a partir do período informado. */
export const rebuildChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<{ periods?: number }>(context.supabase, "rebuild_ledger_chain", {
      _from_period_id: data.period_id,
    }),
  );
