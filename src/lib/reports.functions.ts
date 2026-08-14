import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const periodSchema = z.object({ period_id: z.string().uuid() });
const exportSchema = z.object({
  period_id: z.string().uuid(),
  format: z.enum(["pdf", "xlsx"]),
});

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Recalcula e grava DRE, Balanço Patrimonial e Fluxo de Caixa do período. */
export const generateStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => periodSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("generate_period_statements", {
      _period_id: data.period_id,
    });
    if (error) throw new Error(error.message);
    await context.supabase.rpc("log_activity", {
      _action: "gerou demonstrativos",
      _entity_type: "financial_statements",
      _metadata: { period_id: data.period_id },
    });
    return { ok: true as const, generated: JSON.stringify(result ?? {}) };
  });

/** Gera PDF (com logo Rotta) ou Excel dos demonstrativos e devolve uma signed URL. */
export const exportReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => exportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: period, error: periodError } = await context.supabase
      .from("accounting_periods")
      .select("id, label")
      .eq("id", data.period_id)
      .maybeSingle();
    if (periodError) throw new Error(periodError.message);
    if (!period) throw new Error("Período não encontrado.");

    let { data: statements, error: statementsError } = await context.supabase
      .from("financial_statements")
      .select("statement_type, content")
      .eq("period_id", data.period_id);
    if (statementsError) throw new Error(statementsError.message);

    if (!statements || statements.length === 0) {
      const { error: genError } = await context.supabase.rpc("generate_period_statements", {
        _period_id: data.period_id,
      });
      if (genError) throw new Error(genError.message);
      const retry = await context.supabase
        .from("financial_statements")
        .select("statement_type, content")
        .eq("period_id", data.period_id);
      if (retry.error) throw new Error(retry.error.message);
      statements = retry.data;
    }

    const order = ["dre", "balanco_patrimonial", "fluxo_de_caixa"];
    const sorted = [...(statements ?? [])].sort(
      (a, b) => order.indexOf(a.statement_type) - order.indexOf(b.statement_type),
    ) as { statement_type: string; content: never }[];

    const generatedAt = new Date();
    const { buildStatementsPdf, buildStatementsXlsx } = await import("@/lib/reports.server");

    let bytes: Uint8Array;
    let contentType: string;
    if (data.format === "pdf") {
      bytes = await buildStatementsPdf({
        periodLabel: period.label,
        statements: sorted,
        generatedAt,
      });
      contentType = "application/pdf";
    } else {
      bytes = new Uint8Array(
        buildStatementsXlsx({ periodLabel: period.label, statements: sorted, generatedAt }),
      );
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

    const fileName = `demonstrativos-${slug(period.label)}-${generatedAt
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "")}.${data.format}`;
    const path = `${data.period_id}/${fileName}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: uploadError } = await supabaseAdmin.storage
      .from("exports")
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadError) throw new Error(`Falha ao salvar o arquivo: ${uploadError.message}`);

    const { data: signed, error: signedError } = await supabaseAdmin.storage
      .from("exports")
      .createSignedUrl(path, 60 * 10, { download: fileName });
    if (signedError || !signed) {
      throw new Error(`Falha ao gerar link de download: ${signedError?.message ?? ""}`);
    }

    await context.supabase.rpc("log_activity", {
      _action: `exportou demonstrativos em ${data.format.toUpperCase()}`,
      _entity_type: "financial_statements",
      _metadata: { period_id: data.period_id, path },
    });

    return { url: signed.signedUrl, file_name: fileName, size: bytes.byteLength };
  });
