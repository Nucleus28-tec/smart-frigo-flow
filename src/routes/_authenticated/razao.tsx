import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { GerenciadorLancamentos } from "@/components/razao/GerenciadorLancamentos";
import { PlanoDeContasRazao } from "@/components/razao/PlanoDeContasRazao";


export const Route = createFileRoute("/_authenticated/razao")({
  component: RazaoPage,
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

      <Tabs defaultValue="lancamentos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="plano">Plano de contas</TabsTrigger>
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
            />
          )}
        </TabsContent>

        <TabsContent value="plano">
          <PlanoDeContasRazao periodId={selectedPeriodId} isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </>
  );

}
