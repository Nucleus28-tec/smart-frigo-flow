import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/PageState";
import { SemMovimento } from "@/components/periodo/SemMovimento";
import { usePeriodStatus } from "@/hooks/usePeriodStatus";
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
import { LinhaHierarquica } from "@/components/demonstrativos/LinhaHierarquica";
import { ContasOcultasPainel } from "@/components/demonstrativos/ContasOcultasPainel";

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
  periodId,
  onDrill,
  canEdit,
  expanded,
  onToggleExpand,
  openLines,
  onLineOpenChange,
}: {
  statement: Statement;
  periodId: string;
  onDrill: (codes: string[], label: string, base?: string) => void;
  canEdit: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  openLines: Set<string>;
  onLineOpenChange: (key: string, open: boolean) => void;
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
          <div className="flex shrink-0 items-center gap-2">
            {fonte ? (
              <Badge variant={fonte === "razao" ? "default" : "secondary"}>
                Fonte: {fonte === "razao" ? "razão" : "balancete"}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={expanded ? "Voltar à visão em três colunas" : "Expandir em tela cheia"}
              onClick={onToggleExpand}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {base ? (
          <p className="text-xs text-muted-foreground">Base de cálculo: {BASE_LABEL[base] ?? base}.</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1">
        {lines.map((line, index) => {
          const isTotal = line.kind === "total" || line.kind === "subtotal";
          const canDrill = (line.codes?.length ?? 0) > 0;
          const lineKey = `${statement.statement_type}-${index}`;
          return canDrill ? (
            <LinhaHierarquica
              key={`${line.label}-${index}`}
              periodId={periodId}
              line={{ ...line, ...(line.base ?? base ? { base: line.base ?? base } : {}) }}
              onOpen={onDrill}
              canEdit={canEdit}
              large={expanded}
              open={openLines.has(lineKey)}
              onOpenChange={(value) => onLineOpenChange(lineKey, value)}
            />
          ) : (
            <div
              key={`${line.label}-${index}`}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                isTotal ? "bg-muted font-semibold" : "text-muted-foreground"
              }`}
            >
              <span className="text-left">{line.label}</span>
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
  const { selectedPeriod } = usePeriod();
  const { data: profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const periodId = selectedPeriod?.id ?? null;
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [drill, setDrill] = useState<LinhaDrill | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openLines, setOpenLines] = useState<Set<string>>(() => new Set());
  const getHidden = useServerFn(getHiddenSummary);

  /** Guarda quais linhas estão abertas para não perder a navegação ao expandir. */
  function handleLineOpenChange(key: string, open: boolean) {
    setOpenLines((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }


  const hiddenQuery = useQuery({
    queryKey: ["hidden_summary", periodId],
    enabled: !!periodId,
    queryFn: async () => getHidden({ data: { period_id: periodId! } }),
  });

  /** Intervalo do período selecionado (primeiro ao último dia). */
  function periodRange() {
    const ref = selectedPeriod?.reference_month?.slice(0, 10) ?? null;
    if (!ref) return { from: null as string | null, to: null as string | null };
    const y = Number(ref.slice(0, 4));
    const m = Number(ref.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      from: `${ref.slice(0, 8)}01`,
      to: `${ref.slice(0, 8)}${String(last).padStart(2, "0")}`,
    };
  }

  /** Abre o painel lateral com os lançamentos das contas clicadas. */
  function handleDrill(codes: string[], label: string, base?: string) {
    if (codes.length === 0) return;
    const { from, to } = periodRange();
    setDrill({
      label,
      codes,
      from,
      to,
      kind: base === "saldo" ? "balancete" : "razao",
    });
  }


  /** Abre a mesma seleção no razão, em outra aba. */
  function openRazao(current: LinhaDrill) {
    const params = new URLSearchParams({
      tab: "relatorios",
      codes: current.codes.join(","),
      kind: current.kind,
      dl: `${Date.now()}`,
    });
    if (current.from) params.set("de", current.from);
    if (current.to) params.set("ate", current.to);
    window.open(`/razao?${params.toString()}`, "_blank", "noopener");
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

          {(hiddenQuery.data?.count ?? 0) > 0 || (hiddenQuery.data?.accounts ?? 0) > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm">
              <EyeOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span>
                {hiddenQuery.data?.count ?? 0} lançamento(s) ocultos (
                {formatCurrency(hiddenQuery.data?.total ?? 0)}) e{" "}
                {hiddenQuery.data?.accounts ?? 0} conta(s) oculta(s) com abertura de{" "}
                <strong className="tabular-nums">
                  {formatCurrency(hiddenQuery.data?.opening_total ?? 0)}
                </strong>{" "}
                fora de DRE, Balanço, Fluxo e indicadores.
              </span>
            </div>
          ) : null}

          <ContasOcultasPainel periodId={periodId} canEdit={isAdmin} />




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
            <div className={expanded ? "space-y-4" : "grid gap-4 lg:grid-cols-3"}>
              {(statementsQuery.data ?? [])
                .filter((statement) => !expanded || statement.statement_type === expanded)
                .map((statement) => (
                  <StatementCard
                    key={statement.statement_type}
                    statement={statement}
                    periodId={periodId}
                    onDrill={handleDrill}
                    canEdit={isAdmin}
                    expanded={expanded === statement.statement_type}
                    onToggleExpand={() =>
                      setExpanded((current) =>
                        current === statement.statement_type ? null : statement.statement_type,
                      )
                    }
                    openLines={openLines}
                    onLineOpenChange={handleLineOpenChange}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {periodId ? (
        <PainelLancamentosLinha
          periodId={periodId}
          drill={drill}
          canEdit={isAdmin}
          onClose={() => setDrill(null)}
          onOpenRazao={openRazao}
        />
      ) : null}
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
