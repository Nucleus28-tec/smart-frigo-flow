import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { formatCurrency, formatDateTime } from "@/lib/rotta";
import { usePeriod } from "@/hooks/usePeriod";

export const Route = createFileRoute("/_authenticated/atualizacoes")({
  component: AtualizacoesPage,
  head: () => ({
    meta: [
      { title: "Atualizações | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Lista dos valores atualizados após reimportações, com as edições manuais preservadas em destaque.",
      },
      { property: "og:title", content: "Atualizações | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Diffs de recálculo e trilha de auditoria do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type RecalcLog = {
  id: string;
  file_id: string | null;
  entry_id: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  manual_edit_preserved: boolean;
  created_at: string;
  ledger_entries: { source_account_name: string } | null;
  imported_files: { original_name: string } | null;
};

const FIELD_LABELS: Record<string, string> = {
  raw_value: "Valor importado",
  nature: "Natureza",
  novo_lancamento: "Novo lançamento",
  lancamento_removido: "Lançamento removido",
};

function formatValue(field: string, value: string | null) {
  if (value === null || value === "") return "—";
  if (field === "raw_value" || field === "novo_lancamento") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return formatCurrency(numeric);
  }
  return value;
}

function AtualizacoesPage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();

  const logs = useQuery({
    queryKey: ["recalculation_logs", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<RecalcLog[]> => {
      const { data, error } = await supabase
        .from("recalculation_logs")
        .select(
          "id, file_id, entry_id, field_changed, old_value, new_value, manual_edit_preserved, created_at, ledger_entries:entry_id(source_account_name), imported_files:file_id(original_name)",
        )
        .eq("period_id", selectedPeriodId!)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as RecalcLog[];
    },
  });

  const activity = useQuery({
    queryKey: ["activity_log", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, entity_type, entity_id, created_at, profiles:actor_id(full_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const items = logs.data ?? [];
  const preserved = items.filter((item) => item.manual_edit_preserved).length;

  return (
    <>
      <PageHeader
        title="Atualizações"
        description={
          selectedPeriod
            ? `Valores alterados pelos recálculos automáticos em ${selectedPeriod.label}, com as edições manuais preservadas em destaque.`
            : "Selecione um período para ver os valores atualizados."
        }
      />

      <AiStatusCard />


      {!selectedPeriodId ? (
        <EmptyState
          title="Nenhum período selecionado"
          description="Escolha um período no topo da tela para ver as mudanças."
        />
      ) : logs.isLoading ? (
        <LoadingRows />
      ) : logs.isError ? (
        <ErrorState message={(logs.error as Error)?.message} onRetry={() => void logs.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma mudança registrada"
          description="Ao reimportar um arquivo sobre este período, a lista dos valores atualizados aparecerá aqui."
        />
      ) : (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">
              {items.length} mudança{items.length === 1 ? "" : "s"} no período
            </CardTitle>
            {preserved > 0 ? (
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                {preserved} edição{preserved === 1 ? "" : "ões"} manual preservada
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Conta / arquivo</th>
                    <th className="px-4 py-2 font-medium">Campo</th>
                    <th className="px-4 py-2 font-medium text-right">Antes</th>
                    <th className="px-4 py-2 font-medium text-right">Depois</th>
                    <th className="px-4 py-2 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={item.manual_edit_preserved ? "bg-amber-500/10" : undefined}
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">
                          {item.ledger_entries?.source_account_name ??
                            item.old_value ??
                            "Lançamento"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.imported_files?.original_name ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{FIELD_LABELS[item.field_changed] ?? item.field_changed}</span>
                          {item.manual_edit_preserved ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-xs text-amber-600"
                            >
                              edição manual preservada
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatValue(item.field_changed, item.old_value)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatValue(item.field_changed, item.new_value)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {formatDateTime(item.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trilha de auditoria</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activity.isLoading ? (
            <div className="p-5">
              <LoadingRows />
            </div>
          ) : activity.isError ? (
            <div className="p-5">
              <ErrorState
                message={(activity.error as Error)?.message}
                onRetry={() => void activity.refetch()}
              />
            </div>
          ) : (activity.data ?? []).length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nenhuma atividade registrada"
                description="As ações da equipe aparecerão aqui automaticamente."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.data!.map((item) => {
                const actor = item.profiles as { full_name?: string } | null;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{actor?.full_name ?? "Sistema"}</span>{" "}
                      {item.action}{" "}
                      <span className="text-muted-foreground">({item.entity_type})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
