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
  /** Períodos que cobrem o intervalo de datas escolhido; vazio = apenas o período ativo. */
  period_ids: z.array(z.string().uuid()).max(60).default([]),
  codes: z.array(z.string().min(1)).max(2000).default([]),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
};

/** Rótulo do cabeçalho: intervalo de datas quando houver, senão o rótulo do período. */
function rangeLabel(periodLabel: string, from: string | null, to: string | null, count: number) {
  const day = (v: string) => v.slice(0, 10).split("-").reverse().join("/");
  if (!from && !to) return periodLabel;
  const range = `${from ? day(from) : "início"} a ${to ? day(to) : "fim"}`;
  return count > 1 ? `${range} · ${count} períodos` : `${periodLabel} · ${range}`;
}


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
      _period_ids: data.period_ids.length ? data.period_ids : null,
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
      _period_ids: data.period_ids.length ? data.period_ids : null,
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
    const periodIds = data.period_ids.length ? data.period_ids : null;
    const headerLabel = rangeLabel(
      period.label,
      data.from,
      data.to,
      data.period_ids.length || 1,
    );
    const builders = await import("@/lib/razao-report.server");

    let bytes: Uint8Array;
    let contentType: string;

    if (data.kind === "razao") {
      const report = await callRpc<import("@/lib/razao-report-types").LedgerReport>(
        context.supabase,
        "journal_report_analytic",
        {
          _period_id: data.period_id,
          _period_ids: periodIds,
          _codes: codes,
          _from: data.from,
          _to: data.to,
          _doc_number: data.doc_number,
        },
      );
      if (data.format === "pdf") {
        bytes = await builders.buildLedgerReportPdf({
          periodLabel: headerLabel,
          report,
          multiPage: data.multi_page,
          generatedAt,
        });
        contentType = "application/pdf";
      } else {
        bytes = new Uint8Array(
          builders.buildLedgerReportXlsx({
            periodLabel: headerLabel,
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
        {
          _period_id: data.period_id,
          _period_ids: periodIds,
          _codes: codes,
          _from: data.from,
          _to: data.to,
          _mode: data.mode,
        },
      );
      if (data.format === "pdf") {
        bytes = await builders.buildTrialBalanceReportPdf({
          periodLabel: headerLabel,
          report,
          generatedAt,
          mode: data.mode,
          showPlan: data.show_plan,
        });
        contentType = "application/pdf";
      } else {
        bytes = new Uint8Array(
          builders.buildTrialBalanceReportXlsx({
            periodLabel: headerLabel,
            report,
            generatedAt,
            mode: data.mode,
            showPlan: data.show_plan,
          }),
        );
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      }
    }


    const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T-]/g, "");
    const baseName =
      data.kind === "razao"
        ? "razao-analitico"
        : `balancete-${data.mode === "sintetico" ? "sintetico" : "analitico"}`;
    const fileName = `${baseName}-${stamp}.${data.format}`;

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

/* ------------------------------ FECHAMENTO CONTÁBIL ------------------------------ */

/** Quadro do ano: situação dos 12 meses, fechamento anual e contas de encerramento. */
export const getClosingGrid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ year: z.number().int().min(2000).max(2100) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "closing_year_grid", { _year: data.year }),
  );

/** Resumo por grupo contábil (Ativo, Passivo, Custos/Despesas, Receitas) do período. */
export const getClosingSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<JsonObject>(context.supabase, "closing_summary", { _period_id: data.period_id }),
  );

/** Fechamento parcial do mês: gera a apuração no razão (ou apenas trava) e fecha o período. */
export const closePeriodPartial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid(),
        result_code: z.string().max(20).default(""),
        profit_code: z.string().max(20).default(""),
        mode: z.enum(["gerar", "travar"]).default("gerar"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ accounts: number; result_value: number; mode: string }>(
      context.supabase,
      "close_period_partial",
      {
        _period_id: data.period_id,
        _result_code: data.result_code,
        _profit_code: data.profit_code,
        _mode: data.mode,
      },
    ),
  );

/** Cancela o fechamento do mês, estornando os lançamentos de encerramento. */
export const reopenPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ period_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    callRpc<{ cancelled_legs: number }>(context.supabase, "reopen_period", {
      _period_id: data.period_id,
    }),
  );

/** Fecha o exercício (exige os 12 meses fechados). */
export const closeFiscalYear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ year: z.number().int().min(2000).max(2100) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ result_value: number }>(context.supabase, "close_fiscal_year", { _year: data.year }),
  );

/** Cancela o fechamento do exercício, liberando a reabertura dos meses. */
export const reopenFiscalYear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ year: z.number().int().min(2000).max(2100) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ cancelled_legs: number }>(context.supabase, "reopen_fiscal_year", {
      _year: data.year,
    }),
  );

