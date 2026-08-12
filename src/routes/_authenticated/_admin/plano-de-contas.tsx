import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { NATURE_LABEL } from "@/lib/rotta";

export const Route = createFileRoute("/_authenticated/_admin/plano-de-contas")({
  component: PlanoDeContasPage,
  head: () => ({
    meta: [
      { title: "Plano de contas | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Estrutura de contas contábeis do frigorífico, com natureza e grupo de demonstrativo.",
      },
      { property: "og:title", content: "Plano de contas | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Estrutura de contas contábeis usada nos demonstrativos do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function PlanoDeContasPage() {
  const accounts = useQuery({
    queryKey: ["chart_of_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, source_code, source_name, nature, is_confirmed, times_confirmed, confidence_score")
        .order("source_name", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader
        title="Plano de contas"
        description="Dicionário de contas aprendido pelo sistema: cada confirmação humana torna a classificação mais confiável."
      />

      {accounts.isLoading ? (
        <LoadingRows />
      ) : accounts.isError ? (
        <ErrorState
          message={(accounts.error as Error)?.message}
          onRetry={() => void accounts.refetch()}
        />
      ) : accounts.data!.length === 0 ? (
        <EmptyState
          title="Plano de contas vazio"
          description="O dicionário de contas é alimentado pela importação dos balancetes, na Fase 2."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Código</TableHead>
                  <TableHead>Conta de origem</TableHead>
                  <TableHead>Natureza</TableHead>
                  <TableHead>Confirmações</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.data!.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-mono text-xs">
                      {account.source_code ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{account.source_name}</TableCell>
                    <TableCell>
                      {account.nature ? (NATURE_LABEL[account.nature] ?? account.nature) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {account.times_confirmed}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={account.is_confirmed ? "secondary" : "outline"}>
                        {account.is_confirmed ? "Confirmada" : "Sugerida"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

