import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Passo = { titulo: string; detalhe: string; feito: boolean };

/** Fluxo operacional de partida: cada passo lido do estado real do período. */
export function FluxoOperacional({
  periodId,
  periodLabel,
  periodStatus,
}: {
  periodId: string;
  periodLabel: string;
  periodStatus: string;
}) {
  const query = useQuery({
    queryKey: ["fluxo_operacional", periodId],
    queryFn: async () => {
      const [files, legs, pendentes, indicadores, demonstrativos] = await Promise.all([
        supabase
          .from("imported_files")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId)
          .eq("file_type", "razao"),
        supabase
          .from("journal_legs")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId),
        supabase
          .from("ledger_accounts")
          .select("id", { count: "exact", head: true })
          .eq("link_status", "pendente"),
        supabase
          .from("dashboard_indicators")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId),
        supabase
          .from("financial_statements")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId),
      ]);
      return {
        files: files.count ?? 0,
        legs: legs.count ?? 0,
        pendentes: pendentes.count ?? 0,
        indicadores: indicadores.count ?? 0,
        demonstrativos: demonstrativos.count ?? 0,
      };
    },
  });

  const d = query.data;
  const passos: Passo[] = [
    { titulo: "Período selecionado", detalhe: periodLabel, feito: true },
    {
      titulo: "Razão importado",
      detalhe: d ? `${d.files} arquivo(s) · ${d.legs.toLocaleString("pt-BR")} lançamentos` : "—",
      feito: (d?.legs ?? 0) > 0,
    },
    {
      titulo: "Plano de contas casado",
      detalhe: d?.pendentes ? `${d.pendentes} conta(s) pendente(s)` : "sem pendências",
      feito: (d?.legs ?? 0) > 0 && (d?.pendentes ?? 0) === 0,
    },
    {
      titulo: "Indicadores recalculados",
      detalhe: d?.indicadores ? `${d.indicadores} indicadores` : "pendente",
      feito: (d?.indicadores ?? 0) > 0 && (d?.legs ?? 0) > 0,
    },
    {
      titulo: "Demonstrativos gerados",
      detalhe: d?.demonstrativos ? `${d.demonstrativos} demonstrativos` : "pendente",
      feito: (d?.demonstrativos ?? 0) > 0 && (d?.legs ?? 0) > 0,
    },
    {
      titulo: "Período fechado",
      detalhe: periodStatus === "fechado" ? "fechado" : "aberto",
      feito: periodStatus === "fechado",
    },
  ];

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fluxo operacional do período</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Conferindo o período…
          </div>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {passos.map((p, i) => (
              <li key={p.titulo} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                    p.feito
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {p.feito ? <Check className="size-3" /> : <Circle className="size-2" />}
                </span>
                <span>
                  <span className={cn("block font-medium", !p.feito && "text-muted-foreground")}>
                    {i + 1}. {p.titulo}
                  </span>
                  <span className="block text-xs text-muted-foreground">{p.detalhe}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
