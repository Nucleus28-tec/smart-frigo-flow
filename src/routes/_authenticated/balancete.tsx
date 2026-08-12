import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Undo2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { NATURE_LABEL, NATURE_OPTIONS, formatCurrency, parseCurrencyInput } from "@/lib/rotta";
import { revertLedgerEntry, updateLedgerEntry } from "@/lib/ledger.functions";

export const Route = createFileRoute("/_authenticated/balancete")({
  component: BalancetePage,
  head: () => ({
    meta: [
      { title: "Balancete | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Tabela editável dos lançamentos do período: revise valores, ajuste naturezas e acompanhe edições manuais.",
      },
      { property: "og:title", content: "Balancete | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Revisão dos lançamentos contábeis do período no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Entry = {
  id: string;
  file_id: string;
  account_id: string | null;
  source_account_name: string;
  raw_value: number;
  reviewed_value: number | null;
  nature: string | null;
  is_manually_edited: boolean;
  entry_date: string | null;
};

function appliedValue(entry: Entry) {
  return entry.reviewed_value ?? entry.raw_value;
}

function BalancetePage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [natureFilter, setNatureFilter] = useState("todas");
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");

  const isClosed = selectedPeriod?.status === "fechado";
  const saveEntry = useServerFn(updateLedgerEntry);
  const revertEntry = useServerFn(revertLedgerEntry);

  const entries = useQuery({
    queryKey: ["ledger_entries", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<Entry[]> => {
      const { data, error } = await supabase
        .from("ledger_entries")
        .select(
          "id, file_id, account_id, source_account_name, raw_value, reviewed_value, nature, is_manually_edited, entry_date",
        )
        .eq("period_id", selectedPeriodId!)
        .order("source_account_name", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["ledger_entries", selectedPeriodId] });
  };

  const updateMutation = useMutation({
    mutationFn: (vars: { entry_id: string; reviewed_value?: number | null; nature?: string }) =>
      saveEntry({
        data: {
          entry_id: vars.entry_id,
          ...(vars.reviewed_value !== undefined ? { reviewed_value: vars.reviewed_value } : {}),
          ...(vars.nature !== undefined ? { nature: vars.nature as never } : {}),
        },
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast.success("Lançamento atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revertMutation = useMutation({
    mutationFn: (entryId: string) => revertEntry({ data: { entry_id: entryId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Edição manual revertida.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const list = entries.data ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((entry) => {
      if (onlyEdited && !entry.is_manually_edited) return false;
      if (natureFilter === "sem_natureza" && entry.nature) return false;
      if (
        natureFilter !== "todas" &&
        natureFilter !== "sem_natureza" &&
        entry.nature !== natureFilter
      ) {
        return false;
      }
      if (!term) return true;
      return entry.source_account_name.toLowerCase().includes(term);
    });
  }, [entries.data, search, natureFilter, onlyEdited]);

  const totals = useMemo(() => {
    const byNature = new Map<string, number>();
    let total = 0;
    for (const entry of rows) {
      const value = appliedValue(entry);
      total += Number(value);
      const key = entry.nature ?? "sem_natureza";
      byNature.set(key, (byNature.get(key) ?? 0) + Number(value));
    }
    return { byNature: Array.from(byNature.entries()), total };
  }, [rows]);

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraftValue(String(appliedValue(entry)).replace(".", ","));
  }

  function commitEdit(entry: Entry) {
    const parsed = parseCurrencyInput(draftValue);
    if (parsed === null) {
      toast.error("Informe um valor válido, ex.: 1.234,56 ou -1234,56.");
      return;
    }
    updateMutation.mutate({ entry_id: entry.id, reviewed_value: parsed });
  }

  if (!selectedPeriodId) {
    return (
      <>
        <PageHeader
          title="Balancete"
          description="Lançamentos do período com valores revisados e naturezas contábeis."
        />
        <EmptyState
          title="Selecione um período"
          description="Escolha um período contábil no cabeçalho para revisar os lançamentos."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Balancete"
        description={`Lançamentos de ${selectedPeriod?.label ?? ""}. O valor revisado prevalece sobre o valor bruto importado.`}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar conta"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <Select value={natureFilter} onValueChange={setNatureFilter}>
          <SelectTrigger className="sm:w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as naturezas</SelectItem>
            <SelectItem value="sem_natureza">Sem natureza</SelectItem>
            {NATURE_OPTIONS.map((nature) => (
              <SelectItem key={nature} value={nature}>
                {NATURE_LABEL[nature]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Checkbox
            id="somente-editados"
            checked={onlyEdited}
            onCheckedChange={(checked) => setOnlyEdited(checked === true)}
          />
          <Label htmlFor="somente-editados" className="text-sm font-normal">
            Somente editados
          </Label>
        </div>
      </div>

      {isClosed ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Período fechado: os lançamentos estão em modo somente leitura.
        </p>
      ) : null}

      {entries.isLoading ? (
        <LoadingRows />
      ) : entries.isError ? (
        <ErrorState
          message={(entries.error as Error)?.message}
          onRetry={() => void entries.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum lançamento"
          description={
            (entries.data ?? []).length === 0
              ? "Importe o balancete do período na tela Importar."
              : "Ajuste os filtros para ver outros lançamentos."
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead className="w-[230px]">Natureza</TableHead>
                    <TableHead className="text-right">Valor bruto</TableHead>
                    <TableHead className="w-[220px] text-right">Valor revisado</TableHead>
                    <TableHead className="text-right">Valor aplicado</TableHead>
                    <TableHead className="w-[110px] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry) => {
                    const editing = editingId === entry.id;
                    return (
                      <TableRow
                        key={entry.id}
                        className={
                          entry.is_manually_edited ? "bg-amber-500/10 hover:bg-amber-500/15" : ""
                        }
                      >
                        <TableCell className="font-medium">
                          <span className="block">{entry.source_account_name}</span>
                          {entry.is_manually_edited ? (
                            <Badge variant="outline" className="mt-1 border-amber-500/60">
                              Editado manualmente
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={entry.nature ?? ""}
                            disabled={isClosed || updateMutation.isPending}
                            onValueChange={(nature) =>
                              updateMutation.mutate({ entry_id: entry.id, nature })
                            }
                          >
                            <SelectTrigger
                              aria-label={`Natureza de ${entry.source_account_name}`}
                              className="h-9"
                            >
                              <SelectValue placeholder="Sem natureza" />
                            </SelectTrigger>
                            <SelectContent>
                              {NATURE_OPTIONS.map((nature) => (
                                <SelectItem key={nature} value={nature}>
                                  {NATURE_LABEL[nature]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatCurrency(entry.raw_value)}
                        </TableCell>
                        <TableCell className="text-right">
                          {editing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                autoFocus
                                value={draftValue}
                                aria-label={`Valor revisado de ${entry.source_account_name}`}
                                onChange={(e) => setDraftValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitEdit(entry);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="h-9 text-right"
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Salvar valor"
                                onClick={() => commitEdit(entry)}
                              >
                                {updateMutation.isPending ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Check className="size-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Cancelar edição"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isClosed}
                              onClick={() => startEdit(entry)}
                              className="inline-flex items-center gap-2 rounded px-2 py-1 tabular-nums hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {entry.reviewed_value === null
                                ? "—"
                                : formatCurrency(entry.reviewed_value)}
                              <Pencil className="size-3.5 text-muted-foreground" />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(appliedValue(entry))}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.is_manually_edited ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isClosed || revertMutation.isPending}
                              onClick={() => revertMutation.mutate(entry.id)}
                            >
                              <Undo2 className="mr-1 size-4" />
                              Reverter
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardContent className="pt-6">
              <h2 className="mb-3 text-sm font-semibold">Totais por natureza (valor aplicado)</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {totals.byNature.map(([nature, value]) => (
                  <div
                    key={nature}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {nature === "sem_natureza"
                        ? "Sem natureza"
                        : (NATURE_LABEL[nature] ?? nature)}
                    </span>
                    <span className="tabular-nums">{formatCurrency(value)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
                <span>Total geral</span>
                <span className="tabular-nums">{formatCurrency(totals.total)}</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
