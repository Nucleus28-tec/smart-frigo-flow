import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, NATURE_LABEL } from "@/lib/rotta";
import { useConferencia } from "@/lib/conferencia";

/**
 * Conferência Ativo × (Passivo + PL) derivada do razão.
 * O delta aparece sempre que não fechar — a divergência é denunciada, não escondida.
 */
export function ConferenciaBalanco({
  periodId,
  showPendencias = true,
}: {
  periodId: string | null;
  showPendencias?: boolean;
}) {
  const { data, isLoading, isError, error } = useConferencia(periodId);

  if (!periodId) return null;
  if (isLoading) return <Skeleton className="mb-4 h-28 w-full" />;
  if (isError) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTriangle className="size-4" />
        <AlertTitle>Não foi possível calcular a conferência</AlertTitle>
        <AlertDescription>{(error as Error)?.message}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return null;

  const fecha = data.fecha;

  return (
    <Alert
      className={`mb-4 ${
        fecha ? "border-primary/50" : "border-amber-500/70 bg-amber-500/10"
      }`}
    >
      {fecha ? (
        <CheckCircle2 className="size-4" />
      ) : (
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      )}
      <AlertTitle>
        {fecha
          ? "Balanço fechado: Ativo = Passivo + Patrimônio Líquido"
          : `Balanço não fecha — diferença de ${formatCurrency(data.delta)}`}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["Ativo", data.ativo],
            ["Passivo + PL", data.passivoPl],
            ["Delta (Ativo − Passivo/PL)", data.delta],
          ].map(([label, value]) => (
            <div
              key={label as string}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{label as string}</span>
              <span className="font-semibold tabular-nums">
                {formatCurrency(value as number)}
              </span>
            </div>
          ))}
        </div>

        {showPendencias && data.pendencias.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {data.pendencias.length} conta(s) candidata(s) a reclassificação
            </p>
            <ul className="space-y-2">
              {data.pendencias.slice(0, 5).map((p) => (
                <li
                  key={p.reduced_code}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {p.reduced_code} · {p.account_name}
                    </span>
                    <span className="tabular-nums">
                      abertura {formatCurrency(p.opening_balance)} ·{" "}
                      {(p.share * 100).toFixed(1)}% do grupo
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {NATURE_LABEL[p.nature ?? ""] ?? "Sem natureza"} — {p.causa}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Detalhe e ação sugerida em Reclassificações.
            </p>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
