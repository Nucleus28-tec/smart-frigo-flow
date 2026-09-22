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

type BalanceRow = {
  reduced_code: string;
  account_name: string;
  hierarchical_code: string | null;
  nature: string | null;
  opening_balance: number;
  debit_mov: number;
  credit_mov: number;
  closing_balance: number;
};

const ATIVO = ["ativo_circulante", "ativo_nao_circulante"];
const PASSIVO_PL = ["passivo_circulante", "passivo_nao_circulante", "patrimonio_liquido"];

/**
 * Varre o período no razão contábil (fonte oficial) e grava os apontamentos em audit_findings.
 * Não consulta mais o circuito legado do balancete importado.
 */
export const detectInconsistencies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) throw new Error("Acesso restrito a administradores.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: balances, error } = await supabaseAdmin.rpc("period_account_balances", {
      _period_id: data.period_id,
    });
    if (error) throw new Error(error.message);

    const rows = ((balances ?? []) as unknown as BalanceRow[]).map((r) => ({
      ...r,
      opening_balance: Number(r.opening_balance ?? 0),
      debit_mov: Number(r.debit_mov ?? 0),
      credit_mov: Number(r.credit_mov ?? 0),
      closing_balance: Number(r.closing_balance ?? 0),
    }));

    const findings: Finding[] = [];
    const base = { period_id: data.period_id, status: "aberto" as const, entry_id: null };

    // 1. Contas movimentadas sem natureza definida no plano do razão.
    const semNatureza = rows.filter(
      (r) => !r.nature && (r.debit_mov !== 0 || r.credit_mov !== 0 || r.closing_balance !== 0),
    );
    if (semNatureza.length) {
      findings.push({
        ...base,
        finding_type: "conta_sem_natureza",
        description: `${semNatureza.length} conta(s) com movimento e sem natureza contábil definida.`,
        suggested_fix:
          "Classifique as contas na árvore do Razão Contábil ou use Reclassificações para a IA propor a natureza.",
        severity: "alta",
      });
    }

    // 2. Saldos com sinal invertido em relação à natureza da conta.
    for (const row of rows) {
      if (!row.nature || row.closing_balance === 0) continue;
      const devedora = ATIVO.includes(row.nature) || row.nature === "custo" || row.nature === "despesa";
      const credora = PASSIVO_PL.includes(row.nature) || row.nature === "receita";
      const invertido = (devedora && row.closing_balance < 0) || (credora && row.closing_balance > 0);
      if (!invertido) continue;
      findings.push({
        ...base,
        finding_type: "lancamento_incorreto",
        description: `${row.reduced_code} · ${row.account_name} está com saldo invertido para a natureza ${row.nature} (${row.closing_balance.toFixed(2)}).`,
        suggested_fix:
          "Abra a conta no Razão Contábil e confira estornos, contrapartidas ou a classificação da conta.",
        severity: "media",
      });
    }

    // 3. Contas duplicadas por nome dentro do mesmo período.
    const byName = new Map<string, string[]>();
    for (const row of rows) {
      const key = row.account_name.trim().toUpperCase();
      byName.set(key, [...(byName.get(key) ?? []), row.reduced_code]);
    }
    for (const [name, codes] of byName) {
      if (codes.length > 1) {
        findings.push({
          ...base,
          finding_type: "duplicidade",
          description: `A conta "${name}" aparece com ${codes.length} códigos diferentes (${codes.join(", ")}).`,
          suggested_fix: "Unifique as contas na árvore do Razão Contábil ou confirme a duplicidade no G2.",
          severity: "media",
        });
      }
    }

    // 4. Equação patrimonial do período.
    const soma = (naturezas: string[]) =>
      rows
        .filter((r) => r.nature && naturezas.includes(r.nature))
        .reduce((acc, r) => acc + Math.abs(r.closing_balance), 0);
    const ativo = soma(ATIVO);
    const passivoPl = soma(PASSIVO_PL);
    if (ativo > 0 && passivoPl > 0 && Math.abs(ativo - passivoPl) > Math.max(ativo, passivoPl) * 0.01) {
      findings.push({
        ...base,
        finding_type: "valor_divergente",
        description: `Ativo (${ativo.toFixed(2)}) diferente de Passivo + PL (${passivoPl.toFixed(2)}).`,
        suggested_fix: "Revise a classificação das contas e a conferência do razão importado.",
        severity: "alta",
      });
    }

    // 5. Partidas dobradas: débitos totais devem igualar créditos totais no razão.
    const totalDebito = rows.reduce((acc, r) => acc + r.debit_mov, 0);
    const totalCredito = rows.reduce((acc, r) => acc + r.credit_mov, 0);
    if (Math.abs(totalDebito - totalCredito) > 0.01) {
      findings.push({
        ...base,
        finding_type: "valor_divergente",
        description: `Débitos (${totalDebito.toFixed(2)}) e créditos (${totalCredito.toFixed(2)}) do razão não fecham — diferença de ${(totalDebito - totalCredito).toFixed(2)}.`,
        suggested_fix: "Reimporte o razão do período e confira o Relatório de Inconformidades em Importar.",
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
