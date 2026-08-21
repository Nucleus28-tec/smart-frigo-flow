/**
 * Linha do demonstrativo com drill-down hierárquico.
 * Expande a árvore do plano de contas até a conta analítica; clicar na conta
 * abre o painel de lançamentos do razão já filtrado nela. Pelo menu de ações
 * é possível reclassificar a conta ou ocultá-la inteira do resultado.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Eye, EyeOff, ListTree, MoreVertical, Shuffle } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReclassificarContaDialog } from "@/components/demonstrativos/ReclassificarContaDialog";
import { getStatementTree, type StatementTreeNode } from "@/lib/reports.functions";
import { setAccountExcluded } from "@/lib/razao.functions";
import { formatCurrency } from "@/lib/rotta";

export type StatementLine = {
  label: string;
  value: number;
  kind?: string;
  nature?: string;
  base?: string;
  codes?: string[];
};

type TreeNode = StatementTreeNode & { children: TreeNode[] };

function buildTree(nodes: StatementTreeNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const node of nodes) map.set(node.codigo, { ...node, children: [] });
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parent ? map.get(node.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.codigo.localeCompare(b.codigo));
    list.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

/** Todos os códigos reduzidos analíticos abaixo de um nó. */
function collectCodes(node: TreeNode): string[] {
  if (node.is_analytic) return node.reduced_code ? [node.reduced_code] : [];
  return node.children.flatMap(collectCodes);
}

type NodeActions = {
  onReclassify: (reducedCode: string, nome: string) => void;
  onToggleHidden: (codes: string[], nome: string, hide: boolean) => void;
  canEdit: boolean;
  large: boolean;
};

