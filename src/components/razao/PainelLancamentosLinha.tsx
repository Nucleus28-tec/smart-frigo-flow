/**
 * Painel lateral de lançamentos de uma linha do demonstrativo.
 * Permite editar, reclassificar (trocar contas), ocultar dos relatórios,
 * cancelar e comentar — sem sair da tela de Demonstrativos.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Ban,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountSelect } from "@/components/razao/AccountSelect";
import { ComentariosLancamento } from "@/components/razao/ComentariosLancamento";
import { ReclassificarContaDialog } from "@/components/demonstrativos/ReclassificarContaDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelJournalEntry,
  listLineLegs,
  saveManualJournalEntry,
  setAccountExcluded,
  setLegExcluded,
} from "@/lib/razao.functions";
import { generateStatements } from "@/lib/reports.functions";
import { formatCurrency, parseCurrencyInput } from "@/lib/rotta";

export type LinhaDrill = {
  label: string;
  codes: string[];
  from: string | null;
  to: string | null;
  kind: "razao" | "balancete";
};

type Row = {
  id: string;
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
  excluded_reason: string | null;
  comments: number;
};

type FormState = {
  entry_date: string;
  doc_number: string;
  value: string;
  debit_code: string;
  credit_code: string;
  historico: string;
};

const WIDTH_KEY = "rotta.painel-lancamentos.width";

function formatDate(value: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export type PanelAccount = {
  /** Código reduzido da conta analítica (null para grupos sintéticos). */
  reduced_code: string | null;
  name: string;
  /** Códigos analíticos do ramo, usados para ocultar/reexibir em bloco. */
  codes: string[];
};