/** Salva as contas padrão de encerramento (Admin). */
export const saveClosingAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ result_code: z.string().min(1).max(20), profit_code: z.string().min(1).max(20) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const rows = [
      { key: "closing.result_account", value: data.result_code.trim() },
      { key: "closing.profit_account", value: data.profit_code.trim() },
    ];
    for (const row of rows) {
      const { error } = await context.supabase
        .from("app_settings")
        .upsert({ ...row, updated_by: context.userId, updated_at: new Date().toISOString() }, {
          onConflict: "key",
        });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Cria o período de um mês do ano quando ele ainda não existe (Admin). */
export const ensurePeriodForMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const reference = `${data.year}-${String(data.month).padStart(2, "0")}-01`;
    const { data: existing } = await context.supabase
      .from("accounting_periods")
      .select("id")
      .eq("reference_month", reference)
      .maybeSingle();
    if (existing) return { id: existing.id, created: false };

    const label = new Date(Date.UTC(data.year, data.month - 1, 1)).toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const pretty = `${label.charAt(0).toUpperCase()}${label.slice(1)}`.replace(" de ", "/");

    const { data: created, error } = await context.supabase
      .from("accounting_periods")
      .insert({
        label: pretty,
        reference_month: reference,
        status: "aberto",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id, created: true };
  });

/* --------------------- ÁRVORE / AUDITORIA DO PLANO DE CONTAS --------------------- */

export type ChartTreeRow = {
  id: string;
  reduced_code: string;
  hierarchical_code: string | null;
  name: string;
  level: number | null;
  parent_code: string | null;
  is_analytic: boolean;
  nature: string | null;
  is_active: boolean;
  matched: boolean;
  children_count: number;
  legs_count: number;
  balance: number;
};

export type ChartMovePreview = {
  id: string;
  reduced_code: string;
  name: string;
  de: string;
  para: string;
  natureza_de: string | null;
  natureza_para: string | null;
  ramo: number;
};

export type ChartSuggestionRow = {
  id: string;
  account_id: string | null;
  reduced_code: string;
  account_name: string;
  kind: "mover" | "natureza" | "tipo_conta";
  current_value: string | null;
  suggested_value: string;
  suggested_parent: string | null;
  suggested_nature: string | null;
  suggested_is_analytic: boolean | null;
  reasoning: string;
  confidence: number;
  status: string;
  created_at: string;
};

/** Árvore do plano de contas com saldo agregado do período. */
export const getChartTree = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        period_id: z.string().uuid().nullable().default(null),
        query: z.string().nullable().default(null),
        nature: z.string().nullable().default(null),
        only_pending: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ rows: ChartTreeRow[] }>(context.supabase, "chart_accounts_tree", {
      _period_id: data.period_id,
      _query: data.query,
      _nature: data.nature,
      _only_pending: data.only_pending,
    }),
  );

export type ChartAuditItem = {
  id: string;
  reduced_code: string;
  name: string;
  hierarchical_code: string | null;
  nature?: string | null;
  nature_esperada?: string | null;
};

/** Painel de inconsistências estruturais do plano de contas. */
export const getChartAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    callRpc<Record<string, ChartAuditItem[]>>(context.supabase, "chart_accounts_audit"),
  );

/** Move contas (e todo o ramo abaixo delas) para outro grupo. Use dry_run para a prévia. */
export const moveChartAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        parent_code: z.string().min(1).max(40),
        dry_run: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{
      dry_run: boolean;
      moved: number;
      preview: ChartMovePreview[];
      periods_recalculated?: number;
    }>(context.supabase, "move_ledger_accounts", {
      _ids: data.ids,
      _new_parent_hier: data.parent_code,
      _dry_run: data.dry_run,
    }),
  );

/** Promove ou rebaixa uma conta entre sintética e analítica. */
export const setChartAccountKind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), is_analytic: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ id: string; is_analytic: boolean; changed: boolean }>(
      context.supabase,
      "set_ledger_account_kind",
      { _id: data.id, _is_analytic: data.is_analytic },
    ),
  );

/** Renumera as filhas diretas de um grupo, sem furos. */
export const renumberChartBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ parent_code: z.string().min(1).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc<{ renumbered: number }>(context.supabase, "renumber_branch", {
      _parent_hier: data.parent_code,
    }),
  );

/** Lista as sugestões da IA para o plano de contas. */
export const listChartSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ status: z.string().default("pendente") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chart_ai_suggestions")
      .select("*")
      .eq("status", data.status)
      .order("confidence", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as ChartSuggestionRow[];
  });