function NodeRow({
  node,
  depth,
  onOpen,
  actions,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (codes: string[], label: string) => void;
  actions: NodeActions;
}) {
  const [open, setOpen] = useState(depth < 1);
  const label = `${node.codigo} · ${node.nome}`;
  const text = actions.large ? "text-sm" : "text-xs";
  const pad = actions.large ? 18 : 14;
  const icon = actions.large ? "h-4 w-4" : "h-3 w-3";
  const hiddenCount = node.hidden_count ?? 0;
  const totalCount = node.total_count ?? 0;
  const fullyHidden = hiddenCount > 0 && hiddenCount === totalCount;

  if (node.is_analytic) {
    return (
      <div
        className={`group flex items-center justify-between gap-2 rounded-md px-2 py-1 ${text} transition-colors hover:bg-accent/60`}
        style={{ paddingLeft: 8 + depth * pad }}
      >
        <button
          type="button"
          onClick={() => onOpen(node.reduced_code ? [node.reduced_code] : [], label)}
          title="Abrir os lançamentos desta conta"
          className={`flex min-w-0 flex-1 items-center gap-1 truncate text-left ${
            fullyHidden ? "text-muted-foreground line-through" : ""
          }`}
        >
          <span className="truncate">
            <span className="text-muted-foreground">{node.reduced_code}</span> {node.nome}
          </span>
          {hiddenCount > 0 ? (
            <EyeOff className={`${icon} shrink-0 text-amber-600 dark:text-amber-400`} />
          ) : null}
        </button>
        <span className="shrink-0 tabular-nums">{formatCurrency(node.valor)}</span>
        {actions.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Ações da conta"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <MoreVertical className={icon} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onOpen(node.reduced_code ? [node.reduced_code] : [], label)}
              >
                <ListTree className="mr-2 h-4 w-4" /> Abrir lançamentos
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => node.reduced_code && actions.onReclassify(node.reduced_code, node.nome)}
              >
                <Shuffle className="mr-2 h-4 w-4" /> Reclassificar conta
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  actions.onToggleHidden(
                    node.reduced_code ? [node.reduced_code] : [],
                    node.nome,
                    !fullyHidden,
                  )
                }
              >
                {fullyHidden ? (
                  <>
                    <Eye className="mr-2 h-4 w-4" /> Reexibir no resultado
                  </>
                ) : (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" /> Ocultar do resultado
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div
        className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 ${text} hover:bg-muted/60`}
        style={{ paddingLeft: 4 + depth * pad }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
        >
          {open ? (
            <ChevronDown className={`${icon} shrink-0`} />
          ) : (
            <ChevronRight className={`${icon} shrink-0`} />
          )}
          <span className="truncate">
            <span className="text-muted-foreground">{node.codigo}</span> {node.nome}
          </span>
        </button>
        <span className="shrink-0 tabular-nums font-medium">{formatCurrency(node.valor)}</span>
        <button
          type="button"
          title="Abrir todos os lançamentos deste grupo"
          onClick={() => onOpen(collectCodes(node), label)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ListTree className={icon} />
        </button>
        {actions.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Ações do grupo"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <MoreVertical className={icon} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => actions.onToggleHidden(collectCodes(node), node.nome, true)}
              >
                <EyeOff className="mr-2 h-4 w-4" /> Ocultar grupo do resultado
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => actions.onToggleHidden(collectCodes(node), node.nome, false)}
              >
                <Eye className="mr-2 h-4 w-4" /> Reexibir grupo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {open
        ? node.children.map((child) => (
            <NodeRow
              key={child.codigo}
              node={child}
              depth={depth + 1}
              onOpen={onOpen}
              actions={actions}
            />
          ))
        : null}
    </div>
  );
}

export function LinhaHierarquica({
  periodId,
  line,
  onOpen,
  canEdit = false,
  large = false,
  open: openProp,
  onOpenChange,
}: {
  periodId: string;
  line: StatementLine;
  onOpen: (codes: string[], label: string, base?: string) => void;
  canEdit?: boolean;
  large?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (value: boolean) => {
    setOpenState(value);
    onOpenChange?.(value);
  };
  const queryClient = useQueryClient();
  const runTree = useServerFn(getStatementTree);
  const hideAccount = useServerFn(setAccountExcluded);
  const codes = line.codes ?? [];
  const isTotal = line.kind === "total" || line.kind === "subtotal";
  const [reclass, setReclass] = useState<{ code: string; name: string } | null>(null);

  const treeQuery = useQuery({
    queryKey: ["statement_tree", periodId, codes.join(","), line.base ?? "movimento"],
    enabled: open && codes.length > 0,
    queryFn: async () =>
      (await runTree({
        data: {
          period_id: periodId,
          codes,
          basis: line.base === "saldo" ? "saldo" : "movimento",
        },
      })) as unknown as { nodes: StatementTreeNode[] },
  });

  const tree = useMemo(() => buildTree(treeQuery.data?.nodes ?? []), [treeQuery.data]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["statement_tree"] });
    void queryClient.invalidateQueries({ queryKey: ["hidden_summary"] });
    void queryClient.invalidateQueries({ queryKey: ["financial_statements"] });
    void queryClient.invalidateQueries({ queryKey: ["period_summary"] });
  }

  const hideMutation = useMutation({
    mutationFn: (input: { codes: string[]; hide: boolean; motivo: string }) =>
      hideAccount({
        data: {
          period_id: periodId,
          codes: input.codes,
          excluded: input.hide,
          motivo: input.motivo,
        },
      }),
    onSuccess: (result, input) => {
      toast.success(
        `${result.updated} lançamento(s) ${input.hide ? "ocultos" : "reexibidos"}. Gere os demonstrativos para atualizar os totais.`,
      );
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleHidden(nodeCodes: string[], nome: string, hide: boolean) {
    if (nodeCodes.length === 0) {
      toast.error("Nenhuma conta analítica nesta seleção.");
      return;
    }
    const motivo = hide
      ? (window.prompt(`Motivo para ocultar “${nome}” do resultado:`, "") ?? null)
      : "";
    if (hide && motivo === null) return;
    hideMutation.mutate({ codes: nodeCodes, hide, motivo: motivo ?? "" });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Abrir a hierarquia de contas desta linha"
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground ${
          large ? "text-base" : "text-sm"
        } ${isTotal ? "bg-muted font-semibold" : "text-muted-foreground"}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{line.label}</span>
        </span>
        <span className={Number(line.value) < 0 ? "text-destructive tabular-nums" : "tabular-nums"}>
          {formatCurrency(line.value)}
        </span>
      </button>

      {open ? (
        <div className="my-1 space-y-0.5 rounded-md border border-border bg-muted/20 py-1">
          {treeQuery.isLoading ? (
            <div className="space-y-1 px-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : treeQuery.isError ? (
            <p className="px-3 py-1 text-xs text-destructive">
              {(treeQuery.error as Error)?.message}
            </p>
          ) : tree.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground">
              Sem contas com movimento nesta linha.
            </p>
          ) : (
            tree.map((node) => (
              <NodeRow
                key={node.codigo}
                node={node}
                depth={0}
                onOpen={(nodeCodes, label) => onOpen(nodeCodes, label, line.base)}
                actions={{
                  canEdit,
                  large,
                  onReclassify: (code, name) => setReclass({ code, name }),
                  onToggleHidden: toggleHidden,
                }}
              />
            ))
          )}
        </div>
      ) : null}

      {reclass ? (
        <ReclassificarContaDialog
          periodId={periodId}
          open={!!reclass}
          reducedCode={reclass.code}
          accountName={reclass.name}
          onOpenChange={(value) => {
            if (!value) setReclass(null);
          }}
          onMoved={refresh}
        />
      ) : null}
    </div>
  );
}
