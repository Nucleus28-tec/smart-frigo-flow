import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { formatDateTime } from "@/lib/rotta";

export const Route = createFileRoute("/_authenticated/atualizacoes")({
  component: AtualizacoesPage,
  head: () => ({
    meta: [
      { title: "Atualizações | Rotta Financeiro" },
      {
        name: "description",
        content: "Trilha de auditoria com todas as ações realizadas pela equipe dentro do ERP.",
      },
      { property: "og:title", content: "Atualizações | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Trilha de auditoria das ações realizadas no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AtualizacoesPage() {
  const log = useQuery({
    queryKey: ["activity_log", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, entity_type, entity_id, created_at, profiles:actor_id(full_name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader
        title="Atualizações"
        description="Registro imutável de quem fez o quê e quando, exigido pela política de rastreabilidade."
      />

      {log.isLoading ? (
        <LoadingRows />
      ) : log.isError ? (
        <ErrorState message={(log.error as Error)?.message} onRetry={() => void log.refetch()} />
      ) : log.data!.length === 0 ? (
        <EmptyState
          title="Nenhuma atividade registrada"
          description="As ações da equipe aparecerão aqui automaticamente."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {log.data!.map((item) => {
                const actor = item.profiles as { full_name?: string } | null;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{actor?.full_name ?? "Sistema"}</span>{" "}
                      {item.action}{" "}
                      <span className="text-muted-foreground">({item.entity_type})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
