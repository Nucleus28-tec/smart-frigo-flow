import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPeriodHealth, type PeriodHealth, type PeriodHealthItem } from "@/lib/periodo.functions";
import { formatCurrency } from "@/lib/rotta";

function num(v: unknown) {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function Bloco({
  titulo,
  descricao,
  total,
  items,
  colunas,
}: {
  titulo: string;
  descricao: string;
  total: number;
  items: PeriodHealthItem[];
  colunas: { key: string; label: string; moeda?: boolean }[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {total > 0 ? (
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className="text-sm font-medium">{titulo}</span>
        <Badge variant={total > 0 ? "destructive" : "secondary"}>
          {total > 0 ? `${total} divergência(s)` : "conforme"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{descricao}</p>
      {items.length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {colunas.map((c) => (
                  <TableHead key={c.key} className={c.moeda ? "text-right" : undefined}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => (
                <TableRow key={i}>
                  {colunas.map((c) => (
                    <TableCell
                      key={c.key}
                      className={c.moeda ? "text-right tabular-nums" : undefined}
                    >
                      {c.moeda ? formatCurrency(num(item[c.key])) : String(item[c.key] ?? "—")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

/** Conferência pós-importação: reconciliação, lacunas, âncoras e cadeia. */
export function PainelSaudePeriodo({ periodId }: { periodId: string }) {
  const fetchHealth = useServerFn(getPeriodHealth);
  const query = useQuery({
    queryKey: ["period_health", periodId],
    queryFn: async (): Promise<PeriodHealth> => fetchHealth({ data: { period_id: periodId } }),
  });

  const h = query.data;
  if (query.isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Conferindo a saúde do período…
        </CardContent>
      </Card>
    );
  }
  if (query.error) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center justify-between pt-6 text-sm">
          <span className="text-muted-foreground">
            Não foi possível conferir o período: {(query.error as Error).message}
          </span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!h || h.legs === 0) return null;

  const total = h.reconciliation.total + h.gaps.total + h.anchors.total + h.chain.total;

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">
          Conferência do período{" "}
          <Badge className="ml-2" variant={total > 0 ? "destructive" : "secondary"}>
            {total > 0 ? `${total} ponto(s) de atenção` : "tudo conforme"}
          </Badge>
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Reconferir
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <Bloco
          titulo="Reconciliação razão × saldos"
          descricao="Saldo esperado (abertura + débitos − créditos) contra o saldo gravado em cada conta."
          total={h.reconciliation.total}
          items={h.reconciliation.items}
          colunas={[
            { key: "conta", label: "Conta" },
            { key: "saldo_esperado", label: "Esperado", moeda: true },
            { key: "saldo_gravado", label: "Gravado", moeda: true },
            { key: "diferenca", label: "Diferença", moeda: true },
          ]}
        />
        <Bloco
          titulo="Linhas perdidas na importação"
          descricao="Quebras na sequência do razão do G2 — indica linhas que não entraram no arquivo lido."
          total={h.gaps.total}
          items={h.gaps.items}
          colunas={[
            { key: "conta", label: "Conta" },
            { key: "linhas_perdidas", label: "Linhas" },
            { key: "valor_perdido", label: "Valor", moeda: true },
            { key: "primeiro_doc_apos_lacuna", label: "1º doc. após" },
          ]}
        />
        <Bloco
          titulo="Sinal das âncoras (saldo anterior)"
          descricao="Natureza da conta contra o lado do saldo de abertura importado."
          total={h.anchors.total}
          items={h.anchors.items}
          colunas={[
            { key: "conta", label: "Conta" },
            { key: "nature", label: "Natureza" },
            { key: "lado_esperado", label: "Esperado" },
            { key: "lado_gravado", label: "Gravado" },
            { key: "opening_balance", label: "Abertura", moeda: true },
          ]}
        />
        <Bloco
          titulo="Continuidade entre meses"
          descricao="Saldo de fechamento de um mês contra a abertura do mês seguinte."
          total={h.chain.total}
          items={h.chain.items}
          colunas={[
            { key: "conta", label: "Conta" },
            { key: "fecha_em", label: "Fecha em" },
            { key: "abre_em", label: "Abre em" },
            { key: "fechamento", label: "Fechamento", moeda: true },
            { key: "abertura_seguinte", label: "Abertura", moeda: true },
            { key: "diferenca", label: "Diferença", moeda: true },
          ]}
        />
      </CardContent>
    </Card>
  );
}
