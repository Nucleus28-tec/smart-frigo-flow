/**
 * Árvore do plano de contas: visão hierárquica com saldo agregado do período,
 * movimentação de contas entre grupos (com prévia "de → para"), promoção
 * sintética ↔ analítica, renumeração de ramo, painel de auditoria estrutural
 * e o analista de IA que propõe a reorganização.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderTree,
  Loader2,
  MoveRight,
  Power,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, LoadingRows } from "@/components/PageState";
import { GroupSelect, type GroupOption } from "@/components/razao/GroupSelect";
import {
  PainelLancamentosLinha,
  type LinhaDrill,
  type PanelAccount,
} from "@/components/razao/PainelLancamentosLinha";
import { NATURE_LABEL, NATURE_OPTIONS, formatCurrency } from "@/lib/rotta";
import {
  analyzeChartWithAi,
  createChildAccount,
  decideChartSuggestions,
  getChartAudit,
  getChartTree,
  listChartSuggestions,
  listHiddenAccounts,
  moveChartAccounts,
  renumberChartBranch,
  setChartAccountActive,
  setChartAccountKind,
  type ChartAuditItem,
  type ChartMovePreview,
  type ChartSuggestionRow,
  type ChartTreeRow,
} from "@/lib/razao.functions";

type Props = { periodId: string | null; isAdmin: boolean };

type TreeNode = ChartTreeRow & { children: TreeNode[]; depth: number };

const AUDIT_SECTIONS: { key: string; label: string; hint: string }[] = [
  {
    key: "sem_posicao",
    label: "Contas sem posição na árvore",
    hint: "Vieram de importação e ainda não têm código hierárquico — mova-as para o grupo correto.",
  },
  {
    key: "orfas",
    label: "Contas órfãs",
    hint: "O grupo pai não existe mais no plano.",
  },
  {
    key: "sinteticas_sem_filhas",
    label: "Sintéticas sem filhas",
    hint: "Grupos vazios: rebaixe para analítica ou remova do plano.",
  },
  {
    key: "natureza_incoerente",
    label: "Natureza incoerente com o código",
    hint: "A natureza gravada não corresponde ao grupo hierárquico da conta.",
  },
  {
    key: "analiticas_sem_lancamento",
    label: "Analíticas sem lançamento",
    hint: "Contas que nunca receberam movimento — candidatas a desativação.",
  },
];

function buildTree(rows: ChartTreeRow[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    if (row.hierarchical_code) {
      nodes.set(row.hierarchical_code, { ...row, children: [], depth: 0 });
    }
  }
  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = row.hierarchical_code
      ? nodes.get(row.hierarchical_code)!
      : { ...row, children: [], depth: 0 };
    const parent = row.parent_code ? nodes.get(row.parent_code) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (list: TreeNode[], depth: number) => {
    for (const n of list) {
      n.depth = depth;
      n.children.sort((a, b) =>
        (a.hierarchical_code ?? a.reduced_code).localeCompare(
          b.hierarchical_code ?? b.reduced_code,
          "pt-BR",
          { numeric: true },
        ),
      );
      setDepth(n.children, depth + 1);
    }
  };
  roots.sort((a, b) =>
    (a.hierarchical_code ?? "zzz" + a.reduced_code).localeCompare(
      b.hierarchical_code ?? "zzz" + b.reduced_code,
      "pt-BR",
      { numeric: true },
    ),
  );
  setDepth(roots, 0);
  return roots;
}

function flatten(nodes: TreeNode[], expanded: Set<string>, out: TreeNode[] = []): TreeNode[] {
  for (const node of nodes) {
    out.push(node);
    const key = node.hierarchical_code ?? node.id;
    if (node.children.length > 0 && expanded.has(key)) flatten(node.children, expanded, out);
  }
  return out;
}

const KIND_LABEL: Record<string, string> = {
  mover: "Mover de grupo",
  natureza: "Ajustar natureza",
  tipo_conta: "Sintética / analítica",
};

export function PlanoDeContasArvore({ periodId, isAdmin }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [nature, setNature] = useState("todas");
  const [onlyPending, setOnlyPending] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [preview, setPreview] = useState<ChartMovePreview[] | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiChosen, setAiChosen] = useState<Set<string>>(new Set());
  /** Conta aberta no painel lateral de lançamentos. */
  const [openAccount, setOpenAccount] = useState<
    { drill: LinhaDrill; account: PanelAccount } | null
  >(null);

  const fetchTree = useServerFn(getChartTree);
  const fetchAudit = useServerFn(getChartAudit);
  const fetchSuggestions = useServerFn(listChartSuggestions);
  const fetchHidden = useServerFn(listHiddenAccounts);
  const move = useServerFn(moveChartAccounts);
  const setKind = useServerFn(setChartAccountKind);
  const renumber = useServerFn(renumberChartBranch);
  const analyze = useServerFn(analyzeChartWithAi);
  const decide = useServerFn(decideChartSuggestions);
  const createGroup = useServerFn(createChildAccount);

  const hidden = useQuery({
    queryKey: ["hidden_accounts", periodId],
    enabled: Boolean(periodId),
    queryFn: () => fetchHidden({ data: { period_id: periodId! } }),
  });

  const hiddenCodes = useMemo(
    () => new Set((hidden.data ?? []).map((h) => h.reduced_code)),
    [hidden.data],
  );


  const tree = useQuery({
    queryKey: ["chart_tree", periodId, applied, nature, onlyPending],
    queryFn: () =>
      fetchTree({
        data: {
          period_id: periodId,
          query: applied.trim() ? applied.trim() : null,
          nature: nature === "todas" ? null : nature,
          only_pending: onlyPending,
        },
      }),
  });

  const audit = useQuery({
    queryKey: ["chart_audit"],
    enabled: auditOpen,
    queryFn: () => fetchAudit({}),
  });

  const suggestions = useQuery({
    queryKey: ["chart_suggestions"],
    enabled: aiOpen,
    queryFn: () => fetchSuggestions({ data: { status: "pendente" } }),
  });

  const rows = useMemo(() => tree.data?.rows ?? [], [tree.data]);
  const roots = useMemo(() => buildTree(rows), [rows]);

  const autoExpanded = useMemo(() => {
    if (!applied.trim() && !onlyPending) return expanded;
    const next = new Set(expanded);
    for (const row of rows) if (row.hierarchical_code) next.add(row.hierarchical_code);
    return next;
  }, [expanded, applied, onlyPending, rows]);

  const visible = useMemo(() => flatten(roots, autoExpanded), [roots, autoExpanded]);

  /** Abre o razão da conta clicada: analítica usa o próprio código, grupo usa o ramo. */
  function openAccountPanel(node: TreeNode) {
    const codes = analyticCodes(node);
    setOpenAccount({
      drill: {
        label: `${node.hierarchical_code ?? node.reduced_code} — ${node.name}`,
        codes,
        from: null,
        to: null,
        kind: "razao",
      },
      account: {
        reduced_code: node.is_analytic ? node.reduced_code : null,
        name: node.name,
        codes,
      },
    });
  }


  const groups = useMemo(
    () =>
      rows
        .filter((r) => !r.is_analytic && r.hierarchical_code)
        .sort((a, b) => (a.hierarchical_code ?? "").localeCompare(b.hierarchical_code ?? "")),
    [rows],
  );

  const groupOptions = useMemo<GroupOption[]>(
    () =>
      groups.map((g) => ({
        hierarchical_code: g.hierarchical_code as string,
        name: g.name,
        level: g.level,
      })),
    [groups],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["chart_tree"] });
    void queryClient.invalidateQueries({ queryKey: ["chart_audit"] });
    void queryClient.invalidateQueries({ queryKey: ["chart_accounts_grid"] });
    void queryClient.invalidateQueries({ queryKey: ["period_summary"] });
  };

  const previewMutation = useMutation({
    mutationFn: () =>
      move({
        data: { ids: [...selected], parent_code: moveTarget, dry_run: true },
      }),
    onSuccess: (result) => setPreview(result.preview ?? []),
    onError: (error: Error) => toast.error(error.message),
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      move({ data: { ids: [...selected], parent_code: moveTarget, dry_run: false } }),
    onSuccess: (result) => {
      invalidate();
      setMoveOpen(false);
      setPreview(null);
      setSelected(new Set());
      toast.success(
        `${result.moved} conta(s) movida(s). ${result.periods_recalculated ?? 0} período(s) recalculado(s).`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createGroupMutation = useMutation({
    mutationFn: (vars: { parent_code: string; name: string }) =>
      createGroup({ data: vars }),
    onSuccess: (result) => {
      invalidate();
      setNewGroupName("");
      setPreview(null);
      setMoveTarget(result.hierarchical_code);
      toast.success(`Grupo ${result.hierarchical_code} — ${result.name} criado.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const kindMutation = useMutation({
    mutationFn: (vars: { id: string; is_analytic: boolean }) => setKind({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Tipo da conta atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const renumberMutation = useMutation({
    mutationFn: (parent: string) => renumber({ data: { parent_code: parent } }),
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.renumbered} conta(s) renumerada(s).`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const activeMutation = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      setChartAccountActive({ data: { id: vars.id, active: vars.active } }),
    onSuccess: (result) => {
      invalidate();
      toast.success(result.is_active ? "Conta reativada." : "Conta desativada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyze({ data: { ids: [...selected], limit: 60 } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["chart_suggestions"] });
      setAiOpen(true);
      toast.success(
        `${result.analyzed} conta(s) analisada(s) — ${result.created} nova(s) sugestão(ões).`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const decideMutation = useMutation({
    mutationFn: (vars: { ids: string[]; decision: "aplicada" | "rejeitada" }) =>
      decide({ data: vars }),
    onSuccess: (result) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["chart_suggestions"] });
      setAiChosen(new Set());
      if (result.failures.length > 0) {
        toast.warning(
          `${result.decided} aplicada(s). Falhas: ${result.failures
            .map((f) => `${f.reduced_code} — ${f.message}`)
            .join(" | ")}`,
        );
      } else {
        toast.success(`${result.decided} sugestão(ões) processada(s).`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () =>
    setExpanded(new Set(rows.filter((r) => r.hierarchical_code).map((r) => r.hierarchical_code!)));

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const singleSelected = selectedRows.length === 1 ? selectedRows[0] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setApplied(search);
            }}
            placeholder="Buscar por código ou descrição"
            className="w-72 pl-8"
          />
        </div>
        <Button variant="secondary" onClick={() => setApplied(search)}>
          Buscar
        </Button>
        {applied ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setApplied("");
            }}
          >
            <X className="mr-1 size-4" /> Limpar
          </Button>
        ) : null}

        <Select value={nature} onValueChange={setNature}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as naturezas</SelectItem>
            {NATURE_OPTIONS.map((n) => (
              <SelectItem key={n} value={n}>
                {NATURE_LABEL[n]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyPending} onCheckedChange={(v) => setOnlyPending(Boolean(v))} />
          Somente pendências
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>
            <FolderTree className="mr-1 size-4" /> Expandir tudo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
            Recolher
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAuditOpen(true)}>
            <ShieldAlert className="mr-1 size-4" /> Auditoria
          </Button>
          {isAdmin ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={analyzeMutation.isPending}
                onClick={() => analyzeMutation.mutate()}
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-4" />
                )}
                Analisar com IA
              </Button>
              <Button
                size="sm"
                disabled={selected.size === 0}
                onClick={() => {
                  setPreview(null);
                  setMoveOpen(true);
                }}
              >
                <MoveRight className="mr-1 size-4" /> Mover ({selected.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!singleSelected || kindMutation.isPending}
                onClick={() =>
                  singleSelected &&
                  kindMutation.mutate({
                    id: singleSelected.id,
                    is_analytic: !singleSelected.is_analytic,
                  })
                }
              >
                {singleSelected && !singleSelected.is_analytic
                  ? "Rebaixar a analítica"
                  : "Promover a sintética"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !singleSelected || singleSelected.is_analytic || renumberMutation.isPending
                }
                onClick={() =>
                  singleSelected?.hierarchical_code &&
                  renumberMutation.mutate(singleSelected.hierarchical_code)
                }
              >
                Renumerar ramo
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!singleSelected || activeMutation.isPending}
                onClick={() =>
                  singleSelected &&
                  activeMutation.mutate({ id: singleSelected.id, active: !singleSelected.is_active })
                }
              >
                {activeMutation.isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Power className="mr-1 size-4" />
                )}
                {singleSelected?.is_active ? "Desativar" : "Reativar"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {tree.isLoading ? (
        <LoadingRows />
      ) : tree.isError ? (
        <ErrorState message={(tree.error as Error).message} onRetry={() => void tree.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nenhuma conta encontrada"
          description="Ajuste a busca ou os filtros para ver outras contas do plano."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-10 px-2 py-2" />
                    <th className="px-2 py-2">Conta</th>
                    <th className="w-[150px] px-2 py-2">Reduzido</th>
                    <th className="w-[110px] px-2 py-2">Tipo</th>
                    <th className="w-[180px] px-2 py-2">Natureza</th>
                    <th className="w-[90px] px-2 py-2 text-right">Lçtos.</th>
                    <th className="w-[150px] px-2 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((node) => {
                    const key = node.hierarchical_code ?? node.id;
                    const isOpen = autoExpanded.has(key);
                    const pending =
                      !node.hierarchical_code || !node.nature || !node.parent_code;
                    return (
                      <tr
                        key={node.id}
                        className={`border-t transition-colors hover:bg-accent/40 ${
                          selected.has(node.id) ? "bg-accent/50" : ""
                        }`}
                      >
                        <td className="px-2 py-1.5 align-middle">
                          <Checkbox
                            checked={selected.has(node.id)}
                            onCheckedChange={() => toggleSelect(node.id)}
                            aria-label={`Selecionar ${node.name}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div
                            className="flex items-center gap-1"
                            style={{ paddingLeft: node.depth * 16 }}
                          >
                            {node.children.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(key)}
                                className="rounded p-0.5 hover:bg-accent"
                                aria-label={isOpen ? "Recolher" : "Expandir"}
                              >
                                {isOpen ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                            ) : (
                              <span className="inline-block w-5" />
                            )}
                            {node.is_analytic ? null : (
                              <Folder className="size-3.5 text-muted-foreground" />
                            )}
                            <span className="font-mono text-xs text-muted-foreground">
                              {node.hierarchical_code ?? "sem posição"}
                            </span>
                            <span
                              className={node.is_analytic ? "" : "font-semibold"}
                            >
                              {node.name}
                            </span>
                            {pending ? (
                              <Badge variant="destructive" className="ml-1">
                                pendente
                              </Badge>
                            ) : null}
                            {node.is_active ? null : (
                              <Badge variant="outline" className="ml-1">
                                inativa
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs">{node.reduced_code}</td>
                        <td className="px-2 py-1.5 text-xs">
                          {node.is_analytic ? "Analítica" : "Sintética"}
                        </td>
                        <td className="px-2 py-1.5 text-xs">
                          {node.nature ? (NATURE_LABEL[node.nature] ?? node.nature) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-xs">
                          {node.is_analytic ? node.legs_count : ""}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatCurrency(node.balance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mover contas */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mover contas de grupo</DialogTitle>
            <DialogDescription>
              O código reduzido não muda. O código hierárquico e a natureza passam a seguir o grupo
              de destino, junto com todo o ramo abaixo de cada conta selecionada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <GroupSelect
              value={moveTarget}
              onChange={(v) => {
                setMoveTarget(v);
                setPreview(null);
              }}
              groups={groupOptions}
            />

            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                O grupo certo ainda não existe? Crie uma sintética filha do destino selecionado — o
                sistema sugere o próximo código livre do ramo.
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Nome do novo grupo (ex.: FORNECEDORES PECUARISTAS)"
                />
                <Button
                  variant="outline"
                  disabled={
                    !moveTarget || newGroupName.trim().length < 2 || createGroupMutation.isPending
                  }
                  onClick={() =>
                    createGroupMutation.mutate({
                      parent_code: moveTarget,
                      name: newGroupName.trim(),
                    })
                  }
                >
                  {createGroupMutation.isPending ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <FolderPlus className="mr-1 size-4" />
                  )}
                  Criar grupo aqui
                </Button>
              </div>
            </div>

            <Button
              variant="secondary"
              disabled={!moveTarget || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : null}
              Ver prévia
            </Button>

            {preview ? (
              <div className="max-h-64 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr className="text-left">
                      <th className="px-2 py-1.5">Conta</th>
                      <th className="px-2 py-1.5">De</th>
                      <th className="px-2 py-1.5">Para</th>
                      <th className="px-2 py-1.5">Natureza</th>
                      <th className="px-2 py-1.5 text-right">Filhas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-2 py-1.5">
                          <span className="font-mono">{p.reduced_code}</span> {p.name}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{p.de}</td>
                        <td className="px-2 py-1.5 font-mono text-primary">{p.para}</td>
                        <td className="px-2 py-1.5">
                          {(NATURE_LABEL[p.natureza_de ?? ""] ?? "—")} →{" "}
                          {NATURE_LABEL[p.natureza_para ?? ""] ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{p.ramo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!moveTarget || moveMutation.isPending}
              onClick={() => moveMutation.mutate()}
            >
              {moveMutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Mover e recalcular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auditoria estrutural */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Auditoria do plano de contas</DialogTitle>
            <DialogDescription>
              Inconsistências estruturais encontradas na árvore atual.
            </DialogDescription>
          </DialogHeader>
          {audit.isLoading ? (
            <LoadingRows />
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-auto">
              {AUDIT_SECTIONS.map((section) => {
                const list: ChartAuditItem[] = audit.data?.[section.key] ?? [];
                return (
                  <div key={section.key}>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{section.label}</h4>
                      <Badge variant={list.length > 0 ? "destructive" : "secondary"}>
                        {list.length}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{section.hint}</p>
                    {list.length > 0 ? (
                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs">
                        {list.slice(0, 50).map((item, i) => (
                          <li key={i} className="font-mono">
                            {item.reduced_code} {item.hierarchical_code ?? "sem posição"} —{" "}
                            <span className="font-sans">{item.name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sugestões da IA */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Sugestões da IA para o plano de contas</DialogTitle>
            <DialogDescription>
              Nada é aplicado sozinho: escolha as sugestões e confirme. As rejeitadas não voltam a
              ser propostas.
            </DialogDescription>
          </DialogHeader>

          {suggestions.isLoading ? (
            <LoadingRows />
          ) : (suggestions.data ?? []).length === 0 ? (
            <EmptyState
              title="Nenhuma sugestão pendente"
              description="Use 'Analisar com IA' para gerar propostas de reorganização."
            />
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="text-left">
                    <th className="w-10 px-2 py-1.5" />
                    <th className="px-2 py-1.5">Conta</th>
                    <th className="px-2 py-1.5">Ação</th>
                    <th className="px-2 py-1.5">De → Para</th>
                    <th className="px-2 py-1.5">Justificativa</th>
                    <th className="px-2 py-1.5 text-right">Confiança</th>
                  </tr>
                </thead>
                <tbody>
                  {((suggestions.data ?? []) as ChartSuggestionRow[]).map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <Checkbox
                          checked={aiChosen.has(s.id)}
                          onCheckedChange={() =>
                            setAiChosen((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) next.delete(s.id);
                              else next.add(s.id);
                              return next;
                            })
                          }
                          aria-label={`Selecionar sugestão de ${s.reduced_code}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono">{s.reduced_code}</span> {s.account_name}
                      </td>
                      <td className="px-2 py-1.5">{KIND_LABEL[s.kind] ?? s.kind}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {s.current_value ?? "—"} → <span className="text-primary">{s.suggested_value}</span>
                      </td>
                      <td className="px-2 py-1.5">{s.reasoning}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {Math.round(Number(s.confidence) * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={aiChosen.size === 0 || decideMutation.isPending || !isAdmin}
              onClick={() =>
                decideMutation.mutate({ ids: [...aiChosen], decision: "rejeitada" })
              }
            >
              Rejeitar ({aiChosen.size})
            </Button>
            <Button
              disabled={aiChosen.size === 0 || decideMutation.isPending || !isAdmin}
              onClick={() => decideMutation.mutate({ ids: [...aiChosen], decision: "aplicada" })}
            >
              {decideMutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Aplicar ({aiChosen.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
