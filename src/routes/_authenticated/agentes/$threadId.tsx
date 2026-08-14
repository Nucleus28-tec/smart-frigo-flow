import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { UIMessage } from "ai";
import { toast } from "sonner";

import { PageHeader, LoadingRows, ErrorState } from "@/components/PageState";
import { Card, CardContent } from "@/components/ui/card";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { AGENTS, type AgentKey } from "@/lib/agents/personas";
import {
  createAgentThread,
  deleteAgentThread,
  getAgentThread,
  listAgentThreads,
} from "@/lib/agents.functions";
import { AgentThreadList, type ThreadRow } from "@/components/agents/AgentThreadList";
import { AgentChat } from "@/components/agents/AgentChat";

export const Route = createFileRoute("/_authenticated/agentes/$threadId")({
  component: AgentThreadPage,
  head: () => ({
    meta: [
      { title: "Conversa com agente | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Conversa com o agente de IA do Rotta Financeiro sobre o balancete e os indicadores do período.",
      },
      { property: "og:title", content: "Conversa com agente | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Análise contábil e executiva assistida por IA no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AgentThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedPeriodId, selectedPeriod } = usePeriod();
  const { data: profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const fetchThreads = useServerFn(listAgentThreads);
  const fetchThread = useServerFn(getAgentThread);
  const createThread = useServerFn(createAgentThread);
  const removeThread = useServerFn(deleteAgentThread);

  const threadsQuery = useQuery({
    queryKey: ["agent-threads"],
    queryFn: () => fetchThreads(),
  });

  const threadQuery = useQuery({
    queryKey: ["agent-thread", threadId],
    queryFn: () => fetchThread({ data: { thread_id: threadId } }),
  });

  const create = useMutation({
    mutationFn: (agent: AgentKey) =>
      createThread({ data: { agent, period_id: selectedPeriodId } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["agent-threads"] });
      navigate({ to: "/agentes/$threadId", params: { threadId: result.thread.id } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeThread({ data: { thread_id: id } }),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["agent-threads"] });
      if (id === threadId) navigate({ to: "/agentes" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const threads = (threadsQuery.data?.threads ?? []) as ThreadRow[];
  const thread = threadQuery.data?.thread;
  const agent = (thread?.agent === "cfo" ? "cfo" : "contador") as AgentKey;
  const messages = (threadQuery.data?.messages ?? []) as UIMessage[];
  const periodId = thread?.period_id ?? selectedPeriodId;

  return (
    <div className="space-y-6">
      <PageHeader
        title={thread?.title ?? "Conversa"}
        description={`${AGENTS[agent].name} · período ${selectedPeriod?.label ?? "não selecionado"}`}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="hidden lg:block">
          <CardContent className="h-[70vh] p-3">
            {threadsQuery.isLoading ? (
              <LoadingRows rows={4} />
            ) : (
              <AgentThreadList
                threads={threads}
                activeId={threadId}
                creating={create.isPending}
                onCreate={(a) => create.mutate(a)}
                onDelete={(id) => remove.mutate(id)}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="h-[70vh] p-4">
            {threadQuery.isLoading ? (
              <LoadingRows rows={5} />
            ) : threadQuery.error ? (
              <ErrorState
                message={(threadQuery.error as Error).message}
                onRetry={() => void threadQuery.refetch()}
              />
            ) : (
              <AgentChat
                key={threadId}
                threadId={threadId}
                agent={agent}
                periodId={periodId}
                periodLabel={selectedPeriod?.label ?? null}
                initialMessages={messages}
                isAdmin={Boolean(isAdmin)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
