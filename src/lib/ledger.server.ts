import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Garante que cada conta de origem dos lançamentos do período exista em
 * chart_of_accounts e que os lançamentos apontem para ela, herdando a natureza
 * já confirmada (sem sobrescrever ajustes manuais).
 *
 * Roda inteiramente no banco (uma única chamada), porque o runtime serverless
 * limita o número de requisições por execução.
 */
export async function syncAccountsForPeriod(
  supabase: SupabaseClient<never>,
  periodId: string,
): Promise<{ created: number; linked: number }> {
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc("sync_accounts_for_period", { _period_id: periodId });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { created?: number; linked?: number };
  return { created: result.created ?? 0, linked: result.linked ?? 0 };
}
