import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileSpreadsheet, ListChecks, Table2, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { PERIOD_STATUS_LABEL, formatDateTime } from "@/lib/rotta";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Visão geral do período contábil: sugestões pendentes, apontamentos abertos e demonstrativos gerados.",
      },
      { property: "og:title", content: "Dashboard | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Visão geral do período contábil no ERP Financeiro Inteligente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Summary = {
  pending_suggestions: number;
  open_findings: number;
  statements_generated: number;
  entries_count: number;
  files_count: number;
};

function DashboardPage() {
  const { selectedPeriod, selectedPeriodId, isLoading: loadingPeriods } = usePeriod();
  const { data: profile } = useProfile();

  const summary = useQuery({
    queryKey: ["period-summary", selectedPeriodId],
    enabled: !!selectedPeriodId,
    queryFn: async (): Promise<Summary> => {
      const { data, error } = await supabase.rpc("get_period_summary", {
        _period_id: selectedPeriodId!,
      });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const activity = useQuery({
    queryKey: ["activity-log", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, entity_type, created_at, profiles:actor_id(full_name)")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loadingPeriods) return <LoadingRows rows={4} />;

  if (!selectedPeriodId) {
    return (
      <>
        <PageHeader title={`Olá, ${profile?.full_name?.split(" ")[0] ?? ""}`} />
        <EmptyState
          title="Nenhum período contábil selecionado"
          description="Crie um período em Períodos para começar a importar arquivos e gerar demonstrativos."
        />
      </>
    );
  }

  const cards = [
    {
      label: "Arquivos importados",
      value: summary.data?.files_count,
      icon: Upload,
    },
    {
      label: "Lançamentos no balancete",
      value: summary.data?.entries_count,
      icon: Table2,
    },
    {
      label: "Sugestões pendentes",
      value: summary.data?.pending_suggestions,
      icon: ListChecks,
    },
    {
      label: "Apontamentos abertos",
      value: summary.data?.open_findings,
      icon: AlertTriangle,
    },
    {
      label: "Demonstrativos gerados",
      value: summary.data?.statements_generated,
      icon: FileSpreadsheet,
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Período ${selectedPeriod?.label ?? ""} · última recálculo em ${formatDateTime(
          selectedPeriod?.last_recalculated_at,
        )}`}
        actions={
          selectedPeriod ? (
            <Badge variant="secondary">
              {PERIOD_STATUS_LABEL[
                selectedPeriod.status as keyof typeof PERIOD_STATUS_LABEL
              ] ?? selectedPeriod.status}
            </Badge>
          ) : null
        }
      />

      {summary.isError ? (
        <ErrorState
          message={(summary.error as Error)?.message}
          onRetry={() => void summary.refetch()}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.label}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">
                    {summary.isLoading ? "—" : (card.value ?? 0)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Atividade recente</CardTitle>
        </CardHeader>
        <CardContent>
          {activity.isLoading ? (
            <LoadingRows rows={3} />
          ) : (activity.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-border">
              {activity.data!.map((item) => {
                const actor = item.profiles as { full_name?: string } | null;
                return (
                  <li key={item.id} className="flex items-center justify-between gap-4 py-2.5">
                    <span className="text-sm">
                      <span className="font-medium">{actor?.full_name ?? "Sistema"}</span>{" "}
                      {item.action}{" "}
                      <span className="text-muted-foreground">({item.entity_type})</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
