import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { AGENTS, type AgentKey } from "@/lib/agents/personas";
import { AgentProposalCard } from "./AgentProposalCard";

const TOOL_LABELS: Record<string, string> = {
  resumo_periodo: "Resumo do período",
  balancete_por_natureza: "Balancete por natureza",
  contas_sem_natureza: "Contas sem natureza",
  indicadores: "Indicadores",
  demonstrativos: "Demonstrativos",
  apontamentos: "Apontamentos",
  comparar_periodos: "Comparação de períodos",
  periodos_disponiveis: "Períodos disponíveis",
  razao_buscar_lancamentos: "Busca no razão",
  razao_lancamento_detalhe: "Detalhe do lançamento",
  propor_classificacao: "Proposta de classificação",
  propor_apontamento: "Proposta de apontamento",
  propor_ajuste_lancamento: "Proposta de ajuste de lançamento",
};


type Props = {
  threadId: string;
  agent: AgentKey;
  periodId: string | null;
  periodLabel: string | null;
  initialMessages: UIMessage[];
  isAdmin: boolean;
};

export function AgentChat({
  threadId,
  agent,
  periodId,
  periodLabel,
  initialMessages,
  isAdmin,
}: Props) {
  const persona = AGENTS[agent];
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agents/chat",
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        body: { threadId, agent, periodId },
      }),
    [threadId, agent, periodId],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (err) => toast.error(err.message || "Falha ao falar com o agente."),
  });

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const submit = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value || isBusy) return;
      setInput("");
      await sendMessage({ text: value });
      inputRef.current?.focus();
    },
    [isBusy, sendMessage],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-1 py-4">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-brand">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{persona.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{persona.description}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Período: {periodLabel ?? "nenhum selecionado"}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {persona.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void submit(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-[var(--glow-border)] hover:text-foreground hover:shadow-[var(--glow-soft)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex w-full",
              message.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-card-foreground",
              )}
            >
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <div
                      key={index}
                      className="prose prose-sm dark:prose-invert max-w-none break-words [&_table]:text-xs"
                    >
                      <ReactMarkdown>{part.text}</ReactMarkdown>
                    </div>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  const toolName = part.type.slice("tool-".length);
                  const output = (part as { output?: unknown }).output as
                    | Record<string, unknown>
                    | undefined;
                  const proposal = output?.["proposta"];
                  if (proposal === "classificacao" || proposal === "apontamento") {
                    return (
                      <AgentProposalCard
                        key={index}
                        threadId={threadId}
                        periodId={periodId}
                        payload={output as Record<string, unknown>}
                        isAdmin={isAdmin}
                      />
                    );
                  }
                  return (
                    <p
                      key={index}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Wrench className="size-3.5 text-brand" />
                      Consultou: {TOOL_LABELS[toolName] ?? toolName}
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {status === "submitted" ? (
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-brand" />
            {persona.name} está analisando os dados...
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input);
        }}
      >
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit(input);
            }
          }}
          rows={2}
          placeholder={`Pergunte ao ${persona.name}...`}
          className="min-h-[56px] resize-none"
        />
        <Button type="submit" disabled={isBusy || !input.trim()} className="h-[56px] px-4">
          {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
