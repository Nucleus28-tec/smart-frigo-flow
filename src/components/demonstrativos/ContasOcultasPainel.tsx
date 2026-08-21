import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listHiddenAccounts, setAccountExcluded } from "@/lib/razao.functions";
import { generateStatements } from "@/lib/reports.functions";
import { formatCurrency } from "@/lib/rotta";

/** Lista as contas ocultas do período e permite reexibi-las (desocultação). */
export function ContasOcultasPainel({
  periodId,
  canEdit,
}: {
  periodId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const listHidden = useServerFn(listHiddenAccounts);
  const unhide = useServerFn(setAccountExcluded);
  const regenerate = useServerFn(generateStatements);

  const query = useQuery({
    queryKey: ["hidden_accounts", periodId],
    enabled: !!periodId,
    queryFn: async () => listHidden({ data: { period_id: periodId } }),
  });

  const unhideMutation = useMutation({
    mutationFn: async (codes: string[]) => {
      const result = await unhide({
        data: { period_id: periodId, codes, excluded: false, motivo: "" },
      });
      await regenerate({ data: { period_id: periodId } });
      return result;
    },
    onSuccess: () => {
      toast.success("Conta reexibida e demonstrativos recalculados.");
      void queryClient.invalidateQueries({ queryKey: ["hidden_accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["hidden_summary"] });
      void queryClient.invalidateQueries({ queryKey: ["statement_tree"] });
      void queryClient.invalidateQueries({ queryKey: ["financial_statements"] });
      void queryClient.invalidateQueries({ queryKey: ["period_summary"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <EyeOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Contas ocultas do período ({rows.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Estas contas — saldo de abertura e movimento — estão fora da DRE, do Balanço, do Fluxo de
          Caixa e dos indicadores. Reexibir devolve tudo ao cálculo.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.reduced_code}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.reduced_code} · {row.account_name}
              </p>
              <p className="text-xs text-muted-foreground">
                abertura {formatCurrency(row.opening_balance)} · {row.hidden_legs} lançamento(s)
                oculto(s) · por {row.excluded_by_name} em{" "}
                {new Date(row.excluded_at).toLocaleDateString("pt-BR")}
                {row.motivo ? ` · motivo: ${row.motivo}` : ""}
              </p>
            </div>
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                disabled={unhideMutation.isPending}
                onClick={() => unhideMutation.mutate([row.reduced_code])}
              >
                <Eye className="mr-2 h-4 w-4" />
                Reexibir
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