export function PainelLancamentosLinha({
  periodId,
  drill,
  canEdit,
  onClose,
  onOpenRazao,
  account = null,
  onAccountChanged,
}: {
  periodId: string;
  drill: LinhaDrill | null;
  canEdit: boolean;
  onClose: () => void;
  onOpenRazao: (drill: LinhaDrill) => void;
  /** Conta do plano aberta no painel: habilita reclassificar e ocultar a conta. */
  account?: PanelAccount | null;
  onAccountChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const runList = useServerFn(listLineLegs);
  const runSave = useServerFn(saveManualJournalEntry);
  const runHide = useServerFn(setLegExcluded);
  const runCancel = useServerFn(cancelJournalEntry);
  const runHideAccount = useServerFn(setAccountExcluded);
  const runRegenerate = useServerFn(generateStatements);

  const [width, setWidth] = useState(620);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [reclassOpen, setReclassOpen] = useState(false);
  const [hideAsk, setHideAsk] = useState(false);
  const [motivo, setMotivo] = useState("");
  const dragging = useRef(false);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= 420) setWidth(saved);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(term), 300);
    return () => window.clearTimeout(t);
  }, [term]);

  useEffect(() => {
    setEditingId(null);
    setTerm("");
  }, [drill?.label, drill?.codes.join(",")]);

  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drill, onClose]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const next = Math.min(Math.max(window.innerWidth - e.clientX, 420), window.innerWidth - 120);
      setWidth(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const accountsQuery = useQuery({
    queryKey: ["panel_accounts"],
    enabled: Boolean(drill),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_accounts")
        .select("reduced_code, name")
        .eq("is_analytic", true)
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Array<{ reduced_code: string; name: string }>;
    },
  });

  const legsQuery = useQuery({
    queryKey: ["line_legs", periodId, drill?.codes.join(","), drill?.from, drill?.to, query, showHidden],
    enabled: Boolean(drill && periodId),
    queryFn: async () => {
      const result = (await runList({
        data: {
          period_id: periodId,
          codes: drill!.codes,
          from: drill!.from,
          to: drill!.to,
          query,
          include_hidden: showHidden,
          limit: 300,
          offset: 0,
        },
      })) as unknown as {
        total: number;
        soma: number;
        ocultos: number;
        soma_oculta: number;
        rows: Row[];
      };
      return result;
    },
  });

  const rows = useMemo(() => legsQuery.data?.rows ?? [], [legsQuery.data]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["line_legs"] });
    void queryClient.invalidateQueries({ queryKey: ["financial_statements"] });
    void queryClient.invalidateQueries({ queryKey: ["conferencia_balanco"] });
    void queryClient.invalidateQueries({ queryKey: ["indicators"] });
    void queryClient.invalidateQueries({ queryKey: ["hidden_summary"] });
    void queryClient.invalidateQueries({ queryKey: ["journal_grid"] });
    void queryClient.invalidateQueries({ queryKey: ["journal_document"] });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !editingId) throw new Error("Nada para gravar.");
      const valor = parseCurrencyInput(form.value);
      if (valor === null || valor <= 0) throw new Error("Valor inválido.");
      if (!form.debit_code || !form.credit_code) throw new Error("Informe as duas contas.");
      if (form.debit_code === form.credit_code)
        throw new Error("Débito e crédito devem ser contas diferentes.");
      if (!form.historico.trim()) throw new Error("Informe o histórico.");
      return runSave({
        data: {
          period_id: periodId,
          leg_id: editingId,
          debit_code: form.debit_code,
          credit_code: form.credit_code,
          entry_date: form.entry_date,
          doc_number: form.doc_number,
          value: valor,
          historico: form.historico.trim(),
        },
      });
    },
    onSuccess: () => {
      toast.success("Lançamento atualizado.");
      setEditingId(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hide = useMutation({
    mutationFn: async (input: { id: string; excluded: boolean; motivo: string }) =>
      runHide({ data: { leg_id: input.id, excluded: input.excluded, motivo: input.motivo } }),
    onSuccess: (_data, input) => {
      toast.success(
        input.excluded
          ? "Lançamento oculto dos relatórios."
          : "Lançamento reexibido nos relatórios.",
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => runCancel({ data: { leg_id: id, motivo: "Cancelado pelo painel de demonstrativos" } }),
    onSuccess: () => {
      toast.success("Lançamento cancelado.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** Oculta ou reexibe todos os lançamentos da conta aberta e recalcula os demonstrativos. */
  const hideAccount = useMutation({
    mutationFn: async (input: { hide: boolean; motivo: string }) => {
      if (!account || account.codes.length === 0)
        throw new Error("Nenhuma conta analítica nesta seleção.");
      const result = await runHideAccount({
        data: {
          period_id: periodId,
          codes: account.codes,
          excluded: input.hide,
          motivo: input.motivo,
        },
      });
      await runRegenerate({ data: { period_id: periodId } });
      return result;
    },
    onSuccess: (result, input) => {
      toast.success(
        `${result.updated} lançamento(s) ${input.hide ? "ocultos" : "reexibidos"}. Demonstrativos recalculados.`,
      );
      setHideAsk(false);
      setMotivo("");
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["chart_tree"] });
      void queryClient.invalidateQueries({ queryKey: ["hidden_accounts"] });
      onAccountChanged?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const totalLegs = legsQuery.data?.total ?? 0;
  const contaOculta = totalLegs > 0 && legsQuery.data?.ocultos === totalLegs;

  if (!drill) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-xl"
      style={{ width }}
      aria-label={`Lançamentos de ${drill.label}`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={() => {
          dragging.current = true;
        }}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize hover:bg-primary/30"
      />

      <header className="space-y-3 border-b border-border p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Lançamentos</p>
            <h2 className="text-base font-semibold">{drill.label}</h2>
            <p className="text-xs text-muted-foreground">
              {drill.codes.length} conta(s) ·{" "}
              {drill.from ? `${formatDate(drill.from)} a ${formatDate(drill.to)}` : "período todo"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="Abrir no razão em nova aba"
              onClick={() => onOpenRazao(drill)}
            >
              <ExternalLink className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Fechar (Esc)" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por documento, histórico ou conta"
              className="h-9 pl-7"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
            <Label htmlFor="show-hidden" className="text-xs">
              Mostrar ocultos
            </Label>
          </div>
        </div>

        {legsQuery.data ? (
          <p className="text-xs text-muted-foreground">
            {legsQuery.data.total} lançamento(s) · considerado no resultado:{" "}
            <strong className="tabular-nums">{formatCurrency(legsQuery.data.soma)}</strong>
            {legsQuery.data.ocultos > 0 ? (
              <>
                {" "}
                · oculto: {legsQuery.data.ocultos} ({formatCurrency(legsQuery.data.soma_oculta)})
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      <div className="flex-1 space-y-2 overflow-auto p-3">
        {legsQuery.isLoading ? (
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        ) : legsQuery.isError ? (
          <p className="text-sm text-destructive">{(legsQuery.error as Error)?.message}</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Nenhum lançamento encontrado para esta linha.
          </p>
        ) : (
          rows.map((row) => {
            const hidden = row.status === "oculto";
            const isEditing = editingId === row.id;
            return (
              <div
                key={row.id}
                className={`rounded-md border px-3 py-2 text-sm ${
                  hidden ? "border-dashed border-amber-500/60 bg-amber-500/5" : "border-border bg-card"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(row.entry_date)}
                        {row.doc_number ? ` · doc ${row.doc_number}` : ""}
                      </span>
                      {hidden ? (
                        <Badge variant="outline" className="border-amber-500 text-amber-600">
                          Oculto{row.excluded_reason ? ` — ${row.excluded_reason}` : ""}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate">
                      <span className="text-amber-600 dark:text-amber-400">
                        D {row.debit_code} {row.debit_name}
                      </span>{" "}
                      <span className="text-muted-foreground">×</span>{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        C {row.credit_code} {row.credit_name}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{row.historico}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className={`tabular-nums font-semibold ${hidden ? "line-through opacity-60" : ""}`}
                    >
                      {formatCurrency(row.valor)}
                    </span>
                    <ComentariosLancamento
                      legId={row.id}
                      periodId={periodId}
                      count={row.comments}
                    />
                    {canEdit ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title="Editar / reclassificar"
                          onClick={() => {
                            setEditingId(isEditing ? null : row.id);
                            setForm({
                              entry_date: (row.entry_date ?? "").slice(0, 10),
                              doc_number: row.doc_number ?? "",
                              value: String(row.valor).replace(".", ","),
                              debit_code: row.debit_code ?? "",
                              credit_code: row.credit_code ?? "",
                              historico: row.historico ?? "",
                            });
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title={hidden ? "Reexibir nos relatórios" : "Ocultar de todos os relatórios"}
                          disabled={hide.isPending}
                          onClick={() => {
                            const motivo = hidden
                              ? ""
                              : window.prompt("Motivo para ocultar este lançamento:") ?? "";
                            if (!hidden && motivo === "") return;
                            hide.mutate({ id: row.id, excluded: !hidden, motivo });
                          }}
                        >
                          {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          title="Cancelar lançamento"
                          disabled={cancel.isPending}
                          onClick={() => {
                            if (window.confirm("Cancelar este lançamento?")) cancel.mutate(row.id);
                          }}
                        >
                          <Ban className="size-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                {isEditing && form ? (
                  <div className="mt-3 grid gap-3 border-t border-border pt-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="grid gap-1">
                        <Label className="text-xs">Data</Label>
                        <Input
                          type="date"
                          value={form.entry_date}
                          onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Documento</Label>
                        <Input
                          value={form.doc_number}
                          onChange={(e) => setForm({ ...form, doc_number: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Valor</Label>
                        <Input
                          inputMode="decimal"
                          value={form.value}
                          onChange={(e) => setForm({ ...form, value: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Conta de débito</Label>
                        <AccountSelect
                          value={form.debit_code}
                          onChange={(v) => setForm({ ...form, debit_code: v })}
                          accounts={accountsQuery.data ?? []}
                          tone="debito"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Conta de crédito</Label>
                        <AccountSelect
                          value={form.credit_code}
                          onChange={(v) => setForm({ ...form, credit_code: v })}
                          accounts={accountsQuery.data ?? []}
                          tone="credito"
                        />
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Histórico</Label>
                      <Input
                        value={form.historico}
                        onChange={(e) => setForm({ ...form, historico: e.target.value })}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                        {save.isPending ? (
                          <Loader2 className="mr-2 size-3.5 animate-spin" />
                        ) : null}
                        Gravar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
