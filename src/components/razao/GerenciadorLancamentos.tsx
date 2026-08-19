/**
 * Gerenciador de lançamentos do razão: grade de movimentos (débito × crédito),
 * barra de comandos (Novo, Editar, Cancelar reg., Principal, Relatório, Sair),
 * formulário de lançamento manual e visão do lançamento completo.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Ban, FileDown, FileText, Loader2, Maximize2, Pencil, Plus, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows } from "@/components/PageState";
import { formatCurrency } from "@/lib/rotta";
import { exportCsv, exportPdf, type ExportTable } from "@/lib/razao-export";
import {
  cancelJournalEntry,
  getJournalDocument,
  listJournalEntries,
  saveManualJournalEntry,
} from "@/lib/razao.functions";

const PAGE_SIZE = 50;

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

export function GerenciadorLancamentos({
  periodId,
  periodLabel,
  referenceMonth,
  isAdmin,
  canEdit,
  accounts,
  docNumber,
  onDocNumberChange,
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

  const rows = grid.data?.rows ?? [];
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

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
        { label: "Soma da página", value: formatCurrency(grid.data?.soma ?? 0) },
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

          <datalist id="contas-razao">
            {accounts.map((account) => (
              <option key={account.reduced_code} value={account.reduced_code}>
                {account.name}
              </option>
            ))}
          </datalist>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="conta-debito">
                Conta débito
              </label>
              <Input
                id="conta-debito"
                list="contas-razao"
                value={form.debit_code}
                onChange={(e) => set({ debit_code: e.target.value })}
                placeholder="Código reduzido"
              />
              <p className="text-xs text-muted-foreground">
                {accountName(form.debit_code) || "Informe o código reduzido da conta."}
              </p>
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
              <p className="text-xs text-muted-foreground">
                {accountName(form.credit_code) || "Informe o código reduzido da conta."}
              </p>
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
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
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
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
            aria-label="Data inicial"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
            aria-label="Data final"
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  {grid.data!.total} lançamento(s) · soma da página{" "}
                  {formatCurrency(grid.data!.soma)}
                </p>
                <ExportButtons table={gridTable()} filename={`lancamentos-${periodLabel}`} />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cód. mov.</TableHead>
                    <TableHead>Doc</TableHead>
                    <TableHead>Conta débito</TableHead>
                    <TableHead>Conta crédito</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Histórico</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      onDoubleClick={() => abrirPrincipal(row)}
                      className={`cursor-pointer ${selectedId === row.id ? "bg-accent" : ""} ${
                        row.status === "cancelado" ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {row.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {row.doc_number ?? "—"}
                        {row.origin === "manual" ? (
                          <Badge variant="secondary" className="ml-2">
                            manual
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <span className="block truncate">
                          {row.debit_name ?? row.debit_code ?? "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">{row.debit_code}</span>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <span className="block truncate">
                          {row.credit_name ?? row.credit_code ?? "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">{row.credit_code}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(row.entry_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.valor)}
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <span className="block truncate">{row.historico ?? "—"}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
          <Button size="sm" variant="outline" disabled title="Tela de relatórios em breve">
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
