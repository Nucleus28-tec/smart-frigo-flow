import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const legSchema = z.object({
  account_reduced_code: z.string().min(1),
  account_name: z.string().default(""),
  opening_balance: z.number().finite().optional(),
  doc_number: z.string().nullable().optional(),
  entry_date: z.string().nullable().optional(),
  counterpart_reduced_code: z.string().nullable().optional(),
  historico: z.string().nullable().optional(),
  debit: z.number().finite().default(0),
  credit: z.number().finite().default(0),
  running_balance: z.number().finite().nullable().optional(),
  line_no: z.number().int().default(0),
});

const tbLineSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().default(1),
  is_analytic: z.boolean().default(false),
  saldo_anterior: z.number().finite().default(0),
  debito: z.number().finite().default(0),
  credito: z.number().finite().default(0),
  saldo_atual: z.number().finite().default(0),
});

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

export const importJournalChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        file_id: z.string().uuid(),
        legs: z.array(legSchema).max(4000),
        reset: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ inserted: number; new_accounts: number }>(
      context.supabase,
      "import_journal_legs",
      { _file_id: data.file_id, _legs: data.legs, _reset: data.reset },
    ),
  );

export const importTrialBalanceMirror = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ file_id: z.string().uuid(), lines: z.array(tbLineSchema).max(4000) })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ lines: number }>(context.supabase, "import_trial_balance_lines", {
      _file_id: data.file_id,
      _lines: data.lines,
    }),
  );

export const finalizeJournalImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ period_id: z.string().uuid(), file_id: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const link = await callRpc<{ by_name: number; by_value: number; pending: number }>(
      context.supabase,
      "link_reduced_accounts",
      { _period_id: data.period_id },
    );
    const indicators = await callRpc<{ source: string }>(
      context.supabase,
      "recalculate_period_indicators",
      { _period_id: data.period_id },
    );
    await callRpc(context.supabase, "generate_period_statements", { _period_id: data.period_id });

    if (data.file_id) {
      await context.supabase
        .from("imported_files")
        .update({ processing_status: "processado", processing_error: null })
        .eq("id", data.file_id);
    }

    await context.supabase.rpc("log_activity", {
      _action: "importou razão contábil",
      _entity_type: "journal_legs",
      _metadata: { period_id: data.period_id, ...link },
    });

    return { ...link, source: indicators.source };
  });

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export const linkReducedAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<{ by_name: number; by_value: number; pending: number }>(
      context.supabase,
      "link_reduced_accounts",
      { _period_id: data.period_id },
    ),
  );

export const reconcileJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "reconcile_journal_vs_trial_balance", {
      _period_id: data.period_id,
    }),
  );

export const pendingReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_pending_report", {
      _period_id: data.period_id,
    }),
  );

export const topCounterparts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid(),
        reduced_code: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_top_counterparts", {
      _period_id: data.period_id,
      _reduced_code: data.reduced_code,
      _limit: data.limit,
    }),
  );

export const getAccountStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid(),
        reduced_code: z.string().min(1),
        limit: z.number().int().min(1).max(1000).default(300),
        offset: z.number().int().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_account_statement", {
      _period_id: data.period_id,
      _reduced_code: data.reduced_code,
      _limit: data.limit,
      _offset: data.offset,
    }),
  );

export const getJournalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ period_id: z.string().uuid(), doc_number: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_document", {
      _period_id: data.period_id,
      _doc_number: data.doc_number,
    }),
  );

/** Busca livre nos lançamentos do período (doc, conta, contrapartida, histórico e valor). */
export const searchJournalLegs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid(),
        query: z.string().min(2).max(120),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_search", {
      _period_id: data.period_id,
      _query: data.query,
      _limit: data.limit,
      _offset: data.offset,
    }),
  );


