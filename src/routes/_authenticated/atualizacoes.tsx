import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { formatDateTime } from "@/lib/rotta";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { testAiConnection } from "@/lib/ai.functions";

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

type AccountAudit = {
  id: string;
  period_id: string | null;
  entity_type: string;
  account_key: string;
  account_name: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
  profiles: { full_name: string } | null;
};

const FIELD_LABELS: Record<string, string> = {
  nature: "Natureza",
  hierarchical_code: "Código hierárquico",
  parent_code: "Grupo (conta-pai)",
  name: "Nome da conta",
  is_analytic: "Tipo (analítica/sintética)",
  is_active: "Conta ativa",
  link_status: "Vínculo com o plano",
  excluded: "Oculta do resultado",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Edição manual",
  importacao: "Importação do razão",
  ia: "Sugestão da IA aplicada",
  sistema: "Rotina automática",
};

function formatValue(value: string | null) {
  if (value === null || value === "") return "—";
  if (value === "true") return "Sim";
  if (value === "false") return "Não";
  return value;
}

function AtualizacoesPage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();

  const logs = useQuery({
    queryKey: ["ledger_account_audit", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<AccountAudit[]> => {
      const { data, error } = await supabase
        .from("ledger_account_audit")
        .select(
          "id, period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, created_at, profiles:actor_id(full_name)",
        )
        .or(`period_id.eq.${selectedPeriodId!},period_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as AccountAudit[];
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
  const byIa = items.filter((item) => item.source === "ia").length;


  return (
    <>
      <PageHeader
        title="Atualizações"
        description={
          selectedPeriod
            ? `Mudanças feitas no plano de contas do razão em ${selectedPeriod.label}: quem alterou, o que mudou e de onde veio a alteração.`
            : "Selecione um período para ver as mudanças registradas."
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
          description="Alterações de natureza, grupo, nome ou ocultação de contas do razão aparecerão aqui."
        />
      ) : (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">
              {items.length} mudança{items.length === 1 ? "" : "s"} registrada
              {items.length === 1 ? "" : "s"}
            </CardTitle>
            {byIa > 0 ? (
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                {byIa} vinda{byIa === 1 ? "" : "s"} de sugestão da IA
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Conta</th>
                    <th className="px-4 py-2 font-medium">O que mudou</th>
                    <th className="px-4 py-2 font-medium text-right">Antes</th>
                    <th className="px-4 py-2 font-medium text-right">Depois</th>
                    <th className="px-4 py-2 font-medium">Quem / quando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => (
                    <tr key={item.id} className={item.source === "ia" ? "bg-amber-500/10" : undefined}>
                      <td className="px-4 py-2">
                        <div className="font-medium">{item.account_name ?? item.account_key}</div>
                        <div className="text-xs text-muted-foreground">{item.account_key}</div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{FIELD_LABELS[item.field_changed] ?? item.field_changed}</span>
                          <Badge variant="outline" className="text-xs">
                            {SOURCE_LABELS[item.source] ?? item.source}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatValue(item.old_value)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatValue(item.new_value)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {item.profiles?.full_name ?? "Sistema"} · {formatDateTime(item.created_at)}
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

function AiStatusCard() {
  const profile = useProfile();
  const isAdmin = profile.data?.role === "admin";
  const runTest = useServerFn(testAiConnection);
  const test = useMutation({ mutationFn: () => runTest({ data: undefined }) });

  if (!isAdmin) return null;

  const result = test.data;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          Inteligência artificial (Google Gemini)
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => test.mutate()}
          disabled={test.isPending}
        >
          {test.isPending ? "Testando..." : "Testar conexão com a IA"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          A leitura de PDFs e as sugestões de reclassificação usam a sua própria chave do Google AI
          Studio, sem depender de créditos da Lovable.
        </p>
        {test.isError ? (
          <p className="text-destructive">
            {(test.error as Error)?.message ?? "Não foi possível executar o teste."}
          </p>
        ) : null}
        {result ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.ok ? "default" : "destructive"}>
              {result.ok ? "Conectado" : "Falhou"}
            </Badge>
            <span className="text-muted-foreground">
              Modelo {result.model} · {result.latencyMs} ms
            </span>
            <span className={result.ok ? "text-muted-foreground" : "text-destructive"}>
              {result.message}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
