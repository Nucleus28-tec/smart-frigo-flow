import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const periodSchema = z.object({ period_id: z.string().uuid() });
const exportSchema = z.object({
  period_id: z.string().uuid(),
  format: z.enum(["pdf", "xlsx"]),
});
const treeSchema = z.object({
  period_id: z.string().uuid(),
  codes: z.array(z.string()).min(1),
  basis: z.enum(["movimento", "saldo"]).default("movimento"),
});

export type StatementTreeNode = {
  codigo: string;
  nome: string;
  nivel: number;
  parent: string | null;
  hidden_count?: number;
  total_count?: number;
  is_analytic: boolean;
  reduced_code: string | null;
  valor: number;
};

/** Árvore hierárquica das contas que compõem uma linha do demonstrativo. */
export const getStatementTree = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => treeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("statement_line_tree", {
      _period_id: data.period_id,
      _codes: data.codes,
      _basis: data.basis,
    });
    if (error) throw new Error(error.message);
    const payload = (result ?? {}) as { nodes?: StatementTreeNode[] };
    return { nodes: payload.nodes ?? [] };
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

    // O arquivo volta no retorno (base64) e o download é montado no navegador.
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    let storageError: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: uploadError } = await supabaseAdmin.storage
        .from("exports")
        .upload(path, bytes, { contentType, upsert: true });
      if (uploadError) storageError = uploadError.message;
    } catch (error) {
      storageError = error instanceof Error ? error.message : "erro ao arquivar";
    }

    try {
      await context.supabase.rpc("log_activity", {
        _action: `exportou demonstrativos em ${data.format.toUpperCase()}`,
        _entity_type: "financial_statements",
        _metadata: { period_id: data.period_id, path },
      });
    } catch {
      /* log de atividade não deve derrubar a exportação */
    }

    return {
      file_name: fileName,
      content_type: contentType,
      size: bytes.byteLength,
      base64,
      storage_error: storageError,
    };
  });
