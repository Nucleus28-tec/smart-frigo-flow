import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Garante que cada conta de origem dos lançamentos do período exista em
 * chart_of_accounts e que os lançamentos apontem para ela, herdando a natureza
 * já confirmada (sem sobrescrever ajustes manuais).
 */
export async function syncAccountsForPeriod(periodId: string) {
  const { data: entries, error } = await supabaseAdmin
    .from("ledger_entries")
    .select("id, source_account_name, account_id, nature, is_manually_edited")
    .eq("period_id", periodId)
    .limit(20000);
  if (error) throw new Error(error.message);
  if (!entries?.length) return { created: 0, linked: 0 };

  const names = Array.from(new Set(entries.map((e) => e.source_account_name.trim())));

  // Lê o plano de contas paginado: filtrar por nome geraria uma URL grande
  // demais quando o período tem centenas de contas.
  const existing: Array<{ id: string; source_name: string; nature: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: coaError } = await supabaseAdmin
      .from("chart_of_accounts")
      .select("id, source_name, nature")
      .range(from, from + 999);
    if (coaError) throw new Error(coaError.message);
    existing.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }


  const byName = new Map(existing.map((a) => [a.source_name, a]));
  const missing = names.filter((name) => !byName.has(name));

  let created = 0;
  if (missing.length) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("chart_of_accounts")
      .insert(missing.map((source_name) => ({ source_name })))
      .select("id, source_name, nature");
    if (insertError) throw new Error(insertError.message);
    for (const account of inserted ?? []) byName.set(account.source_name, account);
    created = inserted?.length ?? 0;
  }

  // Agrupa por (conta, natureza resultante) para atualizar em lote em vez de
  // uma requisição por lançamento.
  const groups = new Map<string, { accountId: string; nature: string | null; ids: string[] }>();
  for (const entry of entries) {
    const account = byName.get(entry.source_account_name.trim());
    if (!account) continue;
    const nextNature = entry.is_manually_edited ? entry.nature : (account.nature ?? entry.nature);
    if (entry.account_id === account.id && entry.nature === nextNature) continue;
    const key = `${account.id}::${nextNature ?? ""}`;
    const group = groups.get(key) ?? { accountId: account.id, nature: nextNature, ids: [] };
    group.ids.push(entry.id);
    groups.set(key, group);
  }

  let linked = 0;
  for (const group of groups.values()) {
    for (let i = 0; i < group.ids.length; i += 100) {
      const chunk = group.ids.slice(i, i + 100);
      const { error: updateError } = await supabaseAdmin
        .from("ledger_entries")
        .update({ account_id: group.accountId, nature: group.nature })
        .in("id", chunk);
      if (updateError) throw new Error(updateError.message);
      linked += chunk.length;
    }
  }


  return { created, linked };
}
