import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Download, EyeOff, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { exportReport, generateStatements } from "@/lib/reports.functions";
import { getHiddenSummary } from "@/lib/razao.functions";
import { formatCurrency } from "@/lib/rotta";
import { ConferenciaBalanco } from "@/components/ConferenciaBalanco";
import {
  PainelLancamentosLinha,
  type LinhaDrill,
} from "@/components/razao/PainelLancamentosLinha";


type Line = {
  label: string;
  value: number;
  kind?: string;
  nature?: string;
  base?: string;
  codes?: string[];
};
type Statement = {
  statement_type: string;
  content: { titulo?: string; linhas?: Line[]; fonte?: string; base?: string };
  generated_at: string;
};

const BASE_LABEL: Record<string, string> = {
  movimento: "movimento do período (sem encerramento)",
  saldo: "saldo da conta",
  variacao_caixa: "variação das contas de caixa/banco/aplicação",
};

const TITLES: Record<string, string> = {
  dre: "DRE — Demonstração do Resultado",
  balanco_patrimonial: "Balanço Patrimonial",
  fluxo_de_caixa: "Fluxo de Caixa",
};
const ORDER = ["dre", "balanco_patrimonial", "fluxo_de_caixa"];

function StatementCard({
  statement,
  onDrill,
}: {
  statement: Statement;
  onDrill: (line: Line) => void;
}) {
  const lines = statement.content?.linhas ?? [];
  const fonte = statement.content?.fonte;
  const base = statement.content?.base;
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">
            {TITLES[statement.statement_type] ?? statement.statement_type}
          </CardTitle>
          {fonte ? (
            <Badge variant={fonte === "razao" ? "default" : "secondary"} className="shrink-0">
              Fonte: {fonte === "razao" ? "razão" : "balancete"}
            </Badge>
          ) : null}
        </div>
        {base ? (
          <p className="text-xs text-muted-foreground">Base de cálculo: {BASE_LABEL[base] ?? base}.</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1">
        {lines.map((line, index) => {
          const isTotal = line.kind === "total" || line.kind === "subtotal";
          const canDrill = (line.codes?.length ?? 0) > 0;
          const content = (
            <>
              <span className="flex items-center gap-1 text-left">
                {line.label}
                {canDrill ? (
                  <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
                ) : null}
              </span>
              <span
                className={
                  Number(line.value) < 0 ? "text-destructive tabular-nums" : "tabular-nums"
                }
              >
                {formatCurrency(line.value)}
              </span>
            </>
          );
          const className = `flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
            isTotal ? "bg-muted font-semibold" : "text-muted-foreground"
          }`;
          return canDrill ? (
            <button
              key={`${line.label}-${index}`}
              type="button"
              onClick={() => onDrill(line)}
              title={`Ver os lançamentos que compõem “${line.label}” no razão`}
              className={`${className} group cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground`}
            >
              {content}
            </button>
          ) : (
            <div key={`${line.label}-${index}`} className={className}>
              {content}
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
  const { selectedPeriod } = usePeriod();
  const { data: profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const periodId = selectedPeriod?.id ?? null;
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const navigate = useNavigate();

  /** Abre no /razao os lançamentos que compõem a linha clicada. */
  function handleDrill(line: Line) {
    const codes = line.codes ?? [];
    if (codes.length === 0) return;
    const ref = selectedPeriod?.reference_month?.slice(0, 10) ?? null;
    const search: Record<string, string> = {
      tab: "relatorios",
      codes: codes.join(","),
      kind: line.base === "saldo" ? "balancete" : "razao",
      dl: `${Date.now()}`,
    };
    if (ref) {
      const y = Number(ref.slice(0, 4));
      const m = Number(ref.slice(5, 7));
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      search["de"] = `${ref.slice(0, 8)}01`;
      search["ate"] = `${ref.slice(0, 8)}${String(last).padStart(2, "0")}`;
    }
    void navigate({ to: "/razao", search });
  }

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
      toast.success("Demonstrativos gerados a partir do razão contábil do período.");
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
        description="DRE, Balanço e Fluxo de Caixa derivados do razão contábil. Clique em uma linha para ver os lançamentos que a compõem."
      />

      {!periodId ? (
        <EmptyState
          title="Nenhum período selecionado"
          description="Escolha um período contábil no topo da tela para visualizar DRE, Balanço e Fluxo de Caixa."
        />
      ) : (
        <div className="space-y-6">
          <ConferenciaBalanco periodId={periodId} />

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
          ) : statementsQuery.isError ? (
            <ErrorState
              message={(statementsQuery.error as Error)?.message}
              onRetry={() => void statementsQuery.refetch()}
            />
          ) : (statementsQuery.data ?? []).length === 0 ? (
            <EmptyState
              title="Demonstrativos ainda não gerados"
              description={
                isAdmin
                  ? `Nenhum demonstrativo em ${selectedPeriod?.label ?? "este período"}. Importe o balancete na tela Importar e use “Gerar demonstrativos”.`
                  : `Nenhum demonstrativo em ${selectedPeriod?.label ?? "este período"}. Peça a um administrador para gerá-los.`
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {(statementsQuery.data ?? []).map((statement) => (
                <StatementCard
                  key={statement.statement_type}
                  statement={statement}
                  onDrill={handleDrill}
                />
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
