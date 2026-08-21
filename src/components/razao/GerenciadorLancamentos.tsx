/**
 * Gerenciador de lançamentos do razão: grade de movimentos (débito × crédito),
 * barra de comandos (Novo, Editar, Cancelar reg., Principal, Relatório, Sair),
 * formulário de lançamento manual e visão do lançamento completo.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  FileDown,
  FileText,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  Rows3,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateRangeField } from "@/components/ui/date-range-field";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows } from "@/components/PageState";
import { AccountSelect } from "@/components/razao/AccountSelect";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/rotta";
import { exportCsv, exportPdf, type ExportTable } from "@/lib/razao-export";
import {
  cancelJournalEntry,
  getJournalDocument,
  listJournalEntries,
  saveManualJournalEntry,
} from "@/lib/razao.functions";

const PAGE_SIZE = 50;

const STORAGE_KEY = "rotta-razao-grid";

type SortKey = "doc" | "debito" | "credito" | "data" | "valor" | "historico";
type SortDir = "asc" | "desc";
type Density = "compacto" | "confortavel";

const COLUMNS: { key: string; label: string; width: number; sort?: SortKey; right?: boolean }[] = [
  { key: "cod", label: "Cód. mov.", width: 96 },
  { key: "doc", label: "Doc", width: 130, sort: "doc" },
  { key: "debito", label: "Conta débito", width: 250, sort: "debito" },
  { key: "credito", label: "Conta crédito", width: 250, sort: "credito" },
  { key: "data", label: "Data", width: 108, sort: "data" },
  { key: "valor", label: "Valor", width: 140, sort: "valor", right: true },
  { key: "historico", label: "Histórico", width: 320, sort: "historico" },
];

const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.width]),
);

function sortValue(row: GridRow, key: SortKey): string | number {
  switch (key) {
    case "doc":
      return row.doc_number ?? "";
    case "debito":
      return (row.debit_name ?? row.debit_code ?? "").toLowerCase();
    case "credito":
      return (row.credit_name ?? row.credit_code ?? "").toLowerCase();
    case "data":
      return row.entry_date ?? "";
    case "valor":
      return row.valor;
    case "historico":
      return (row.historico ?? "").toLowerCase();
  }
}

export type GridRow = {
  id: string;
  entry_group: string | null;
  status: string;
  origin: string;
  doc_number: string | null;
  entry_date: string | null;
  historico: string | null;
  valor: number;
  debit_code: string | null;
  debit_name: string | null;
  credit_code: string | null;
  credit_name: string | null;
};

type GridResult = { total: number; soma: number; rows: GridRow[] };

type DocLeg = {
  id: string;
  entry_date: string | null;
  historico: string | null;
  debit: number;
  credit: number;
  account_reduced_code: string;
  account_name: string | null;
  counterpart_reduced_code: string | null;
  counterpart_name: string | null;
};

type DocResult = {
  doc_number: string;
  total_debit: number;
  total_credit: number;
  legs: DocLeg[];
};

type AccountOption = { reduced_code: string; name: string };

type Props = {
  periodId: string;
  periodLabel: string;
  referenceMonth: string | null;
  isAdmin: boolean;
  canEdit: boolean;
  accounts: AccountOption[];
  docNumber: string | null;
  onDocNumberChange: (doc: string | null) => void;
  onReportClick?: () => void;
};

type Mode = "lista" | "detalhe" | "form";

type FormState = {
  leg_id: string | null;
  debit_code: string;
  credit_code: string;
  entry_date: string;
  doc_number: string;
  value: string;
  historico: string;
};

const emptyForm = (entryDate: string): FormState => ({
  leg_id: null,
  debit_code: "",
  credit_code: "",
  entry_date: entryDate,
  doc_number: "",
  value: "",
  historico: "",
});

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function parseValor(raw: string) {
  const text = raw.trim().replace(/[R$\s\u00a0]/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

function AccountChip({
  tone,
  code,
  name,
  faded,
}: {
  tone: "debito" | "credito";
  code: string | null;
  name: string | null;
  faded?: boolean;
}) {
  const toneClass =
    tone === "debito"
      ? "bg-warning/15 text-warning-foreground ring-warning/30"
      : "bg-brand-soft text-brand-soft-foreground ring-brand/30";
  const displayName = name && name !== code ? name : null;
  const title = [code, name].filter(Boolean).join(" — ");
  return (
    <span
      className={`flex items-center gap-1.5 ${faded ? "opacity-60" : ""}`}
      title={title}
    >
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] leading-none ring-1 ring-inset ${toneClass}`}
      >
        {code ?? "—"}
      </span>
      {displayName ? (
        <span className="min-w-0 flex-1 truncate">{displayName}</span>
      ) : null}
    </span>
  );
}

export function GerenciadorLancamentos({
  periodId,
  periodLabel,
  referenceMonth,
  isAdmin,
  canEdit,
  accounts,
  docNumber,
  onDocNumberChange,
  onReportClick,
}: Props) {
  const queryClient = useQueryClient();
  const monthStart = referenceMonth ? referenceMonth.slice(0, 8) + "01" : "";

  const [mode, setMode] = useState<Mode>(docNumber ? "detalhe" : "lista");
  const [queryInput, setQueryInput] = useState("");
  const [term, setTerm] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(monthStart));
  const [confirmCancel, setConfirmCancel] = useState<GridRow | null>(null);
  const [sort, setSort] = useState<SortKey>("data");
  const [dir, setDir] = useState<SortDir>("desc");
  const [density, setDensity] = useState<Density>("compacto");
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [dateReady, setDateReady] = useState(false);

  // Preferências de densidade e largura das colunas (por navegador).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { density?: Density; widths?: Record<string, number> };
      if (saved.density) setDensity(saved.density);
      if (saved.widths) setWidths({ ...DEFAULT_WIDTHS, ...saved.widths });
    } catch {
      /* preferência inválida: mantém o padrão */
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ density, widths }));
  }, [density, widths]);

  // Abre a grade no último dia com lançamento (tela leve; o usuário amplia pelas datas).
  const lastDay = useQuery({
    queryKey: ["journal_last_day", periodId, includeCancelled],
    queryFn: async (): Promise<string | null> => {
      let q = supabase
        .from("journal_legs")
        .select("entry_date")
        .eq("period_id", periodId)
        .not("entry_date", "is", null)
        .order("entry_date", { ascending: false })
        .limit(1);
      if (!includeCancelled) q = q.eq("status", "ativo");
      const { data, error } = await q;
      if (error) throw error;
      return data?.[0]?.entry_date ?? null;
    },
  });

  useEffect(() => {
    if (dateReady || lastDay.isLoading) return;
    const day = lastDay.data ?? null;
    if (day) {
      setFrom(day);
      setTo(day);
    }
    setDateReady(true);
  }, [dateReady, lastDay.isLoading, lastDay.data]);

  function startResize(key: string, event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[key] ?? DEFAULT_WIDTHS[key]!;
    const move = (e: PointerEvent) => {
      const next = Math.max(64, Math.round(startWidth + (e.clientX - startX)));
      setWidths((prev) => ({ ...prev, [key]: next }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "data" || key === "valor" ? "desc" : "asc");
    }
  }

  useEffect(() => {
    const id = setTimeout(() => {
      setTerm(queryInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [queryInput]);

  useEffect(() => {
    if (docNumber) setMode("detalhe");
  }, [docNumber]);

  const runList = useServerFn(listJournalEntries);
  const fetchDocument = useServerFn(getJournalDocument);
  const runSave = useServerFn(saveManualJournalEntry);
  const runCancel = useServerFn(cancelJournalEntry);

  const grid = useQuery({
    queryKey: ["journal_grid", periodId, term, from, to, includeCancelled, page],
    enabled: dateReady,
    queryFn: async (): Promise<GridResult> =>
      (await runList({
        data: {
          period_id: periodId,
          query: term,
          from: from || null,
          to: to || null,
          account: null,
          include_cancelled: includeCancelled,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      })) as unknown as GridResult,
  });

  const documentQuery = useQuery({
    queryKey: ["journal_document", periodId, docNumber],
    enabled: Boolean(docNumber),
    queryFn: async (): Promise<DocResult> =>
      (await fetchDocument({
        data: { period_id: periodId, doc_number: docNumber! },
      })) as unknown as DocResult,
  });

  const rawRows = grid.data?.rows ?? [];
  const rows = useMemo(() => {
    const factor = dir === "asc" ? 1 : -1;
    return [...rawRows].sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * factor;
    });
  }, [rawRows, sort, dir]);
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const totalWidth = COLUMNS.reduce((sum, col) => sum + (widths[col.key] ?? col.width), 0);
  const cellPad = density === "compacto" ? "py-1 text-[13px]" : "py-3 text-sm";
  const rowText = density === "compacto" ? "[&>td]:align-middle" : "";

  const accountName = (code: string | null) =>
    accounts.find((a) => a.reduced_code === code)?.name ?? "";

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["journal_grid"] });
    void queryClient.invalidateQueries({ queryKey: ["journal_statement"] });
    void queryClient.invalidateQueries({ queryKey: ["journal_document"] });
    void queryClient.invalidateQueries({ queryKey: ["ledger_audit"] });
    void queryClient.invalidateQueries({ queryKey: ["indicators"] });
  }

  const saveMutation = useMutation({
    mutationFn: async (state: FormState) => {
      const valor = parseValor(state.value);
      if (!state.debit_code.trim() || !state.credit_code.trim())
        throw new Error("Informe a conta de débito e a conta de crédito.");
      if (state.debit_code.trim() === state.credit_code.trim())
        throw new Error("As contas de débito e crédito devem ser diferentes.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Valor inválido.");
      if (!state.entry_date) throw new Error("Informe a data.");
      if (!state.historico.trim()) throw new Error("Informe o histórico.");
      return (await runSave({
        data: {
          period_id: periodId,
          leg_id: state.leg_id,
          debit_code: state.debit_code.trim(),
          credit_code: state.credit_code.trim(),
          entry_date: state.entry_date,
          doc_number: state.doc_number.trim(),
          value: valor,
          historico: state.historico.trim(),
        },
      })) as unknown as { id: string };
    },
    onSuccess: (result) => {
      toast.success(form.leg_id ? "Lançamento atualizado." : "Lançamento incluído.");
      setSelectedId(result.id);
      setMode("lista");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async (row: GridRow) =>
      (await runCancel({ data: { leg_id: row.id, motivo: "" } })) as unknown as {
        cancelled: number;
      },
    onSuccess: () => {
      toast.success("Lançamento cancelado.");
      setConfirmCancel(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function novo() {
    setForm(emptyForm(monthStart));
    setMode("form");
  }

  function editar(row: GridRow | null) {
    if (!row) return;
    if (row.status === "cancelado") {
      toast.error("Lançamento cancelado não pode ser editado.");
      return;
    }
    setForm({
      leg_id: row.id,
      debit_code: row.debit_code ?? "",
      credit_code: row.credit_code ?? "",
      entry_date: row.entry_date ?? monthStart,
      doc_number: row.doc_number ?? "",
      value: String(row.valor),
      historico: row.historico ?? "",
    });
    setMode("form");
  }

  function abrirPrincipal(row: GridRow | null) {
    if (!row?.doc_number) {
      toast.error("Este lançamento não tem número de documento.");
      return;
    }
    onDocNumberChange(row.doc_number);
    setMode("detalhe");
  }

  function gridTable(): ExportTable | null {
    if (rows.length === 0) return null;
    return {
      title: "Lançamentos do razão",
      subtitle: `Período ${periodLabel}`,
      info: [
        { label: "Lançamentos", value: String(grid.data?.total ?? rows.length) },
        { label: "Soma", value: formatCurrency(grid.data?.soma ?? 0) },
      ],
      headers: ["Data", "Núm. doc.", "Conta débito", "Conta crédito", "Valor", "Histórico"],
      numeric: [4],
      rows: rows.map((row) => [
        fmtDate(row.entry_date),
        row.doc_number ?? "",
        row.debit_name ?? row.debit_code ?? "",
        row.credit_name ?? row.credit_code ?? "",
        formatCurrency(row.valor),
        row.historico ?? "",
      ]),
    };
  }

  function docTable(): ExportTable | null {
    const data = documentQuery.data;
    if (!data) return null;
    return {
      title: `Lançamento ${data.doc_number}`,
      subtitle: `Período ${periodLabel}`,
      info: [
        { label: "Total débito", value: formatCurrency(data.total_debit) },
        { label: "Total crédito", value: formatCurrency(data.total_credit) },
      ],
      headers: ["Data", "Conta", "Contrapartida", "Histórico", "Débito", "Crédito"],
      numeric: [4, 5],
      rows: data.legs.map((leg) => [
        fmtDate(leg.entry_date),
        `${leg.account_reduced_code} ${leg.account_name ?? ""}`.trim(),
        leg.counterpart_name ?? leg.counterpart_reduced_code ?? "",
        leg.historico ?? "",
        leg.debit ? formatCurrency(leg.debit) : "",
        leg.credit ? formatCurrency(leg.credit) : "",
      ]),
    };
  }

  async function exportar(table: ExportTable | null, filename: string, kind: "csv" | "pdf") {
    if (!table || table.rows.length === 0) {
      toast.error("Nada para exportar.");
      return;
    }
    try {
      if (kind === "csv") exportCsv(table, filename);
      else await exportPdf(table, filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar o arquivo.");
    }
  }

  function ExportButtons({ table, filename }: { table: ExportTable | null; filename: string }) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void exportar(table, filename, "csv")}>
          <FileDown className="mr-2 size-4" />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => void exportar(table, filename, "pdf")}>
          <FileText className="mr-2 size-4" />
          PDF
        </Button>
      </div>
    );
  }

  const podeEditar = isAdmin && canEdit;

  /* --------------------------- FORMULÁRIO --------------------------- */
  if (mode === "form") {
    const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
    return (
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {form.leg_id ? "Editar lançamento" : "Novo lançamento"}
              </p>
              <p className="text-xs text-muted-foreground">
                Período {periodLabel} · a contrapartida é gravada automaticamente.
              </p>
            </div>
            <Badge variant="secondary">
              Cód. mov.: {form.leg_id ? form.leg_id.slice(0, 8) : "automático"}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="conta-debito">
                Conta débito
              </label>
              <AccountSelect
                id="conta-debito"
                tone="debito"
                value={form.debit_code}
                onChange={(code) => set({ debit_code: code })}
                accounts={accounts}
                placeholder="Selecionar conta débito"
              />
              <div className="min-h-[1.75rem] rounded-md border bg-background px-2.5 py-1">
                {form.debit_code ? (
                  <AccountChip tone="debito" code={form.debit_code} name={accountName(form.debit_code)} />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Informe o código reduzido da conta.
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="conta-credito">
                Conta crédito
              </label>
              <Input
                id="conta-credito"
                list="contas-razao"
                value={form.credit_code}
                onChange={(e) => set({ credit_code: e.target.value })}
                placeholder="Código reduzido"
              />
              <div className="min-h-[1.75rem] rounded-md border bg-background px-2.5 py-1">
                {form.credit_code ? (
                  <AccountChip tone="credito" code={form.credit_code} name={accountName(form.credit_code)} />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Informe o código reduzido da conta.
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="data-lcto">
                Data
              </label>
              <Input
                id="data-lcto"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="doc-lcto">
                Núm. doc.
              </label>
              <Input
                id="doc-lcto"
                value={form.doc_number}
                onChange={(e) => set({ doc_number: e.target.value })}
                placeholder="Ex.: 105895"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="valor-lcto">
                Valor
              </label>
              <Input
                id="valor-lcto"
                value={form.value}
                onChange={(e) => set({ value: e.target.value })}
                placeholder="0,00"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium" htmlFor="hist-lcto">
                Histórico
              </label>
              <Input
                id="hist-lcto"
                value={form.historico}
                onChange={(e) => set({ historico: e.target.value })}
                placeholder="Descrição do lançamento"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Gravar
            </Button>
            <Button variant="outline" onClick={() => setMode("lista")}>
              <X className="mr-2 size-4" />
              Sair
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* ---------------------- LANÇAMENTO COMPLETO ---------------------- */
  if (mode === "detalhe" && docNumber) {
    const data = documentQuery.data;
    const diff = data ? Number(data.total_debit) - Number(data.total_credit) : 0;
    return documentQuery.isLoading ? (
      <LoadingRows />
    ) : documentQuery.error ? (
      <ErrorState
        message={(documentQuery.error as Error).message}
        onRetry={() => void documentQuery.refetch()}
      />
    ) : data && data.legs.length > 0 ? (
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDocNumberChange(null);
                setMode("lista");
              }}
            >
              <X className="mr-2 size-4" />
              Sair
            </Button>
            <ExportButtons table={docTable()} filename={`lancamento-${data.doc_number}`} />
          </div>

          <div className="flex flex-wrap gap-6 border-b p-4">
            <div>
              <p className="text-xs text-muted-foreground">Lançamento</p>
              <p className="font-medium">{data.doc_number}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total débito</p>
              <p className="tabular-nums font-medium">{formatCurrency(data.total_debit)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total crédito</p>
              <p className="tabular-nums font-medium">{formatCurrency(data.total_credit)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Conferência</p>
              <Badge variant={Math.abs(diff) < 0.01 ? "secondary" : "destructive"}>
                {Math.abs(diff) < 0.01 ? "Débito = crédito" : formatCurrency(diff)}
              </Badge>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Contrapartida</TableHead>
                <TableHead>Histórico</TableHead>
                <TableHead className="text-right">Débito</TableHead>
                <TableHead className="text-right">Crédito</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.legs.map((leg) => (
                <TableRow key={leg.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(leg.entry_date)}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="block truncate font-medium">
                      {leg.account_name ?? leg.account_reduced_code}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {leg.account_reduced_code}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <span className="block truncate">
                      {leg.counterpart_name ?? leg.counterpart_reduced_code ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <span className="block truncate">{leg.historico ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {leg.debit ? formatCurrency(leg.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {leg.credit ? formatCurrency(leg.credit) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    ) : (
      <EmptyState
        title="Lançamento não encontrado"
        description="Confira o número informado para este período."
      />
    );
  }

  /* ------------------------------ GRADE ------------------------------ */
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(240px,auto)_auto]">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Núm. doc., conta, contrapartida, histórico ou valor"
              className="pl-8"
              aria-label="Pesquisar lançamentos"
            />
          </div>
          <DateRangeField
            value={{ from, to }}
            referenceMonth={referenceMonth}
            placeholder="Todas as datas"
            onChange={(next) => {
              setFrom(next.from);
              setTo(next.to);
              setPage(0);
            }}
          />

          <Button
            variant={includeCancelled ? "default" : "outline"}
            onClick={() => {
              setIncludeCancelled((v) => !v);
              setPage(0);
            }}
          >
            <Ban className="mr-2 size-4" />
            Cancelados
          </Button>
        </CardContent>
      </Card>

      {confirmCancel ? (
        <Card className="border-destructive">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm">
              Cancelar o lançamento {confirmCancel.doc_number ?? ""} de{" "}
              {formatCurrency(confirmCancel.valor)}? Ele sai dos cálculos, mas continua no
              histórico.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => cancelMutation.mutate(confirmCancel)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Confirmar cancelamento
              </Button>
              <Button variant="outline" onClick={() => setConfirmCancel(null)}>
                Voltar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {grid.isLoading ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : grid.error ? (
            <div className="p-4">
              <ErrorState
                message={(grid.error as Error).message}
                onRetry={() => void grid.refetch()}
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nenhum lançamento"
                description={
                  term || from || to
                    ? "Nada combina com os filtros aplicados neste período."
                    : "Importe o razão em Importar › Razão contábil ou inclua um lançamento manual."
                }
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <p className="text-sm text-muted-foreground">
                  {grid.data!.total} lançamento(s) · soma {formatCurrency(grid.data!.soma)}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDensity((d) => (d === "compacto" ? "confortavel" : "compacto"))
                    }
                    title="Alterna a altura das linhas"
                  >
                    <Rows3 className="mr-2 size-4" />
                    {density === "compacto" ? "Compacto" : "Confortável"}
                  </Button>
                  <ExportButtons table={gridTable()} filename={`lancamentos-${periodLabel}`} />
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table style={{ tableLayout: "fixed", width: totalWidth }}>
                  <colgroup>
                    {COLUMNS.map((col) => (
                      <col key={col.key} style={{ width: widths[col.key] ?? col.width }} />
                    ))}
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      {COLUMNS.map((col) => (
                        <TableHead
                          key={col.key}
                          className={`relative select-none ${cellPad} ${
                            col.right ? "text-right" : ""
                          }`}
                        >
                          {col.sort ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(col.sort!)}
                              className={`inline-flex items-center gap-1 hover:text-foreground ${
                                col.right ? "flex-row-reverse" : ""
                              }`}
                            >
                              {col.label}
                              {sort === col.sort ? (
                                dir === "asc" ? (
                                  <ArrowUp className="size-3" />
                                ) : (
                                  <ArrowDown className="size-3" />
                                )
                              ) : (
                                <ArrowUpDown className="size-3 opacity-40" />
                              )}
                            </button>
                          ) : (
                            col.label
                          )}
                          <span
                            role="separator"
                            aria-label={`Ajustar largura de ${col.label}`}
                            onPointerDown={(e) => startResize(col.key, e)}
                            onDoubleClick={() =>
                              setWidths((prev) => ({ ...prev, [col.key]: col.width }))
                            }
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-brand"
                          />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const cancelado = row.status === "cancelado";
                      return (
                        <TableRow
                          key={row.id}
                          onClick={() => setSelectedId(row.id)}
                          onDoubleClick={() => abrirPrincipal(row)}
                          className={`cursor-pointer ${rowText} ${
                            selectedId === row.id
                              ? "bg-accent shadow-[inset_3px_0_0_0_var(--color-brand)]"
                              : ""
                          } ${cancelado ? "text-muted-foreground line-through opacity-70" : ""}`}
                        >
                          <TableCell className={`${cellPad} truncate font-mono text-xs`}>
                            {row.id.slice(0, 8)}
                          </TableCell>
                          <TableCell className={`${cellPad} truncate font-medium`}>
                            {row.doc_number ?? "—"}
                            {row.origin === "manual" ? (
                              <Badge variant="secondary" className="ml-2">
                                manual
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className={cellPad}>
                            <AccountChip
                              tone="debito"
                              code={row.debit_code}
                              name={row.debit_name}
                              faded={cancelado}
                            />
                          </TableCell>
                          <TableCell className={cellPad}>
                            <AccountChip
                              tone="credito"
                              code={row.credit_code}
                              name={row.credit_name}
                              faded={cancelado}
                            />
                          </TableCell>
                          <TableCell className={`${cellPad} truncate`}>
                            {fmtDate(row.entry_date)}
                          </TableCell>
                          <TableCell className={`${cellPad} truncate text-right tabular-nums`}>
                            {formatCurrency(row.valor)}
                          </TableCell>
                          <TableCell className={cellPad}>
                            <span className="block truncate">{row.historico ?? "—"}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
                <span>
                  {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} de {grid.data!.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= (grid.data!.total ?? 0)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------ BARRA DE COMANDOS ------------------------ */}
      <Card className="sticky bottom-4">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <Button size="sm" onClick={novo} disabled={!podeEditar}>
            <Plus className="mr-2 size-4" />
            Novo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => editar(selected)}
            disabled={!podeEditar || !selected}
          >
            <Pencil className="mr-2 size-4" />
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => selected && setConfirmCancel(selected)}
            disabled={!podeEditar || !selected || selected.status === "cancelado"}
          >
            <Ban className="mr-2 size-4" />
            Cancelar reg.
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => abrirPrincipal(selected)}
            disabled={!selected}
          >
            <Maximize2 className="mr-2 size-4" />
            Principal
          </Button>
          <Button size="sm" variant="outline" onClick={onReportClick}>
            <FileText className="mr-2 size-4" />
            Relatório
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {selected
              ? `Selecionado: ${selected.doc_number ?? selected.id.slice(0, 8)}`
              : podeEditar
                ? "Selecione uma linha para editar, cancelar ou abrir."
                : "Somente administradores editam lançamentos em períodos abertos."}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