export const setAccountLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reduced_code: z.string().min(1),
        hierarchical_code: z.string().default(""),
        nature: z.string().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await callRpc<{ ok: boolean }>(context.supabase, "set_account_link", {
      _reduced_code: data.reduced_code,
      _hierarchical_code: data.hierarchical_code,
      _nature: data.nature,
    });
    await context.supabase.rpc("log_activity", {
      _action: "vinculou conta do razão",
      _entity_type: "ledger_accounts",
      _metadata: { ...data },
    });
    return result;
  });

/* ===================== Gerenciador de lançamentos ===================== */

/** Grade de movimentos do período (1 linha = 1 lançamento débito × crédito). */
export const listJournalEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid(),
        query: z.string().max(120).default(""),
        from: z.string().nullable().default(null),
        to: z.string().nullable().default(null),
        account: z.string().nullable().default(null),
        include_cancelled: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_entries_grid", {
      _period_id: data.period_id,
      _query: data.query,
      _from: data.from,
      _to: data.to,
      _account: data.account,
      _include_cancelled: data.include_cancelled,
      _limit: data.limit,
      _offset: data.offset,
    }),
  );

/** Cria ou edita um lançamento manual (grava as duas pernas de uma vez). */
export const saveManualJournalEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid(),
        leg_id: z.string().uuid().nullable().default(null),
        debit_code: z.string().min(1),
        credit_code: z.string().min(1),
        entry_date: z.string().min(8),
        doc_number: z.string().default(""),
        value: z.number().finite().positive(),
        historico: z.string().min(1).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ id: string; entry_group: string }>(
      context.supabase,
      "upsert_manual_journal_entry",
      {
        _period_id: data.period_id,
        _debit_code: data.debit_code,
        _credit_code: data.credit_code,
        _entry_date: data.entry_date,
        _doc_number: data.doc_number,
        _value: data.value,
        _historico: data.historico,
        _leg_id: data.leg_id,
      },
    ),
  );

/** Cancela um lançamento (as duas pernas) sem apagá-lo do histórico. */
export const cancelJournalEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ leg_id: z.string().uuid(), motivo: z.string().max(200).default("") })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ cancelled: number }>(context.supabase, "cancel_journal_entry", {
      _leg_id: data.leg_id,
      _motivo: data.motivo,
    }),
  );

/* ------------------------- PLANO DE CONTAS (razão) ------------------------- */

/** Grade paginada do plano de contas oficial, com contagem de lançamentos. */
export const listChartAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid().nullable().default(null),
        query: z.string().max(120).default(""),
        nature: z.string().nullable().default(null),
        type: z.enum(["analitica", "sintetica"]).nullable().default(null),
        only_pending: z.boolean().default(false),
        only_active: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "chart_accounts_grid", {
      _period_id: data.period_id,
      _query: data.query,
      _nature: data.nature,
      _type: data.type,
      _only_pending: data.only_pending,
      _only_active: data.only_active,
      _limit: data.limit,
      _offset: data.offset,
    }),
  );

/** Cria ou edita uma conta do plano (Admin). */
export const saveChartAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().default(null),
        reduced_code: z.string().min(1).max(20),
        hierarchical_code: z.string().max(40).nullable().default(null),
        name: z.string().min(1).max(200),
        is_analytic: z.boolean().default(true),
        nature: z.string().nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ id: string }>(context.supabase, "upsert_ledger_account", {
      _id: data.id,
      _reduced_code: data.reduced_code,
      _hierarchical_code: data.hierarchical_code,
      _name: data.name,
      _is_analytic: data.is_analytic,
      _nature: data.nature,
    }),
  );

/** Reclassifica em lote a natureza e/ou a conta-pai das contas selecionadas (Admin). */
export const reclassifyChartAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        nature: z.string().nullable().default(null),
        parent_code: z.string().max(40).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ updated: number }>(context.supabase, "set_ledger_accounts_nature", {
      _ids: data.ids,
      _nature: data.nature,
      _parent_code: data.parent_code,
    }),
  );

/** Ativa ou desativa uma conta do plano (Admin). */
export const setChartAccountActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ id: string; is_active: boolean }>(context.supabase, "set_ledger_account_active", {
      _id: data.id,
      _active: data.active,
    }),
  );

