import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, LoadingRows } from "@/components/PageState";
import { formatCurrency } from "@/lib/rotta";
import {
  COMPONENT_LABEL,
  INDICATOR_BY_KEY,
  formatIndicatorValue,
  periodRange,
} from "@/lib/indicadores";

type Account = {
  reduced_code: string;
  account_name: string;
  hierarchical_code: string | null;
  nature: string | null;
  value: number;
};

type Component = {
  component_key: string;
  basis: "movimento" | "saldo";
  total: number;
  accounts: Account[];
};

type Drilldown = {
  indicator_key: string;
  label: string;
  formula: string;
  kind: string;
  source: "razao" | "balancete";
  components: Component[];
};

type Props = {
  indicatorKey: string | null;
  periodId: string | null;
  referenceMonth: string | null | undefined;
  value: number | undefined;
  onOpenChange: (open: boolean) => void;
};

export function IndicadorDrilldown({
  indicatorKey,
  periodId,
  referenceMonth,
  value,
  onOpenChange,
}: Props) {
  const navigate = useNavigate();
  const meta = indicatorKey ? INDICATOR_BY_KEY.get(indicatorKey) : undefined;

  const query = useQuery({
    queryKey: ["indicator-drilldown", periodId, indicatorKey],
    enabled: Boolean(periodId && indicatorKey),
    queryFn: async (): Promise<Drilldown> => {
      const { data, error } = await supabase.rpc("indicator_drilldown", {
        _period_id: periodId!,
        _indicator_key: indicatorKey!,
      });
      if (error) throw error;
      return data as unknown as Drilldown;
    },
  });

  function openRazao(codes: string[], basis: "movimento" | "saldo") {
    if (codes.length === 0) return;
    const range = periodRange(referenceMonth);
    const search: Record<string, string> = {
      tab: "relatorios",
      codes: codes.slice(0, 200).join(","),
      kind: basis === "saldo" ? "balancete" : "razao",
      dl: `${Date.now()}`,
    };
    if (range) {
      search["de"] = range.from;
      search["ate"] = range.to;
    }
    onOpenChange(false);
    void navigate({ to: "/razao", search });
  }

  const data = query.data;

  return (
    <Dialog open={Boolean(indicatorKey)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            De onde veio {meta?.label ?? data?.label ?? "este número"}
            {data ? (
              <Badge variant="secondary">Fonte: {data.source === "razao" ? "razão" : "balancete"}</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {data?.formula ?? meta?.hint}
            {meta ? ` · Valor calculado: ${formatIndicatorValue(meta.kind, value)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <LoadingRows rows={3} />
        ) : query.isError ? (
          <ErrorState
            message={(query.error as Error)?.message}
            onRetry={() => void query.refetch()}
          />
        ) : (data?.components?.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma conta com movimento ou saldo compõe este indicador no período.
          </p>
        ) : (
          <div className="space-y-5">
            {data!.components.map((comp) => (
              <section key={comp.component_key} className="rounded-lg border border-border">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {COMPONENT_LABEL[comp.component_key] ?? comp.component_key}
                    </span>
                    <Badge variant="outline" className="text-[11px]">
                      {comp.basis === "saldo" ? "saldo da conta" : "movimento do período"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(Number(comp.total))}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openRazao(comp.accounts.map((a) => a.reduced_code), comp.basis)
                      }
                    >
                      <ExternalLink className="size-3.5" />
                      Ver lançamentos
                    </Button>
                  </div>
                </header>
                <ul className="divide-y divide-border">
                  {comp.accounts.slice(0, 40).map((acc) => (
                    <li
                      key={`${comp.component_key}-${acc.reduced_code}`}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                    >
                      <button
                        type="button"
                        className="truncate text-left hover:underline"
                        onClick={() => openRazao([acc.reduced_code], comp.basis)}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {acc.reduced_code}
                        </span>{" "}
                        {acc.account_name}
                      </button>
                      <span className="shrink-0 tabular-nums">
                        {formatCurrency(Number(acc.value))}
                      </span>
                    </li>
                  ))}
                  {comp.accounts.length > 40 ? (
                    <li className="px-3 py-1.5 text-xs text-muted-foreground">
                      +{comp.accounts.length - 40} contas — use “Ver lançamentos” para a lista
                      completa.
                    </li>
                  ) : null}
                </ul>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
