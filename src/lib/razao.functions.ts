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
