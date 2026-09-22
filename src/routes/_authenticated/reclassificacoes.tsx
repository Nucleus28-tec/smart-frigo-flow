import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Lock, Sparkles, X } from "lucide-react";

import { useProfile } from "@/hooks/useProfile";
import { usePeriod } from "@/hooks/usePeriod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { NATURE_LABEL } from "@/lib/rotta";
import {
  analyzeChartWithAi,
  decideChartSuggestions,
  listChartSuggestions,
  type ChartSuggestionRow,
} from "@/lib/razao.functions";
import { PendenciasPlanoContas } from "@/components/PendenciasPlanoContas";

export const Route = createFileRoute("/_authenticated/reclassificacoes")({
  component: ReclassificacoesPage,
  head: () => ({
    meta: [
      { title: "Reclassificações | Rotta Financeiro" },
      {
        name: "description",
        content: "Sugestões de reclassificação do razão contábil com aprovação humana obrigatória.",
      },
      { property: "og:title", content: "Reclassificações | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Fila de sugestões de reclassificação do razão contábil no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aplicada: "Aplicada",
  rejeitada: "Rejeitada",
};

const KIND_LABEL: Record<string, string> = {
  mover: "Mover de grupo",
  natureza: "Trocar natureza",
  tipo_conta: "Analítica / sintética",
};

function describeValue(kind: string, value: string | null) {
  if (!value) return "—";
  if (kind === "natureza") return NATURE_LABEL[value] ?? value;
  if (kind === "tipo_conta") return value === "true" ? "Analítica" : "Sintética";
  return value;
}

function ReclassificacoesPage() {
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { selectedPeriodId } = usePeriod();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const [status, setStatus] = useState("pendente");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const listSuggestions = useServerFn(listChartSuggestions);
  const analyze = useServerFn(analyzeChartWithAi);
  const decide = useServerFn(decideChartSuggestions);

  const suggestions = useQuery({
    queryKey: ["chart_ai_suggestions", status],
    queryFn: async (): Promise<ChartSuggestionRow[]> =>
      listSuggestions({ data: { status } }),
  });

  const generateMutation = useMutation({
    mutationFn: () => analyze({ data: { ids: [], limit: 60 } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["chart_ai_suggestions"] });
      if (result.created === 0) {
        toast.info("A IA não encontrou ajustes a propor nas contas analisadas.");
      } else {
        toast.success(`${result.created} sugestão(ões) gerada(s) para revisão.`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function runDecision(ids: string[], decision: "aplicada" | "rejeitada") {
    if (!ids.length) return;
    setBusy(true);
    try {
      const result = await decide({ data: { ids, decision } });
      setSelected((prev) => prev.filter((id) => !ids.includes(id)));
      void queryClient.invalidateQueries({ queryKey: ["chart_ai_suggestions"] });
      void queryClient.invalidateQueries({ queryKey: ["chart_accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger_accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["demonstrativos"] });
      if (result.failures.length) {
        toast.warning(
          `${result.decided} aplicada(s); ${result.failures.length} falhou(aram): ${result.failures[0]?.message ?? ""}`,
        );
      } else {
        toast.success(
          decision === "aplicada"
            ? `${result.decided} sugestão(ões) aplicada(s) no plano do razão.`
            : `${result.decided} sugestão(ões) rejeitada(s).`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar a decisão.");
    } finally {
      setBusy(false);
    }
  }

  const rows = suggestions.data ?? [];
  const pendingIds = useMemo(
    () => rows.filter((r) => r.status === "pendente").map((r) => r.id),
    [rows],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedPending = pendingIds.filter((id) => selectedSet.has(id));
  const allSelected = pendingIds.length > 0 && selectedPending.length === pendingIds.length;

  return (
    <>
      <PageHeader
        title="Reclassificações"
        description="Sugestões da IA sobre o plano de contas do razão, com aprovação humana obrigatória."
      />

      <PendenciasPlanoContas periodId={selectedPeriodId} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="aplicada">Aplicadas</SelectItem>
            <SelectItem value="rejeitada">Rejeitadas</SelectItem>
          </SelectContent>
        </Select>

        {isAdmin ? (
          <Button
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Analisar com IA
          </Button>
        ) : null}

        {status === "pendente" && pendingIds.length > 0 ? (
          <Badge variant="secondary">{pendingIds.length} aguardando decisão</Badge>
        ) : null}
      </div>

      {isAdmin && selectedPending.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <span className="text-sm font-medium">{selectedPending.length} selecionada(s)</span>
          <Button size="sm" disabled={busy} onClick={() => void runDecision(selectedPending, "aplicada")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Aplicar selecionadas
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void runDecision(selectedPending, "rejeitada")}
          >
            <X className="size-4" />
            Rejeitar selecionadas
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected([])}>
            Limpar seleção
          </Button>
        </div>
      ) : null}

      {profileLoading || isAdmin ? null : (
        <Alert className="mb-4">
          <Lock className="size-4" />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            A aprovação e a rejeição de reclassificações são restritas ao Admin.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {suggestions.isLoading ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : suggestions.isError ? (
            <div className="p-4">
              <ErrorState
                message={(suggestions.error as Error).message}
                onRetry={() => void suggestions.refetch()}
              />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nenhuma sugestão nesta fila"
              description={
                isAdmin
                  ? "Use “Analisar com IA” para revisar o plano de contas do razão e propor ajustes de grupo, natureza e tipo de conta."
                  : "Assim que o Admin gerar as sugestões da IA, elas aparecerão aqui."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin ? (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        disabled={pendingIds.length === 0 || busy}
                        onCheckedChange={(v) => setSelected(v === true ? pendingIds : [])}
                        aria-label="Selecionar todas as pendentes"
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo de ajuste</TableHead>
                  <TableHead>Hoje</TableHead>
                  <TableHead>Sugestão</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead>Justificativa</TableHead>
                  <TableHead className="text-right">Decisão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    {isAdmin ? (
                      <TableCell>
                        {row.status === "pendente" ? (
                          <Checkbox
                            checked={selectedSet.has(row.id)}
                            disabled={busy}
                            onCheckedChange={(v) =>
                              setSelected((prev) =>
                                v === true ? [...prev, row.id] : prev.filter((x) => x !== row.id),
                              )
                            }
                            aria-label="Selecionar sugestão"
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">
                      {row.account_name}
                      <span className="ml-2 text-xs text-muted-foreground">{row.reduced_code}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{KIND_LABEL[row.kind] ?? row.kind}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {describeValue(row.kind, row.current_value)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {describeValue(row.kind, row.suggested_value)}
                      </Badge>
                    </TableCell>
                    <TableCell>{Math.round(Number(row.confidence) * 100)}%</TableCell>
                    <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                      {row.reasoning}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status !== "pendente" ? (
                        <Badge variant={row.status === "aplicada" ? "default" : "secondary"}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </Badge>
                      ) : isAdmin ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void runDecision([row.id], "aplicada")}
                          >
                            <Check className="size-4" />
                            Aplicar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void runDecision([row.id], "rejeitada")}
                          >
                            <X className="size-4" />
                            Rejeitar
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="secondary">Pendente</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
