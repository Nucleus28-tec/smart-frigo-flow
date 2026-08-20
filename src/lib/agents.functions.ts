/** Server functions das conversas com os agentes de IA. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const NATURES = [
  "ativo_circulante",
  "ativo_nao_circulante",
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
  "receita",
  "custo",
  "despesa",
] as const;

const createSchema = z.object({
  agent: z.enum(["contador", "cfo"]),
  period_id: z.string().uuid().nullable().optional(),
});

const idSchema = z.object({ thread_id: z.string().uuid() });

const applySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("classificacao"),
    thread_id: z.string().uuid(),
    natureza: z.enum(NATURES),
    account_ids: z.array(z.string().uuid()).min(1).max(200),
  }),
  z.object({
    kind: z.literal("apontamento"),
    thread_id: z.string().uuid(),
    period_id: z.string().uuid(),
    tipo: z.string().min(1),
    descricao: z.string().min(1),
    correcao_sugerida: z.string().optional(),
    severidade: z.enum(["baixa", "media", "alta"]),
  }),
  z.object({
    kind: z.literal("ajuste_lancamento"),
    thread_id: z.string().uuid(),
    leg_id: z.string().uuid(),
    nova_conta: z.string().trim().min(1).nullable(),
    novo_valor: z.number().positive().nullable(),
    justificativa: z.string().min(1),
  }),
]);


async function assertAdmin(supabase: {
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
}) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) throw new Error("Acesso restrito a administradores.");
}

export const listAgentThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("agent_threads")
      .select("id, agent, title, period_id, created_at, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { threads: data ?? [] };
  });

export const createAgentThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("agent_threads")
      .insert({
        user_id: context.userId,
        agent: data.agent,
        period_id: data.period_id ?? null,
      })
      .select("id, agent, title, period_id, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return { thread: row };
  });

export const getAgentThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: thread, error } = await context.supabase
      .from("agent_threads")
      .select("id, agent, title, period_id, created_at, updated_at")
      .eq("id", data.thread_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!thread) throw new Error("Conversa não encontrada.");

    const { data: messages, error: messagesError } = await context.supabase
      .from("agent_messages")
      .select("id, role, parts, client_message_id, created_at")
      .eq("thread_id", data.thread_id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (messagesError) throw new Error(messagesError.message);

    return { thread, messages: messages ?? [] };
  });

export const deleteAgentThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agent_threads")
      .delete()
      .eq("id", data.thread_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Aplica uma proposta do Agente Contador (somente Admin). */
export const applyAgentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => applySchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);

    if (data.kind === "classificacao") {
      const { error } = await context.supabase
        .from("chart_of_accounts")
        .update({
          nature: data.natureza,
          is_confirmed: true,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        })
        .in("id", data.account_ids);
      if (error) throw new Error(error.message);

      const { error: entriesError } = await context.supabase
        .from("ledger_entries")
        .update({ nature: data.natureza, updated_by: context.userId })
        .in("account_id", data.account_ids);
      if (entriesError) throw new Error(entriesError.message);

      await context.supabase.rpc("log_activity", {
        _action: "agent_action_applied",
        _entity_type: "chart_of_accounts",
        _metadata: {
          kind: "classificacao",
          thread_id: data.thread_id,
          natureza: data.natureza,
          contas: data.account_ids.length,
        },
      });
      return { ok: true, affected: data.account_ids.length };
    }

    const { data: finding, error } = await context.supabase
      .from("audit_findings")
      .insert({
        period_id: data.period_id,
        finding_type: data.tipo,
        description: data.descricao,
        suggested_fix: data.correcao_sugerida ?? null,
        severity: data.severidade,
        status: "aberto",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.rpc("log_activity", {
      _action: "agent_action_applied",
      _entity_type: "audit_findings",
      _entity_id: finding.id,
      _metadata: { kind: "apontamento", thread_id: data.thread_id },
    });
    return { ok: true, finding_id: finding.id };
  });
