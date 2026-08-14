import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({ period_id: z.string().uuid() });

type Finding = {
  period_id: string;
  entry_id: string | null;
  finding_type: string;
  description: string;
  suggested_fix: string | null;
  severity: "baixa" | "media" | "alta";
  status: string;
};

/** Equivalente à Edge Function "detect-inconsistencies": varre o período e grava audit_findings. */
export const detectInconsistencies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) throw new Error("Acesso restrito a administradores.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: entries, error } = await supabaseAdmin
      .from("ledger_entries")
      .select("id, source_account_name, raw_value, reviewed_value, nature, account_id")
      .eq("period_id", data.period_id)
      .limit(5000);
    if (error) throw new Error(error.message);

    const rows = entries ?? [];
    const findings: Finding[] = [];
    const base = { period_id: data.period_id, status: "aberto" as const };

    const semNatureza = rows.filter((r) => !r.nature);
    if (semNatureza.length) {
      findings.push({
        ...base,
        entry_id: null,
        finding_type: "conta_sem_natureza",
        description: `${semNatureza.length} lançamento(s) sem natureza contábil definida.`,
        suggested_fix:
          "Gere as sugestões em Reclassificações ou classifique as contas no Plano de Contas.",
        severity: "alta",
      });
    }

    for (const row of rows) {
      const value = row.reviewed_value ?? row.raw_value;
      if (Number(value) === 0) {
        findings.push({
          ...base,
          entry_id: row.id,
          finding_type: "valor_zerado",
          description: `A conta "${row.source_account_name}" está com saldo zero no balancete.`,
          suggested_fix: "Confira no G2 se a conta deveria ter movimento no período.",
          severity: "baixa",
        });
      }
      if (row.nature === "receita" && Number(value) < 0) {
        findings.push({
          ...base,
          entry_id: row.id,
          finding_type: "sinal_invertido",
          description: `Receita "${row.source_account_name}" com saldo devedor (${value}).`,
          suggested_fix: "Verifique o lançamento na origem (G2): receita deve ter saldo credor.",
          severity: "media",
        });
      }
      if ((row.nature === "custo" || row.nature === "despesa") && Number(value) < 0) {
        findings.push({
          ...base,
          entry_id: row.id,
          finding_type: "sinal_invertido",
          description: `${row.nature === "custo" ? "Custo" : "Despesa"} "${row.source_account_name}" com saldo credor invertido (${value}).`,
          suggested_fix: "Confira estornos ou classificação da conta no G2.",
          severity: "media",
        });
      }
    }

    // Duplicidade de conta no mesmo período.
    const byName = new Map<string, number>();
    for (const row of rows) {
      const key = row.source_account_name.trim().toUpperCase();
      byName.set(key, (byName.get(key) ?? 0) + 1);
    }
    for (const [name, count] of byName) {
      if (count > 1) {
        findings.push({
          ...base,
          entry_id: null,
          finding_type: "conta_duplicada",
          description: `A conta "${name}" aparece ${count} vezes no período.`,
          suggested_fix: "Confirme no G2 se a exportação duplicou linhas do balancete.",
          severity: "media",
        });
      }
    }

    // Equação patrimonial.
    const soma = (naturezas: string[]) =>
      rows
        .filter((r) => r.nature && naturezas.includes(r.nature))
        .reduce((acc, r) => acc + Math.abs(Number(r.reviewed_value ?? r.raw_value)), 0);
    const ativo = soma(["ativo_circulante", "ativo_nao_circulante"]);
    const passivoPl = soma([
      "passivo_circulante",
      "passivo_nao_circulante",
      "patrimonio_liquido",
    ]);
    if (ativo > 0 && passivoPl > 0 && Math.abs(ativo - passivoPl) > Math.max(ativo, passivoPl) * 0.01) {
      findings.push({
        ...base,
        entry_id: null,
        finding_type: "balanco_desbalanceado",
        description: `Ativo (${ativo.toFixed(2)}) diferente de Passivo + PL (${passivoPl.toFixed(2)}).`,
        suggested_fix: "Revise a classificação das contas e os saldos importados do G2.",
        severity: "alta",
      });
    }

    // Substitui apenas os apontamentos automáticos ainda abertos.
    await supabaseAdmin
      .from("audit_findings")
      .delete()
      .eq("period_id", data.period_id)
      .eq("status", "aberto");

    if (findings.length) {
      const { error: insertError } = await supabaseAdmin
        .from("audit_findings")
        .insert(findings.slice(0, 500));
      if (insertError) throw new Error(insertError.message);
    }

    await context.supabase.rpc("log_activity", {
      _action: "detectou inconsistências",
      _entity_type: "audit_findings",
      _metadata: { period_id: data.period_id, total: findings.length },
    });

    return { created: Math.min(findings.length, 500) };
  });
