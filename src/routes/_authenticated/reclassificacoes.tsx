import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Lock, Sparkles, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { usePeriod } from "@/hooks/usePeriod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  applyReclassificationDecision,
  suggestReclassifications,
} from "@/lib/reclass.functions";

export const Route = createFileRoute("/_authenticated/reclassificacoes")({
  component: ReclassificacoesPage,
  head: () => ({
    meta: [
      { title: "Reclassificações | Rotta Financeiro" },
      {
        name: "description",
        content: "Sugestões de reclassificação contábil com aprovação humana obrigatória.",
      },
      { property: "og:title", content: "Reclassificações | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Fila de sugestões de reclassificação contábil do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Suggestion = {
  id: string;
  account_id: string | null;
  current_nature: string | null;
  suggested_nature: string;
  reasoning: string | null;
  confidence_score: number | null;
  status: string;
  decided_at: string | null;
  created_at: string;
  chart_of_accounts: { source_code: string | null; source_name: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
};

function natureLabel(value: string | null) {
  if (!value) return "Sem natureza";
  return NATURE_LABEL[value as keyof typeof NATURE_LABEL] ?? value;
}

function ReclassificacoesPage() {
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { selectedPeriodId } = usePeriod();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const [status, setStatus] = useState("pendente");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);

  const generate = useServerFn(suggestReclassifications);
  const decide = useServerFn(applyReclassificationDecision);

  const suggestions = useQuery({
    queryKey: ["reclassification_suggestions", selectedPeriodId, status],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<Suggestion[]> => {
      let query = supabase
        .from("reclassification_suggestions")
        .select(
          "id, account_id, current_nature, suggested_nature, reasoning, confidence_score, status, decided_at, created_at, chart_of_accounts(source_code, source_name)",
        )
        .eq("period_id", selectedPeriodId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (status !== "todas") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Suggestion[];
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => generate({ data: { period_id: selectedPeriodId! } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["reclassification_suggestions"] });
      if (result.created === 0) {
        toast.info("Nenhuma conta pendente sem sugestão neste período.");
      } else {
        toast.success(`${result.created} sugestão(ões) gerada(s) para revisão.`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const decisionMutation = useMutation({
    mutationFn: (vars: { suggestion_id: string; decision: "aprovada" | "rejeitada" }) =>
      decide({ data: vars }),
    onMutate: (vars) => setBusyId(vars.suggestion_id),
    onSettled: () => setBusyId(null),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["reclassification_suggestions"] });
      void queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger_entries"] });
      toast.success(
        result.decision === "aprovada"
          ? `Sugestão aprovada. ${result.entries_updated} lançamento(s) atualizado(s).`
          : "Sugestão rejeitada. Nada foi alterado.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = suggestions.data ?? [];
  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "pendente").length,
    [rows],
  );
  const pendingIds = useMemo(
    () => rows.filter((r) => r.status === "pendente").map((r) => r.id),
    [rows],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedPending = pendingIds.filter((id) => selectedSet.has(id));
  const allSelected = pendingIds.length > 0 && selectedPending.length === pendingIds.length;

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? pendingIds : []);
  }

  async function runBulk(decision: "aprovada" | "rejeitada") {
    const ids = selectedPending;
    if (!ids.length) return;
    setBulk({ done: 0, total: ids.length });
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await decide({ data: { suggestion_id: id, decision } });
        ok += 1;
      } catch {
        failed += 1;
      }
      setBulk((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }
    setBulk(null);
    setSelected([]);
    void queryClient.invalidateQueries({ queryKey: ["reclassification_suggestions"] });
    void queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["ledger_entries"] });
    if (failed) {
      toast.warning(
        `${ok} sugestão(ões) processada(s), ${failed} falhou(aram).`,
      );
    } else {
      toast.success(
        decision === "aprovada"
          ? `${ok} sugestão(ões) aprovada(s).`
          : `${ok} sugestão(ões) rejeitada(s).`,
      );
    }
  }


  return (
    <>
      <PageHeader
        title="Reclassificações"
        description="Sugestões da IA para classificar contas, com aprovação humana obrigatória."
      />

      {!selectedPeriodId ? (
        <EmptyState
          title="Selecione um período"
          description="Escolha um período contábil para ver as sugestões de reclassificação."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pendente">Pendentes</SelectItem>
                <SelectItem value="aprovada">Aprovadas</SelectItem>
                <SelectItem value="rejeitada">Rejeitadas</SelectItem>
                <SelectItem value="todas">Todas</SelectItem>
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
                Gerar sugestões
              </Button>
            ) : null}

            {status === "pendente" && pendingCount > 0 ? (
              <Badge variant="secondary">{pendingCount} aguardando decisão</Badge>
            ) : null}
          </div>

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
                  title="Nenhuma sugestão pendente"
                  description={
                    isAdmin
                      ? "Importe o balancete na tela Importar e use “Gerar sugestões” para classificar as contas sem natureza confirmada."
                      : "Assim que o Admin gerar as sugestões da IA, elas aparecerão aqui."
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Conta</TableHead>
                      <TableHead>Natureza atual</TableHead>
                      <TableHead>Sugestão</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Justificativa</TableHead>
                      <TableHead className="text-right">Decisão</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.chart_of_accounts?.source_name ?? "Conta removida"}
                          {row.chart_of_accounts?.source_code ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {row.chart_of_accounts.source_code}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {natureLabel(row.current_nature)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{natureLabel(row.suggested_nature)}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.confidence_score == null
                            ? "—"
                            : `${Math.round(Number(row.confidence_score) * 100)}%`}
                        </TableCell>
                        <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                          {row.reasoning ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.status !== "pendente" ? (
                            <Badge
                              variant={row.status === "aprovada" ? "default" : "secondary"}
                            >
                              {STATUS_LABEL[row.status] ?? row.status}
                            </Badge>
                          ) : isAdmin ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={() =>
                                  decisionMutation.mutate({
                                    suggestion_id: row.id,
                                    decision: "aprovada",
                                  })
                                }
                              >
                                {busyId === row.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Check className="size-4" />
                                )}
                                Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === row.id}
                                onClick={() =>
                                  decisionMutation.mutate({
                                    suggestion_id: row.id,
                                    decision: "rejeitada",
                                  })
                                }
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
      )}
    </>
  );
}