/* ------------------------------- RELATÓRIOS ------------------------------- */

const reportFilters = {
  period_id: z.string().uuid(),
  codes: z.array(z.string().min(1)).max(2000).default([]),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
};

/** Razão contábil analítico: contas selecionadas com saldo anterior, lançamentos e totais. */
export const getLedgerReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ ...reportFilters, doc_number: z.string().max(40).nullable().default(null) })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "journal_report_analytic", {
      _period_id: data.period_id,
      _codes: data.codes.length ? data.codes : null,
      _from: data.from,
      _to: data.to,
      _doc_number: data.doc_number,
    }),
  );

/** Balancete do intervalo, analítico (por conta) ou sintético (por grupo contábil). */
export const getTrialBalanceReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ...reportFilters,
        mode: z.enum(["analitico", "sintetico"]).default("analitico"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "trial_balance_report", {
      _period_id: data.period_id,
      _codes: data.codes.length ? data.codes : null,
      _from: data.from,
      _to: data.to,
      _mode: data.mode,
    }),
  );


/** Gera PDF ou Excel do relatório escolhido, salva no bucket privado e devolve signed URL. */
export const exportLedgerReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ...reportFilters,
        doc_number: z.string().max(40).nullable().default(null),
        kind: z.enum(["razao", "balancete"]),
        format: z.enum(["pdf", "xlsx"]),
        multi_page: z.boolean().default(false),
        mode: z.enum(["analitico", "sintetico"]).default("analitico"),
        show_plan: z.boolean().default(true),

      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: period, error: periodError } = await context.supabase
      .from("accounting_periods")
      .select("id, label")
      .eq("id", data.period_id)
      .maybeSingle();
    if (periodError) throw new Error(periodError.message);
    if (!period) throw new Error("Período não encontrado.");

    const generatedAt = new Date();
    const codes = data.codes.length ? data.codes : null;
    const builders = await import("@/lib/razao-report.server");

    let bytes: Uint8Array;
    let contentType: string;

    if (data.kind === "razao") {
      const report = await callRpc<import("@/lib/razao-report-types").LedgerReport>(
        context.supabase,
        "journal_report_analytic",
        {
          _period_id: data.period_id,
          _codes: codes,
          _from: data.from,
          _to: data.to,
          _doc_number: data.doc_number,
        },
      );
      if (data.format === "pdf") {
        bytes = await builders.buildLedgerReportPdf({
          periodLabel: period.label,
          report,
          multiPage: data.multi_page,
          generatedAt,
        });
        contentType = "application/pdf";
      } else {
        bytes = new Uint8Array(
          builders.buildLedgerReportXlsx({
            periodLabel: period.label,
            report,
            multiPage: data.multi_page,
            generatedAt,
          }),
        );
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
    } else {
      const report = await callRpc<import("@/lib/razao-report-types").TrialBalanceReport>(
        context.supabase,
        "trial_balance_report",
        { _period_id: data.period_id, _codes: codes, _from: data.from, _to: data.to },
      );
      if (data.format === "pdf") {
        bytes = await builders.buildTrialBalanceReportPdf({
          periodLabel: period.label,
          report,
          generatedAt,
        });
        contentType = "application/pdf";
      } else {
        bytes = new Uint8Array(
          builders.buildTrialBalanceReportXlsx({
            periodLabel: period.label,
            report,
            generatedAt,
          }),
        );
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
    }

    const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T-]/g, "");
    const fileName = `${data.kind === "razao" ? "razao-analitico" : "balancete-analitico"}-${stamp}.${data.format}`;
    const path = `${data.period_id}/relatorios/${fileName}`;

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
      _action: `exportou ${data.kind} em ${data.format.toUpperCase()}`,
      _entity_type: "journal_legs",
      _metadata: { period_id: data.period_id, path, contas: data.codes.length },
    });

    return { url: signed.signedUrl, file_name: fileName, size: bytes.byteLength };
  });
