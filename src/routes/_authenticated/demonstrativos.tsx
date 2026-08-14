import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { usePeriodContext } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { exportReport, generateStatements } from "@/lib/reports.functions";
import { formatCurrency } from "@/lib/rotta";

type Line = { label: string; value: number; kind?: string };
type Statement = {
  statement_type: string;
  content: { titulo?: string; linhas?: Line[] };
  generated_at: string;
};

const TITLES: Record<string, string> = {
  dre: "DRE — Demonstração do Resultado",
  balanco_patrimonial: "Balanço Patrimonial",
  fluxo_de_caixa: "Fluxo de Caixa",
};
const ORDER = ["dre", "balanco_patrimonial", "fluxo_de_caixa"];

function StatementCard({ statement }: { statement: Statement }) {
  const lines = statement.content?.linhas ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {TITLES[statement.statement_type] ?? statement.statement_type}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {lines.map((line, index) => {
          const isTotal = line.kind === "total" || line.kind === "subtotal";
          return (
            <div
              key={`${line.label}-${index}`}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                isTotal ? "bg-muted font-semibold" : "text-muted-foreground"
              }`}
            >
              <span>{line.label}</span>
              <span
                className={
                  Number(line.value) < 0 ? "text-destructive tabular-nums" : "tabular-nums"
                }
              >
                {formatCurrency(line.value)}
              </span>
            </div>
          );
        })}
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem linhas para este demonstrativo.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DemonstrativosPage() {
  const { selectedPeriod } = usePeriodContext();
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const periodId = selectedPeriod?.id ?? null;
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  const generate = useServerFn(generateStatements);
  const doExport = useServerFn(exportReport);

  const statementsQuery = useQuery({
    queryKey: ["financial_statements", periodId],
    enabled: !!periodId,
    queryFn: async (): Promise<Statement[]> => {
      const { data, error } = await supabase
        .from("financial_statements")
        .select("statement_type, content, generated_at")
        .eq("period_id", periodId!);
      if (error) throw error;
      return ((data ?? []) as unknown as Statement[]).sort(
        (a, b) => ORDER.indexOf(a.statement_type) - ORDER.indexOf(b.statement_type),
      );
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => generate({ data: { period_id: periodId! } }),
    onSuccess: () => {
      toast.success("Demonstrativos gerados a partir do balancete do período.");
      queryClient.invalidateQueries({ queryKey: ["financial_statements", periodId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleExport(format: "pdf" | "xlsx") {
    if (!periodId) return;
    setBusy(format);
    try {
      const result = await doExport({ data: { period_id: periodId, format } });
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(`Download iniciado: ${result.file_name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Demonstrativos"
        description="DRE, Balanço Patrimonial e Fluxo de Caixa gerados a partir do balancete do período."
      />

      {!periodId ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Selecione um período contábil para visualizar os demonstrativos.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              <Button
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {generateMutation.isPending ? "Gerando..." : "Gerar demonstrativos"}
              </Button>
            ) : null}
            <Button onClick={() => handleExport("pdf")} disabled={busy !== null}>
              <FileText className="mr-2 h-4 w-4" />
              {busy === "pdf" ? "Gerando PDF..." : "Exportar PDF"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExport("xlsx")}
              disabled={busy !== null}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {busy === "xlsx" ? "Gerando Excel..." : "Exportar Excel"}
            </Button>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Download className="h-3 w-3" /> Arquivos salvos no bucket privado “exports”.
            </span>
          </div>

          {statementsQuery.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : (statementsQuery.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhum demonstrativo gerado para {selectedPeriod?.label}.{" "}
                {isAdmin
                  ? "Use “Gerar demonstrativos” para calcular a partir do balancete."
                  : "Peça a um administrador para gerar os demonstrativos."}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {(statementsQuery.data ?? []).map((statement) => (
                <StatementCard key={statement.statement_type} statement={statement} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/demonstrativos")({
  component: DemonstrativosPage,
  head: () => ({
    meta: [
      { title: "Demonstrativos | Rotta Financeiro" },
      {
        name: "description",
        content:
          "DRE, Balanço Patrimonial e Fluxo de Caixa do período, com exportação em PDF e Excel.",
      },
      { property: "og:title", content: "Demonstrativos | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Demonstrativos contábeis do período com exportação em PDF e Excel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
