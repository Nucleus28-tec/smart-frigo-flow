import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, NATURE_LABEL } from "@/lib/rotta";
import { useConferencia } from "@/lib/conferencia";

/**
 * Pendências estruturais do plano de contas detectadas no razão:
 * contas de Passivo/PL cuja abertura é desproporcional à movimentação do período.
 */
export function PendenciasPlanoContas({ periodId }: { periodId: string | null }) {
  const { data, isLoading } = useConferencia(periodId);

  if (!periodId) return null;
  if (isLoading) return <Skeleton className="mb-4 h-24 w-full" />;
  if (!data || data.pendencias.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-500/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          Pendências do plano de contas
          <Badge variant="secondary">{data.pendencias.length}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Contas com saldo de abertura desproporcional ao grupo — hoje respondem por parte da
          diferença de {formatCurrency(data.delta)} entre Ativo e Passivo + PL.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Natureza</TableHead>
              <TableHead className="text-right">Abertura</TableHead>
              <TableHead className="text-right">Movimento</TableHead>
              <TableHead className="text-right">% do grupo</TableHead>
              <TableHead>Causa provável / ação sugerida</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.pendencias.map((p) => (
              <TableRow key={p.reduced_code}>
                <TableCell className="font-medium">
                  {p.reduced_code} · {p.account_name}
                </TableCell>
                <TableCell>{NATURE_LABEL[p.nature ?? ""] ?? "Sem natureza"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(p.opening_balance)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(p.movimento)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(p.share * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="max-w-[420px] text-xs text-muted-foreground">
                  <p>{p.causa}</p>
                  <p className="mt-1 font-medium text-foreground">{p.acao}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
