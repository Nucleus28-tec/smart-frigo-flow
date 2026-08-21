/**
 * Linha do demonstrativo com drill-down hierárquico.
 * Expande a árvore do plano de contas até a conta analítica; clicar na conta
 * abre o painel de lançamentos do razão já filtrado nela.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, ListTree } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { getStatementTree, type StatementTreeNode } from "@/lib/reports.functions";
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

function NodeRow({
  node,
  depth,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (codes: string[], label: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const label = `${node.codigo} · ${node.nome}`;

  if (node.is_analytic) {
    return (
      <button
        type="button"
        onClick={() => onOpen(node.reduced_code ? [node.reduced_code] : [], label)}
        title="Abrir os lançamentos desta conta"
        className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="truncate">
          <span className="text-muted-foreground">{node.reduced_code}</span> {node.nome}
        </span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {formatCurrency(node.valor)}
          <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
        </span>
      </button>
    );
  }

  return (
    <div>
      <div
        className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/60"
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
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
          <ListTree className="h-3 w-3" />
        </button>
      </div>
      {open
        ? node.children.map((child) => (
            <NodeRow key={child.codigo} node={child} depth={depth + 1} onOpen={onOpen} />
          ))
        : null}
    </div>
  );
}

export function LinhaHierarquica({
  periodId,
  line,
  onOpen,
}: {
  periodId: string;
  line: StatementLine;
  onOpen: (codes: string[], label: string, base?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const runTree = useServerFn(getStatementTree);
  const codes = line.codes ?? [];
  const isTotal = line.kind === "total" || line.kind === "subtotal";

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

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Abrir a hierarquia de contas desta linha"
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
          isTotal ? "bg-muted font-semibold" : "text-muted-foreground"
        }`}
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
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
