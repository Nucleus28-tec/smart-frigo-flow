import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Loader2, Pencil, Undo2, X } from "lucide-react";

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNature, setBulkNature] = useState<string>("");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

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

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of rows) {
      const key = entry.nature ?? "sem_natureza";
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    const sum = (key: string) =>
      (map.get(key) ?? []).reduce((acc, e) => acc + Number(appliedValue(e)), 0);
    const totals: Record<string, number> = {};
    for (const key of [...NATURE_OPTIONS, "sem_natureza"]) totals[key] = sum(key);
    const t = (key: string) => totals[key] ?? 0;

    const ativo = Math.abs(t("ativo_circulante") + t("ativo_nao_circulante"));
    const passivoPl = Math.abs(
      t("passivo_circulante") + t("passivo_nao_circulante") + t("patrimonio_liquido"),
    );
    const receita = Math.abs(t("receita"));
    const custo = Math.abs(t("custo"));
    const despesa = Math.abs(t("despesa"));

    return {
      map,
      totals,
      ativo,
      passivoPl,
      diferenca: ativo - passivoPl,
      receita,
      custo,
      despesa,
      lucroBruto: receita - custo,
      resultado: receita - custo - despesa,
      semNatureza: map.get("sem_natureza") ?? [],
    };
  }, [rows]);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setManySelected(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const allVisibleSelected = rows.length > 0 && rows.every((e) => selected.has(e.id));

  async function applyBulkNature() {
    if (!bulkNature || selected.size === 0) return;
    const ids = rows.filter((e) => selected.has(e.id)).map((e) => e.id);
    setBulkProgress({ done: 0, total: ids.length });
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i += 5) {
      const chunk = ids.slice(i, i + 5);
      const results = await Promise.allSettled(
        chunk.map((entry_id) => saveEntry({ data: { entry_id, nature: bulkNature as never } })),
      );
      for (const r of results) {
        if (r.status === "fulfilled") ok += 1;
        else failed += 1;
      }
      setBulkProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    setBulkProgress(null);
    setSelected(new Set());
    invalidate();
    if (failed) toast.error(`${ok} conta(s) classificada(s), ${failed} falharam.`);
    else toast.success(`${ok} conta(s) classificada(s) como ${NATURE_LABEL[bulkNature] ?? bulkNature}.`);
  }


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

  function renderEntryRow(entry: Entry) {
    const editing = editingId === entry.id;
    return (
      <TableRow
        key={entry.id}
        className={entry.is_manually_edited ? "bg-amber-500/10 hover:bg-amber-500/15" : ""}
      >
        <TableCell className="pl-8 font-medium">
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
            onValueChange={(nature) => updateMutation.mutate({ entry_id: entry.id, nature })}
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
              {entry.reviewed_value === null ? "—" : formatCurrency(entry.reviewed_value)}
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
  }

  function renderSection(key: string, label: string) {
    const list = grouped.map.get(key) ?? [];
    if (!list.length) return null;
    const isCollapsed = collapsed.has(key);
    return (
      <Fragment key={key}>
        <TableRow className="bg-muted/60 hover:bg-muted/60">
          <TableCell colSpan={4}>
            <button
              type="button"
              onClick={() => toggleSection(key)}
              className="inline-flex items-center gap-2 text-sm font-semibold"
            >
              {isCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              {label}
              <span className="text-xs font-normal text-muted-foreground">
                {list.length} conta(s)
              </span>
            </button>
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {formatCurrency(grouped.totals[key] ?? 0)}
          </TableCell>
          <TableCell />
        </TableRow>
        {isCollapsed ? null : list.map(renderEntryRow)}
      </Fragment>
    );
  }

  function renderGroupTotal(label: string, value: number) {
    return (
      <TableRow className="border-t-2 border-border hover:bg-transparent">
        <TableCell colSpan={4} className="text-sm font-semibold uppercase tracking-wide">
          {label}
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {formatCurrency(value)}
        </TableCell>
        <TableCell />
      </TableRow>
    );
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
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-card px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Ativo</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(grouped.ativo)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-card px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Passivo + PL
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(grouped.passivoPl)}
              </p>
            </div>
            <div
              className={`rounded-md border px-4 py-3 ${
                Math.abs(grouped.diferenca) < 0.01
                  ? "border-border bg-card"
                  : "border-amber-500/60 bg-amber-500/10"
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {Math.abs(grouped.diferenca) < 0.01 ? "Balancete fechado" : "Diferença"}
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(grouped.diferenca)}
              </p>
            </div>
          </div>

          {grouped.semNatureza.length ? (
            <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">
              {grouped.semNatureza.length} conta(s) sem natureza — classifique-as para consolidar
              o resultado.
            </p>
          ) : null}

          {search.trim() || natureFilter !== "todas" || onlyEdited ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Filtros ativos: os subtotais consideram apenas as contas visíveis.
            </p>
          ) : null}

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
                  {renderSection("sem_natureza", "Contas sem natureza")}

                  {renderSection("ativo_circulante", "Ativo circulante")}
                  {renderSection("ativo_nao_circulante", "Ativo não circulante")}
                  {grouped.map.has("ativo_circulante") ||
                  grouped.map.has("ativo_nao_circulante")
                    ? renderGroupTotal("Total do Ativo", grouped.ativo)
                    : null}

                  {renderSection("passivo_circulante", "Passivo circulante")}
                  {renderSection("passivo_nao_circulante", "Passivo não circulante")}
                  {renderSection("patrimonio_liquido", "Patrimônio líquido")}
                  {grouped.map.has("passivo_circulante") ||
                  grouped.map.has("passivo_nao_circulante") ||
                  grouped.map.has("patrimonio_liquido")
                    ? renderGroupTotal("Total do Passivo + Patrimônio líquido", grouped.passivoPl)
                    : null}

                  {renderSection("receita", "Receita")}
                  {renderSection("custo", "Custo")}
                  {grouped.map.has("receita") || grouped.map.has("custo")
                    ? renderGroupTotal("(=) Lucro bruto", grouped.lucroBruto)
                    : null}
                  {renderSection("despesa", "Despesa")}
                  {grouped.map.has("receita") ||
                  grouped.map.has("custo") ||
                  grouped.map.has("despesa")
                    ? renderGroupTotal("(=) Resultado do período", grouped.resultado)
                    : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardContent className="pt-6">
              <h2 className="mb-3 text-sm font-semibold">Resumo de fechamento</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["Total do Ativo", grouped.ativo],
                  ["Total do Passivo + PL", grouped.passivoPl],
                  ["Diferença (Ativo − Passivo/PL)", grouped.diferenca],
                  ["Receita", grouped.receita],
                  ["Custo", grouped.custo],
                  ["Despesa", grouped.despesa],
                  ["Lucro bruto", grouped.lucroBruto],
                  ["Resultado do período", grouped.resultado],
                ].map(([label, value]) => (
                  <div
                    key={label as string}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">{label as string}</span>
                    <span className="tabular-nums">{formatCurrency(value as number)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

    </>
  );
}
