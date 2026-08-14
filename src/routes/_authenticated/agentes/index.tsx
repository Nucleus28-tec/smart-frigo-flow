import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Calculator, LineChart } from "lucide-react";

import { PageHeader, LoadingRows, ErrorState } from "@/components/PageState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePeriod } from "@/hooks/usePeriod";
import { AGENTS, type AgentKey } from "@/lib/agents/personas";
import {
  createAgentThread,
  deleteAgentThread,
  listAgentThreads,
} from "@/lib/agents.functions";
import { AgentThreadList, type ThreadRow } from "@/components/agents/AgentThreadList";

export const Route = createFileRoute("/_authenticated/agentes/")({
  component: AgentesPage,
  head: () => ({
    meta: [
      { title: "Agentes de IA | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Converse com o Agente Contador e o Agente CFO do Rotta Financeiro para analisar o período contábil.",
      },
      { property: "og:title", content: "Agentes de IA | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Agentes de contabilidade e CFO integrados ao ERP financeiro da Rota Alimentos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AgentesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedPeriodId, selectedPeriod } = usePeriod();

  const fetchThreads = useServerFn(listAgentThreads);
  const createThread = useServerFn(createAgentThread);
  const removeThread = useServerFn(deleteAgentThread);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["agent-threads"],
    queryFn: () => fetchThreads(),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-threads"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const threads = (data?.threads ?? []) as ThreadRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agentes de IA"
        description={`Contador e CFO trabalhando sobre o período ${selectedPeriod?.label ?? "não selecionado"}.`}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="p-3">
            {isLoading ? (
              <LoadingRows rows={4} />
            ) : error ? (
              <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
            ) : (
              <AgentThreadList
                threads={threads}
                creating={create.isPending}
                onCreate={(agent) => create.mutate(agent)}
                onDelete={(id) => remove.mutate(id)}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(AGENTS) as AgentKey[]).map((key) => {
            const persona = AGENTS[key];
            const Icon = key === "cfo" ? LineChart : Calculator;
            return (
              <Card
                key={key}
                className="transition-all hover:border-[var(--glow-border)] hover:shadow-[var(--glow-soft)]"
              >
                <CardContent className="space-y-3 p-5">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="size-5 text-brand" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">{persona.name}</h2>
                    <p className="text-xs text-muted-foreground">{persona.tagline}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{persona.description}</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {persona.suggestions.slice(0, 3).map((s) => (
                      <li key={s}>• {s}</li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    disabled={create.isPending}
                    onClick={() => create.mutate(key)}
                  >
                    Conversar com o {persona.name.replace("Agente ", "")}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
