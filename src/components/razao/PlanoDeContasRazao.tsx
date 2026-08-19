/**
 * Plano de contas do razão: grade oficial (código reduzido × código hierárquico),
 * busca, filtros, seleção múltipla, reclassificação em lote, inclusão/edição e
 * ativação/desativação de contas. Mesmo padrão visual do gerenciador de lançamentos.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  Pencil,
  Plus,
  Power,
  Rows3,
  Search,
  Tags,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { EmptyState, ErrorState, LoadingRows } from "@/components/PageState";
import { NATURE_LABEL, NATURE_OPTIONS } from "@/lib/rotta";
import {
  listChartAccounts,
  reclassifyChartAccounts,
  saveChartAccount,
  setChartAccountActive,
} from "@/lib/razao.functions";

const PAGE_SIZE = 50;
const STORAGE_KEY = "rotta-plano-contas-grid";

type SortKey = "reduced" | "hier" | "nome" | "natureza" | "lctos";
type SortDir = "asc" | "desc";
type Density = "compacto" | "confortavel";

type AccountRow = {
  id: string;
  reduced_code: string;
  hierarchical_code: string | null;
  name: string;
  level: number | null;
  parent_code: string | null;
  is_analytic: boolean;
  nature: string | null;
  link_status: string;
  is_active: boolean;
  legs_count: number;
};

type GridResult = { total: number; rows: AccountRow[] };

const COLUMNS: { key: string; label: string; width: number; sort?: SortKey; right?: boolean }[] = [
  { key: "sel", label: "", width: 44 },
  { key: "reduced", label: "Cód. reduzido", width: 130, sort: "reduced" },
  { key: "hier", label: "Cód. hierárquico", width: 190, sort: "hier" },
  { key: "nome", label: "Descrição", width: 380, sort: "nome" },
  { key: "tipo", label: "Tipo", width: 110 },
  { key: "natureza", label: "Natureza", width: 190, sort: "natureza" },
  { key: "lctos", label: "Lçtos.", width: 90, sort: "lctos", right: true },
  { key: "situacao", label: "Situação", width: 110 },
];

const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.width]),
);

function sortValue(row: AccountRow, key: SortKey): string | number {
  switch (key) {
    case "reduced":
      return row.reduced_code;
    case "hier":
      return row.hierarchical_code ?? "zzz";
    case "nome":
      return row.name.toLowerCase();
    case "natureza":
      return row.nature ?? "";
    case "lctos":
      return row.legs_count;
  }
}

type FormState = {
  id: string | null;
  reduced_code: string;
  hierarchical_code: string;
  name: string;
  is_analytic: boolean;
  nature: string;
};

const emptyForm: FormState = {
  id: null,
  reduced_code: "",
  hierarchical_code: "",
  name: "",
  is_analytic: true,
  nature: "",
};

function NatureChip({ nature }: { nature: string | null }) {
  if (!nature) {
    return (
      <Badge variant="outline" className="font-normal">
        Não classificada
      </Badge>
    );
  }
  const tone = nature.startsWith("ativo")
    ? "bg-brand-soft text-brand-soft-foreground ring-brand/30"
    : nature.startsWith("passivo") || nature === "patrimonio_liquido"
      ? "bg-warning/15 text-warning-foreground ring-warning/30"
      : nature === "receita"
        ? "bg-success/15 text-success-foreground ring-success/30"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[11px] leading-tight ring-1 ring-inset ${tone}`}
    >
      {NATURE_LABEL[nature] ?? nature}
    </span>
  );
}

export function PlanoDeContasRazao({
  periodId,
  isAdmin,
}: {
  periodId: string | null;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();

  const [queryInput, setQueryInput] = useState("");
  const [term, setTerm] = useState("");
  const [nature, setNature] = useState<string>("todas");
  const [tipo, setTipo] = useState<string>("todos");
  const [onlyPending, setOnlyPending] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"lista" | "form">("lista");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [bulkNature, setBulkNature] = useState<string>("");
  const [bulkParent, setBulkParent] = useState("");
  const [sort, setSort] = useState<SortKey>("hier");
  const [dir, setDir] = useState<SortDir>("asc");
  const [density, setDensity] = useState<Density>("compacto");
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);

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

  useEffect(() => {
    const id = window.setTimeout(() => {
      setTerm(queryInput.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [queryInput]);

  const listFn = useServerFn(listChartAccounts);
  const saveFn = useServerFn(saveChartAccount);
  const bulkFn = useServerFn(reclassifyChartAccounts);
  const activeFn = useServerFn(setChartAccountActive);

  const grid = useQuery({
    queryKey: ["chart_accounts_grid", periodId, term, nature, tipo, onlyPending, page],
    queryFn: async (): Promise<GridResult> => {
      const result = (await listFn({
        data: {
          period_id: periodId,
          query: term,
          nature: nature === "todas" ? null : nature,
          type: tipo === "todos" ? null : (tipo as "analitica" | "sintetica"),
          only_pending: onlyPending,
          only_active: false,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      })) as unknown as GridResult;
      return { total: Number(result.total ?? 0), rows: result.rows ?? [] };
    },
  });

  const rows = useMemo(() => {
    const list = [...(grid.data?.rows ?? [])];
    const factor = dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * factor;
    });
  }, [grid.data, sort, dir]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["chart_accounts_grid"] });
    void queryClient.invalidateQueries({ queryKey: ["journal_accounts"] });
  };

  const saveMutation = useMutation({
    mutationFn: (state: FormState) => {
      if (!state.reduced_code.trim()) throw new Error("Informe o código reduzido.");
      if (!state.name.trim()) throw new Error("Informe a descrição da conta.");
      return saveFn({
        data: {
          id: state.id,
          reduced_code: state.reduced_code.trim(),
          hierarchical_code: state.hierarchical_code.trim() || null,
          name: state.name.trim(),
          is_analytic: state.is_analytic,
          nature: state.nature || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Conta gravada.");
      setMode("lista");
      setForm(emptyForm);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bulkMutation = useMutation({
    mutationFn: () => {
      if (selected.size === 0) throw new Error("Selecione ao menos uma conta.");
      if (!bulkNature && !bulkParent.trim())
        throw new Error("Informe a natureza ou a conta-pai para reclassificar.");
      return bulkFn({
        data: {
          ids: [...selected],
          nature: bulkNature || null,
          parent_code: bulkParent.trim() || null,
        },
      });
    },
    onSuccess: (result) => {
      toast.success(`${result.updated} conta(s) reclassificada(s).`);
      setSelected(new Set());
      setBulkNature("");
      setBulkParent("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const activeMutation = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      activeFn({ data: { id: vars.id, active: vars.active } }),
    onSuccess: (result) => {
      toast.success(result.is_active ? "Conta reativada." : "Conta desativada.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir("asc");
    }
  }

  function startResize(key: string, event: React.PointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[key] ?? DEFAULT_WIDTHS[key] ?? 120;
    const onMove = (e: PointerEvent) => {
      const next = Math.max(48, startWidth + (e.clientX - startX));
      setWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const cellPad = density === "compacto" ? "py-1" : "py-2.5";
  const rowText = density === "compacto" ? "text-xs" : "text-sm";
  const totalWidth = COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? c.width), 0);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const single = selected.size === 1 ? rows.find((r) => selected.has(r.id)) : undefined;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ------------------------------ FORMULÁRIO ------------------------------ */
  if (mode === "form") {
    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold">
            {form.id ? "Editar conta" : "Nova conta do plano"}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="pc-reduzido">
                Código reduzido
              </label>
              <Input
                id="pc-reduzido"
                value={form.reduced_code}
                onChange={(e) => set({ reduced_code: e.target.value })}
                placeholder="Ex.: 011126"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="pc-hier">
                Código hierárquico
              </label>
              <Input
                id="pc-hier"
                value={form.hierarchical_code}
                onChange={(e) => set({ hierarchical_code: e.target.value })}
                placeholder="Ex.: 1.01.01.002.00006."
                className="font-mono"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium" htmlFor="pc-nome">
                Descrição
              </label>
              <Input
                id="pc-nome"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Nome da conta"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="pc-tipo">
                Tipo
              </label>
              <Select
                value={form.is_analytic ? "analitica" : "sintetica"}
                onValueChange={(v) => set({ is_analytic: v === "analitica" })}
              >
                <SelectTrigger id="pc-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analitica">Analítica</SelectItem>
                  <SelectItem value="sintetica">Sintética</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="pc-natureza">
                Natureza
              </label>
              <Select value={form.nature} onValueChange={(v) => set({ nature: v })}>
                <SelectTrigger id="pc-natureza">
                  <SelectValue placeholder="Derivar do código hierárquico" />
                </SelectTrigger>
                <SelectContent>
                  {NATURE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {NATURE_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button
              variant="outline"
              onClick={() => {
                setMode("lista");
                setForm(emptyForm);
              }}
            >
              <X className="mr-2 size-4" />
              Sair
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* -------------------------------- GRADE -------------------------------- */
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Código reduzido, código hierárquico ou descrição"
              className="pl-8"
              aria-label="Pesquisar contas"
            />
          </div>
          <Select
            value={nature}
            onValueChange={(v) => {
              setNature(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="md:w-[200px]" aria-label="Filtrar por natureza">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as naturezas</SelectItem>
              {NATURE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {NATURE_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={tipo}
            onValueChange={(v) => {
              setTipo(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="md:w-[160px]" aria-label="Filtrar por tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              <SelectItem value="analitica">Analíticas</SelectItem>
              <SelectItem value="sintetica">Sintéticas</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={onlyPending ? "default" : "outline"}
            onClick={() => {
              setOnlyPending((v) => !v);
              setPage(0);
            }}
          >
            <Tags className="mr-2 size-4" />
            Pendentes
          </Button>
        </CardContent>
      </Card>

      {isAdmin && selected.size > 0 ? (
        <Card className="border-brand/40">
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <p className="text-sm font-medium">{selected.size} conta(s) selecionada(s)</p>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bulk-natureza">
                Nova natureza
              </label>
              <Select value={bulkNature} onValueChange={setBulkNature}>
                <SelectTrigger id="bulk-natureza" className="w-[210px]">
                  <SelectValue placeholder="Manter" />
                </SelectTrigger>
                <SelectContent>
                  {NATURE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {NATURE_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="bulk-pai">
                Nova conta-pai (hierárquica)
              </label>
              <Input
                id="bulk-pai"
                value={bulkParent}
                onChange={(e) => setBulkParent(e.target.value)}
                placeholder="Ex.: 1.01.03."
                className="w-[210px] font-mono"
              />
            </div>
            <Button onClick={() => bulkMutation.mutate()} disabled={bulkMutation.isPending}>
              {bulkMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Tags className="mr-2 size-4" />
              )}
              Reclassificar
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
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
                title="Nenhuma conta encontrada"
                description="Ajuste a busca ou os filtros para ver outras contas do plano."
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <p className="text-sm text-muted-foreground">
                  {grid.data!.total} conta(s) no plano
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDensity((d) => (d === "compacto" ? "confortavel" : "compacto"))}
                  title="Alterna a altura das linhas"
                >
                  <Rows3 className="mr-2 size-4" />
                  {density === "compacto" ? "Compacto" : "Confortável"}
                </Button>
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
                          {col.key === "sel" ? (
                            <Checkbox
                              checked={allChecked}
                              aria-label="Selecionar todas as contas da página"
                              onCheckedChange={(checked) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  rows.forEach((r) =>
                                    checked ? next.add(r.id) : next.delete(r.id),
                                  );
                                  return next;
                                })
                              }
                            />
                          ) : col.sort ? (
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
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => toggleRow(row.id)}
                        onDoubleClick={() => {
                          if (!isAdmin) return;
                          setForm({
                            id: row.id,
                            reduced_code: row.reduced_code,
                            hierarchical_code: row.hierarchical_code ?? "",
                            name: row.name,
                            is_analytic: row.is_analytic,
                            nature: row.nature ?? "",
                          });
                          setMode("form");
                        }}
                        className={`cursor-pointer ${rowText} ${
                          selected.has(row.id)
                            ? "bg-accent shadow-[inset_3px_0_0_0_var(--color-brand)]"
                            : ""
                        } ${row.is_active ? "" : "text-muted-foreground opacity-70"} ${
                          row.is_analytic ? "" : "font-medium"
                        }`}
                      >
                        <TableCell className={cellPad}>
                          <Checkbox
                            checked={selected.has(row.id)}
                            aria-label={`Selecionar ${row.reduced_code}`}
                            onCheckedChange={() => toggleRow(row.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className={`${cellPad} truncate font-mono text-xs`}>
                          {row.reduced_code}
                        </TableCell>
                        <TableCell className={`${cellPad} truncate font-mono text-xs`}>
                          {row.hierarchical_code ?? "—"}
                        </TableCell>
                        <TableCell className={`${cellPad} truncate`}>
                          <span
                            style={{ paddingLeft: `${Math.max(0, (row.level ?? 1) - 1) * 10}px` }}
                            className="block truncate"
                          >
                            {row.name}
                          </span>
                        </TableCell>
                        <TableCell className={`${cellPad} truncate text-xs`}>
                          {row.is_analytic ? "Analítica" : "Sintética"}
                        </TableCell>
                        <TableCell className={`${cellPad} truncate`}>
                          <NatureChip nature={row.nature} />
                        </TableCell>
                        <TableCell className={`${cellPad} truncate text-right tabular-nums`}>
                          {row.legs_count}
                        </TableCell>
                        <TableCell className={`${cellPad} truncate`}>
                          <Badge variant={row.is_active ? "secondary" : "outline"}>
                            {row.is_active ? "Ativa" : "Inativa"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
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
                    disabled={(page + 1) * PAGE_SIZE >= (grid.data?.total ?? 0)}
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

      <Card className="sticky bottom-4">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <Button
            size="sm"
            disabled={!isAdmin}
            onClick={() => {
              setForm(emptyForm);
              setMode("form");
            }}
          >
            <Plus className="mr-2 size-4" />
            Nova conta
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isAdmin || !single}
            onClick={() => {
              if (!single) return;
              setForm({
                id: single.id,
                reduced_code: single.reduced_code,
                hierarchical_code: single.hierarchical_code ?? "",
                name: single.name,
                is_analytic: single.is_analytic,
                nature: single.nature ?? "",
              });
              setMode("form");
            }}
          >
            <Pencil className="mr-2 size-4" />
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isAdmin || !single || activeMutation.isPending}
            onClick={() =>
              single && activeMutation.mutate({ id: single.id, active: !single.is_active })
            }
          >
            <Power className="mr-2 size-4" />
            {single && !single.is_active ? "Reativar" : "Desativar"}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {isAdmin
              ? selected.size > 0
                ? `${selected.size} selecionada(s) — use a reclassificação em lote acima.`
                : "Clique para selecionar; duplo clique abre a conta."
              : "Somente administradores editam o plano de contas."}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