/** Roda o analista de IA sobre as contas pendentes (ou as selecionadas) e grava as sugestões. */
export const analyzeChartWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).max(300).default([]),
        limit: z.number().int().min(1).max(150).default(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { analyzeChartAccounts, proposalHash } = await import("./chart-ai.server");

    const tree = await callRpc<{ rows: ChartTreeRow[] }>(
      context.supabase,
      "chart_accounts_tree",
      { _period_id: null, _query: null, _nature: null, _only_pending: false },
    );
    const rows = tree.rows ?? [];

    const selected = new Set(data.ids);
    const candidates = (
      selected.size > 0
        ? rows.filter((r) => selected.has(r.id))
        : rows.filter(
            (r) =>
              r.is_analytic &&
              (!r.hierarchical_code || !r.nature || !r.parent_code || r.legs_count === 0),
          )
    ).slice(0, data.limit);

    if (candidates.length === 0) return { analyzed: 0, created: 0 };

    const groups = rows
      .filter((r) => !r.is_analytic && r.hierarchical_code)
      .map((r) => ({
        hierarchical_code: r.hierarchical_code as string,
        name: r.name,
        nature: r.nature,
      }));

    const suggestions = await analyzeChartAccounts(
      candidates.map((c) => ({
        id: c.id,
        reduced_code: c.reduced_code,
        name: c.name,
        hierarchical_code: c.hierarchical_code,
        nature: c.nature,
        is_analytic: c.is_analytic,
        legs_count: c.legs_count,
      })),
      groups,
    );

    if (suggestions.length === 0) return { analyzed: candidates.length, created: 0 };

    const hashes = suggestions.map(proposalHash);
    const { data: existing } = await context.supabase
      .from("chart_ai_suggestions")
      .select("proposal_hash")
      .in("proposal_hash", hashes);
    const known = new Set((existing ?? []).map((r) => (r as { proposal_hash: string }).proposal_hash));

    const payload = suggestions
      .filter((s) => !known.has(proposalHash(s)))
      .map((s) => ({
        account_id: s.account_id,
        reduced_code: s.reduced_code,
        account_name: s.account_name,
        kind: s.kind,
        current_value: s.current_value,
        suggested_value: s.suggested_value,
        suggested_parent: s.suggested_parent,
        suggested_nature: s.suggested_nature,
        suggested_is_analytic: s.suggested_is_analytic,
        reasoning: s.reasoning,
        confidence: s.confidence,
        proposal_hash: proposalHash(s),
        status: "pendente",
      }));

    if (payload.length > 0) {
      const { error } = await context.supabase.from("chart_ai_suggestions").insert(payload as never);
      if (error) throw new Error(error.message);
    }

    return { analyzed: candidates.length, created: payload.length };
  });

/** Aplica ou rejeita sugestões da IA. Aplicar move/reclassifica de verdade e registra auditoria. */
export const decideChartSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        decision: z.enum(["aplicada", "rejeitada"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chart_ai_suggestions")
      .select("*")
      .in("id", data.ids)
      .eq("status", "pendente");
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as unknown as ChartSuggestionRow[];

    const applied: string[] = [];
    const failures: Array<{ reduced_code: string; message: string }> = [];

    if (data.decision === "aplicada") {
      for (const s of list) {
        if (!s.account_id) continue;
        try {
          if (s.kind === "mover" && s.suggested_parent) {
            await callRpc(context.supabase, "move_ledger_accounts", {
              _ids: [s.account_id],
              _new_parent_hier: s.suggested_parent,
              _dry_run: false,
            });
          } else if (s.kind === "natureza" && s.suggested_nature) {
            await callRpc(context.supabase, "set_ledger_accounts_nature", {
              _ids: [s.account_id],
              _nature: s.suggested_nature,
              _parent_code: null,
            });
          } else if (s.kind === "tipo_conta" && s.suggested_is_analytic !== null) {
            await callRpc(context.supabase, "set_ledger_account_kind", {
              _id: s.account_id,
              _is_analytic: s.suggested_is_analytic,
            });
          } else {
            continue;
          }
          applied.push(s.id);
        } catch (err) {
          failures.push({
            reduced_code: s.reduced_code,
            message: err instanceof Error ? err.message : "Falha ao aplicar",
          });
        }
      }
    }

    const toUpdate = data.decision === "aplicada" ? applied : list.map((s) => s.id);
    if (toUpdate.length > 0) {
      const { error: upErr } = await context.supabase
        .from("chart_ai_suggestions")
        .update({
          status: data.decision,
          decided_at: new Date().toISOString(),
        } as never)
        .in("id", toUpdate);
      if (upErr) throw new Error(upErr.message);
    }

    return { decided: toUpdate.length, failures };
  });
