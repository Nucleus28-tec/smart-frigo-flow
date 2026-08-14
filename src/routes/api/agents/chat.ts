/** Endpoint de streaming dos agentes de IA (Contador e CFO). */
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { isAgentKey } from "@/lib/agents/personas";
import { supabaseFromRequest } from "@/lib/agents/supabase.server";
import { buildAgentTools } from "@/lib/agents/tools.server";
import { resolveAgentModel, type AgentProvider } from "@/lib/agents/model.server";
import { systemPrompt } from "@/lib/agents/prompts.server";

type Body = {
  messages?: UIMessage[];
  threadId?: string;
  agent?: string;
  periodId?: string | null;
};

export const Route = createFileRoute("/api/agents/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await supabaseFromRequest(request);
        if (!auth) return new Response("Não autenticado", { status: 401 });
        const { supabase, userId } = auth;

        const body = (await request.json()) as Body;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (!messages.length) return new Response("Mensagens obrigatórias", { status: 400 });

        const threadId = body.threadId;
        if (!threadId) return new Response("Conversa obrigatória", { status: 400 });

        const { data: thread, error: threadError } = await supabase
          .from("agent_threads")
          .select("id, agent, period_id, user_id, title")
          .eq("id", threadId)
          .maybeSingle();
        if (threadError) return new Response(threadError.message, { status: 400 });
        if (!thread || thread.user_id !== userId) {
          return new Response("Conversa não encontrada", { status: 404 });
        }

        const agent = isAgentKey(body.agent)
          ? body.agent
          : isAgentKey(thread.agent)
            ? thread.agent
            : "contador";
        const periodId = body.periodId ?? thread.period_id ?? null;

        let periodLabel: string | null = null;
        if (periodId) {
          const { data: period } = await supabase
            .from("accounting_periods")
            .select("label")
            .eq("id", periodId)
            .maybeSingle();
          periodLabel = period?.label ?? null;
        }

        const { data: setting } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "ai_provider")
          .maybeSingle();
        const provider: AgentProvider = setting?.value === "lovable" ? "lovable" : "gemini";

        let model;
        try {
          model = resolveAgentModel(provider).model;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao iniciar a IA.";
          return new Response(message, { status: 500 });
        }

        // Persiste a última mensagem do usuário antes de responder.
        const last = messages[messages.length - 1];
        if (last?.role === "user") {
          await supabase.from("agent_messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            parts: last.parts as never,
            client_message_id: last.id,
          });
          const firstText = last.parts.find((p) => p.type === "text");
          if (thread.title === "Nova conversa" && firstText && "text" in firstText) {
            await supabase
              .from("agent_threads")
              .update({ title: String(firstText.text).slice(0, 70) })
              .eq("id", threadId);
          }
        }

        const result = streamText({
          model,
          system: systemPrompt(agent, periodLabel),
          messages: await convertToModelMessages(messages),
          tools: buildAgentTools({ supabase, periodId, agent }),
          stopWhen: stepCountIs(50),
          temperature: 0.2,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ responseMessage }) => {
            if (!responseMessage) return;
            const { error } = await supabase.from("agent_messages").insert({
              thread_id: threadId,
              user_id: userId,
              role: "assistant",
              parts: responseMessage.parts as never,
              client_message_id: responseMessage.id,
            });
            if (error) console.error("[agentes] falha ao salvar resposta:", error.message);
            await supabase
              .from("agent_threads")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", threadId);
          },
        });
      },
    },
  },
});
