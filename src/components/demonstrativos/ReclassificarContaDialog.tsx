/**
 * Reclassificação de uma conta direto do demonstrativo: escolhe o grupo de
 * destino (busca por código ou nome), mostra a prévia e move a conta com todo
 * o ramo abaixo dela, reaproveitando a movimentação hierárquica do plano.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupSelect, type GroupOption } from "@/components/razao/GroupSelect";
import {
  getChartTree,
  moveChartAccounts,
  type ChartMovePreview,
} from "@/lib/razao.functions";

type Props = {
  periodId: string;
  open: boolean;
  reducedCode: string | null;
  accountName: string;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
};

export function ReclassificarContaDialog({
  periodId,
  open,
  reducedCode,
  accountName,
  onOpenChange,
  onMoved,
}: Props) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<ChartMovePreview[] | null>(null);

  const fetchTree = useServerFn(getChartTree);
  const move = useServerFn(moveChartAccounts);

  const tree = useQuery({
    queryKey: ["chart_tree", periodId, "", "todas", false],
    enabled: open,
    queryFn: () =>
      fetchTree({ data: { period_id: periodId, query: null, nature: null, only_pending: false } }),
  });

  const rows = useMemo(() => tree.data?.rows ?? [], [tree.data]);

  const account = useMemo(
    () => rows.find((r) => r.reduced_code === reducedCode) ?? null,
    [rows, reducedCode],
  );

  const groupOptions = useMemo<GroupOption[]>(
    () =>
      rows
        .filter((r) => !r.is_analytic && r.hierarchical_code)
        .map((r) => ({
          hierarchical_code: r.hierarchical_code as string,
          name: r.name,
          level: r.level,
        }))
        .sort((a, b) => a.hierarchical_code.localeCompare(b.hierarchical_code)),
    [rows],
  );

  const previewMutation = useMutation({
    mutationFn: () =>
      move({ data: { ids: [account!.id], parent_code: target, dry_run: true } }),
    onSuccess: (result) => setPreview(result.preview ?? []),
    onError: (error: Error) => toast.error(error.message),
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      move({ data: { ids: [account!.id], parent_code: target, dry_run: false } }),
    onSuccess: (result) => {
      toast.success(
        `${result.moved} conta(s) reclassificada(s). ${result.periods_recalculated ?? 0} período(s) recalculado(s).`,
      );
      void queryClient.invalidateQueries({ queryKey: ["chart_tree"] });
      setPreview(null);
      setTarget("");
      onOpenChange(false);
      onMoved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reclassificar conta</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{reducedCode}</span> {accountName} — o código reduzido não
            muda. O código hierárquico e a natureza passam a seguir o grupo de destino.
          </DialogDescription>
        </DialogHeader>

        {tree.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : !account ? (
          <p className="text-sm text-destructive">
            Conta não encontrada no plano de contas deste período.
          </p>
        ) : (
          <div className="space-y-3">
            <GroupSelect
              value={target}
              onChange={(value) => {
                setTarget(value);
                setPreview(null);
              }}
              groups={groupOptions}
            />

            <Button
              variant="secondary"
              disabled={!target || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : null}
              Ver prévia
            </Button>

            {preview ? (
              <>
                <div className="max-h-64 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr className="text-left">
                        <th className="px-2 py-1.5">Conta</th>
                        <th className="px-2 py-1.5">De</th>
                        <th className="px-2 py-1.5">Para</th>
                        <th className="px-2 py-1.5 text-right">Hoje aparece</th>
                        <th className="px-2 py-1.5 text-right">Vai aparecer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((item) => {
                        const saldo = balanceByCode.get(item.reduced_code) ?? 0;
                        const antes = valorApresentado(saldo, item.natureza_de);
                        const depois = valorApresentado(saldo, item.natureza_para);
                        const virou = antes < 0 && depois > 0;
                        const invertido = depois < 0;
                        return (
                          <tr key={item.id} className="border-t align-top">
                            <td className="px-2 py-1.5">
                              <span className="font-mono">{item.reduced_code}</span> {item.name}
                              {item.ramo > 0 ? (
                                <span className="ml-1 text-muted-foreground">
                                  (+{item.ramo} filha{item.ramo > 1 ? "s" : ""})
                                </span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1.5 font-mono">{item.de}</td>
                            <td className="px-2 py-1.5 font-mono text-primary">{item.para}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {formatCurrency(antes)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              <span className={invertido ? "text-destructive" : "font-medium"}>
                                {formatCurrency(depois)}
                              </span>
                              {invertido ? (
                                <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                  <AlertTriangle className="size-3" /> saldo invertido — confira a
                                  escrituração
                                </span>
                              ) : virou ? (
                                <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                                  <ArrowUpDown className="size-3" /> sinal invertido
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  O sinal muda apenas pela convenção do grupo de destino (passivo e PL mostram o
                  saldo credor como positivo); débito e crédito dos lançamentos não são alterados.
                  Os totais de DRE, Balanço e Fluxo só refletem a mudança após “Gerar
                  demonstrativos”.
                </p>
              </>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!account || !target || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}
          >
            {moveMutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Reclassificar e recalcular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
