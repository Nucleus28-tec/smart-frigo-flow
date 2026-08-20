import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { GerenciadorLancamentos } from "@/components/razao/GerenciadorLancamentos";
import { PlanoDeContasRazao } from "@/components/razao/PlanoDeContasRazao";
import { PlanoDeContasArvore } from "@/components/razao/PlanoDeContasArvore";
import { RelatoriosRazao } from "@/components/razao/RelatoriosRazao";
import { FechamentoContabil } from "@/components/razao/FechamentoContabil";



type RazaoSearch = {
  tab?: string | undefined;
  codes?: string | undefined;
  de?: string | undefined;
  ate?: string | undefined;
  kind?: string | undefined;
  dl?: string | undefined;
};

export const Route = createFileRoute("/_authenticated/razao")({
  component: RazaoPage,
  validateSearch: (search: Record<string, unknown>): RazaoSearch => {
    const str = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : undefined);
    return {
      tab: str("tab"),
      codes: str("codes"),
      de: str("de"),
      ate: str("ate"),
      kind: str("kind"),
      dl: str("dl"),
    };
  },
  head: () => ({
    meta: [
      { title: "Lançamentos contábeis | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Gerenciador de lançamentos do razão: grade do período, busca, inclusão, edição e cancelamento de movimentos.",
      },
      { property: "og:title", content: "Lançamentos contábeis | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Movimentos do período com partida, contrapartida e trilha de auditoria.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type AccountRow = {
  reduced_code: string;
  name: string;
};

function RazaoPage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();
  const { data: profile } = useProfile();
  const isAdmin = profile?.role === "admin";
  const [docNumber, setDocNumber] = useState<string | null>(null);
  const search = Route.useSearch();
  const [tab, setTab] = useState(search.tab ?? "lancamentos");

  useEffect(() => {
    if (search.tab) setTab(search.tab);
  }, [search.tab, search.dl]);

  /** Drill-down de um demonstrativo: contas + intervalo vindos da URL. */
  const drill = useMemo(() => {
    if (!search.dl || !search.codes) return null;
    return {
      token: search.dl,
      codes: search.codes.split(",").filter(Boolean),
      kind: (search.kind === "balancete" ? "balancete" : "razao") as "razao" | "balancete",
      from: search.de ?? null,
      to: search.ate ?? null,
    };
  }, [search.dl, search.codes, search.kind, search.de, search.ate]);

  const accounts = useQuery({
    queryKey: ["journal_accounts", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<AccountRow[]> => {
      const { data: openings, error } = await supabase
        .from("journal_account_openings")
        .select("account_reduced_code, account_name")
        .eq("period_id", selectedPeriodId!)
        .limit(5000);
      if (error) throw error;
      const { data: accs, error: accError } = await supabase
        .from("ledger_accounts")
        .select("reduced_code, name")
        .limit(5000);
      if (accError) throw accError;
      const byCode = new Map((accs ?? []).map((a) => [a.reduced_code, a]));
      return (openings ?? [])
        .map((o) => ({
          reduced_code: o.account_reduced_code,
          name: byCode.get(o.account_reduced_code)?.name ?? o.account_name,
        }))
        .sort((a, b) => a.reduced_code.localeCompare(b.reduced_code, "pt-BR", { numeric: true }));
    },
  });

  if (!selectedPeriodId) {
    return (
      <>
        <PageHeader
          title="Lançamentos"
          description="Movimentos do razão contábil, com partida e contrapartida."
        />
        <EmptyState
          title="Selecione um período"
          description="Escolha um período contábil no cabeçalho para abrir os lançamentos."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Razão contábil"
        description={`Lançamentos e plano de contas do período ${selectedPeriod?.label ?? ""}. O razão é a fonte do cálculo contábil.`}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="plano">Plano de contas</TabsTrigger>
          <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
          <TabsTrigger value="fechamento">Fechamento</TabsTrigger>
        </TabsList>


        <TabsContent value="lancamentos" className="space-y-4">
          {accounts.isLoading ? (
            <LoadingRows />
          ) : accounts.error ? (
            <ErrorState
              message={(accounts.error as Error).message}
              onRetry={() => void accounts.refetch()}
            />
          ) : (accounts.data ?? []).length === 0 ? (
            <EmptyState
              title="Nenhum razão importado neste período"
              description="Envie o razão contábil em Importar › Razão contábil (G2) para abrir o gerenciador."
            />
          ) : (
            <GerenciadorLancamentos
              periodId={selectedPeriodId}
              periodLabel={selectedPeriod?.label ?? ""}
              referenceMonth={selectedPeriod?.reference_month ?? null}
              isAdmin={isAdmin}
              canEdit={selectedPeriod?.status !== "fechado"}
              accounts={accounts.data ?? []}
              docNumber={docNumber}
              onDocNumberChange={setDocNumber}
              onReportClick={() => setTab("relatorios")}
            />
          )}
        </TabsContent>

        <TabsContent value="plano">
          <Tabs defaultValue="arvore" className="space-y-4">
            <TabsList>
              <TabsTrigger value="arvore">Árvore hierárquica</TabsTrigger>
              <TabsTrigger value="grade">Cadastro em grade</TabsTrigger>
            </TabsList>
            <TabsContent value="arvore">
              <PlanoDeContasArvore periodId={selectedPeriodId} isAdmin={isAdmin} />
            </TabsContent>
            <TabsContent value="grade">
              <PlanoDeContasRazao periodId={selectedPeriodId} isAdmin={isAdmin} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="relatorios">
          <RelatoriosRazao
            periodId={selectedPeriodId}
            periodLabel={selectedPeriod?.label ?? ""}
            referenceMonth={selectedPeriod?.reference_month ?? null}
            drill={drill}
          />
        </TabsContent>

        <TabsContent value="fechamento">
          <FechamentoContabil
            periodId={selectedPeriodId}
            periodLabel={selectedPeriod?.label ?? ""}
            referenceMonth={selectedPeriod?.reference_month ?? null}
            isAdmin={isAdmin}
          />
        </TabsContent>
      </Tabs>

    </>
  );

}
