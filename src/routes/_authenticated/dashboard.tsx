import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Banknote,
  FileSpreadsheet,
  ListChecks,
  Percent,
  RefreshCw,
  Table2,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { recalculateIndicators } from "@/lib/indicators.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { PERIOD_STATUS_LABEL, formatCurrency, formatDateTime } from "@/lib/rotta";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Dashboard | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Indicadores financeiros do período: margem bruta, EBITDA, resultado líquido, posição de caixa, sugestões pendentes e apontamentos abertos.",
      },
      { property: "og:title", content: "Dashboard | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Indicadores e gráficos do período contábil no ERP Financeiro Inteligente.",
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

type Indicator = {
  indicator_key: string;
  indicator_value: number;
  calculated_at: string;
  period_id: string;
};

const INDICATOR_META: Record<
  string,
  { label: string; icon: typeof Wallet; kind: "currency" | "percent" }
> = {
  receita_total: { label: "Receita total", icon: TrendingUp, kind: "currency" },
  custo_total: { label: "Custo total", icon: Banknote, kind: "currency" },
  margem_bruta: { label: "Margem bruta", icon: Percent, kind: "percent" },
  ebitda: { label: "EBITDA", icon: TrendingUp, kind: "currency" },
  resultado_liquido: { label: "Resultado líquido", icon: Wallet, kind: "currency" },
  posicao_caixa: { label: "Posição de caixa", icon: Wallet, kind: "currency" },
};

const INDICATOR_ORDER = [
  "receita_total",
  "custo_total",
  "margem_bruta",
  "ebitda",
  "resultado_liquido",
  "posicao_caixa",
];

function formatIndicator(key: string, value: number | undefined) {
  if (value === undefined) return "—";
  if (INDICATOR_META[key]?.kind === "percent") {
    return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  }
  return formatCurrency(value);
}

const compactCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

const chartConfig = {
  valor: { label: "Valor", color: "hsl(var(--chart-1, 220 70% 50%))" },
  resultado: { label: "Resultado líquido", color: "hsl(var(--chart-2, 160 60% 45%))" },
} satisfies ChartConfig;

function DashboardPage() {
  const {
    selectedPeriod,
    selectedPeriodId,
    periods,
    isLoading: loadingPeriods,
    error: periodsError,
    refetch: refetchPeriods,
  } = usePeriod();
  const { data: profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const recalc = useServerFn(recalculateIndicators);

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

  const indicators = useQuery({
    queryKey: ["dashboard-indicators"],
    queryFn: async (): Promise<Indicator[]> => {
      const { data, error } = await supabase
        .from("dashboard_indicators")
        .select("period_id, indicator_key, indicator_value, calculated_at");
      if (error) throw error;
      return (data ?? []) as Indicator[];
    },
  });

  const recalcMutation = useMutation({
    mutationFn: async () => recalc({ data: { period_id: selectedPeriodId! } }),
    onSuccess: () => {
      toast.success("Indicadores recalculados a partir do balancete do período.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard-indicators"] });
      void queryClient.invalidateQueries({ queryKey: ["accounting_periods"] });
    },
    onError: (error: Error) => toast.error(error.message),
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

  const currentIndicators = new Map<string, Indicator>(
    (indicators.data ?? [])
      .filter((i) => i.period_id === selectedPeriodId)
      .map((i) => [i.indicator_key, { ...i, indicator_value: Number(i.indicator_value) }]),
  );
  const hasIndicators = currentIndicators.size > 0;

  const compositionData = [
    { nome: "Receita", valor: Number(currentIndicators.get("receita_total")?.indicator_value ?? 0) },
    { nome: "Custo", valor: Number(currentIndicators.get("custo_total")?.indicator_value ?? 0) },
    { nome: "EBITDA", valor: Number(currentIndicators.get("ebitda")?.indicator_value ?? 0) },
    {
      nome: "Resultado",
      valor: Number(currentIndicators.get("resultado_liquido")?.indicator_value ?? 0),
    },
    { nome: "Caixa", valor: Number(currentIndicators.get("posicao_caixa")?.indicator_value ?? 0) },
  ];

  const historyData = [...periods]
    .sort((a, b) => a.reference_month.localeCompare(b.reference_month))
    .map((p) => {
      const rows = (indicators.data ?? []).filter((i) => i.period_id === p.id);
      const get = (key: string) =>
        Number(rows.find((i) => i.indicator_key === key)?.indicator_value ?? 0);
      return {
        periodo: p.label,
        receita: get("receita_total"),
        custo: get("custo_total"),
        resultado: get("resultado_liquido"),
      };
    })
    .filter((row) => row.receita || row.custo || row.resultado);

  const counters = [
    { label: "Arquivos importados", value: summary.data?.files_count, icon: Upload },
    { label: "Lançamentos no balancete", value: summary.data?.entries_count, icon: Table2 },
    { label: "Sugestões pendentes", value: summary.data?.pending_suggestions, icon: ListChecks },
    { label: "Apontamentos abertos", value: summary.data?.open_findings, icon: AlertTriangle },
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
        description={`Período ${selectedPeriod?.label ?? ""} · último recálculo em ${formatDateTime(
          selectedPeriod?.last_recalculated_at,
        )}`}
        actions={
          <div className="flex items-center gap-2">
            {selectedPeriod ? (
              <Badge variant="secondary">
                {PERIOD_STATUS_LABEL[
                  selectedPeriod.status as keyof typeof PERIOD_STATUS_LABEL
                ] ?? selectedPeriod.status}
              </Badge>
            ) : null}
            {isAdmin ? (
              <Button
                size="sm"
                variant="outline"
                disabled={recalcMutation.isPending}
                onClick={() => recalcMutation.mutate()}
              >
                <RefreshCw
                  className={`size-4 ${recalcMutation.isPending ? "animate-spin" : ""}`}
                />
                Recalcular indicadores
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Indicadores financeiros */}
      {indicators.isError ? (
        <ErrorState
          message={(indicators.error as Error)?.message}
          onRetry={() => void indicators.refetch()}
        />
      ) : indicators.isLoading ? (
        <LoadingRows rows={2} />
      ) : !hasIndicators ? (
        <EmptyState
          title="Nenhum indicador calculado para este período"
          description={
            isAdmin
              ? "Use “Recalcular indicadores” para gerar os números a partir dos lançamentos classificados do balancete."
              : "Peça a um administrador para recalcular os indicadores deste período."
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {INDICATOR_ORDER.map((key) => {
            const meta = INDICATOR_META[key]!;
            const Icon = meta.icon;
            const value = currentIndicators.get(key)?.indicator_value;
            return (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {meta.label}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatIndicator(key, value)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(currentIndicators.get(key)?.calculated_at)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {hasIndicators ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Composição do resultado · {selectedPeriod?.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[280px] w-full">
                <BarChart data={compositionData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="nome" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={compactCurrency} tickLine={false} axisLine={false} width={60} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent formatter={(v) => formatCurrency(Number(v))} />
                    }
                  />
                  <Bar dataKey="valor" fill="var(--color-valor)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução por período</CardTitle>
            </CardHeader>
            <CardContent>
              {historyData.length < 2 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  A evolução aparece quando houver indicadores calculados em pelo menos dois
                  períodos.
                </p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <LineChart data={historyData}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="periodo" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={compactCurrency} tickLine={false} axisLine={false} width={60} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent formatter={(v) => formatCurrency(Number(v))} />
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="resultado"
                      stroke="var(--color-resultado)"
                      strokeWidth={2}
                      dot
                    />
                    <Line
                      type="monotone"
                      dataKey="receita"
                      stroke="var(--color-valor)"
                      strokeWidth={2}
                      dot
                    />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Contagens operacionais (RPC get_period_summary) */}
      {summary.isError ? (
        <div className="mt-6">
          <ErrorState
            message={(summary.error as Error)?.message}
            onRetry={() => void summary.refetch()}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {counters.map((card) => {
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
