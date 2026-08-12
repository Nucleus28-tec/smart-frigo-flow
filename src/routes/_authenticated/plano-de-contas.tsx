import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Lock, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { usePeriod } from "@/hooks/usePeriod";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { NATURE_LABEL, NATURE_OPTIONS } from "@/lib/rotta";
import { setAccountNature, syncChartOfAccounts } from "@/lib/ledger.functions";

export const Route = createFileRoute("/_authenticated/plano-de-contas")({
  component: PlanoDeContasPage,
  head: () => ({
    meta: [
      { title: "Plano de contas | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Mapeamento das contas do G2 para as oito naturezas contábeis usadas nos demonstrativos.",
      },
      { property: "og:title", content: "Plano de contas | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Mapeamento das contas do G2 para as naturezas contábeis do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Account = {
  id: string;
  source_code: string | null;
  source_name: string;
  nature: string | null;
  is_confirmed: boolean;
  times_confirmed: number;
  updated_at: string;
};

function PlanoDeContasPage() {
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { selectedPeriodId } = usePeriod();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("todas");

  const sync = useServerFn(syncChartOfAccounts);
  const saveNature = useServerFn(setAccountNature);

  const accounts = useQuery({
    queryKey: ["chart_of_accounts"],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, source_code, source_name, nature, is_confirmed, times_confirmed, updated_at")
        .order("source_name", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => sync({ data: { period_id: selectedPeriodId! } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger_entries"] });
      toast.success(
        `${result.created} conta(s) nova(s) e ${result.linked} lançamento(s) vinculado(s).`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const natureMutation = useMutation({
    mutationFn: (vars: { account_id: string; nature: string }) =>
      saveNature({ data: { account_id: vars.account_id, nature: vars.nature as never } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["chart_of_accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["ledger_entries"] });
      toast.success(`Conta classificada. ${result.updated} lançamento(s) atualizado(s).`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = useMemo(() => {
    const list = accounts.data ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((account) => {
      if (filter === "pendentes" && account.nature) return false;
      if (filter !== "todas" && filter !== "pendentes" && account.nature !== filter) return false;
      if (!term) return true;
      return (
        account.source_name.toLowerCase().includes(term) ||
        (account.source_code ?? "").toLowerCase().includes(term)
      );
    });
  }, [accounts.data, search, filter]);

  const pending = (accounts.data ?? []).filter((a) => !a.nature).length;

  return (
    <>
      <PageHeader
        title="Plano de contas"
        description="Cada conta do G2 é mapeada para uma das oito naturezas contábeis. O mapeamento é reaproveitado nos períodos seguintes."
        actions={
          isAdmin ? (
            <Button
              variant="outline"
              disabled={!selectedPeriodId || syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              {syncMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Sincronizar contas
            </Button>
          ) : null
        }
      />

      {!profileLoading && !isAdmin ? (
        <Alert className="mb-6">
          <Lock className="size-4" />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            Apenas o Admin define o mapeamento do plano de contas.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por código ou descrição"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="sm:w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as contas</SelectItem>
            <SelectItem value="pendentes">Pendentes de classificação</SelectItem>
            {NATURE_OPTIONS.map((nature) => (
              <SelectItem key={nature} value={nature}>
                {NATURE_LABEL[nature]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant={pending > 0 ? "destructive" : "secondary"} className="sm:ml-auto">
          {pending} pendente(s)
        </Badge>
      </div>

      {accounts.isLoading ? (
        <LoadingRows />
      ) : accounts.isError ? (
        <ErrorState
          message={(accounts.error as Error)?.message}
          onRetry={() => void accounts.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma conta encontrada"
          description={
            (accounts.data ?? []).length === 0
              ? "Importe um balancete e use 'Sincronizar contas' para alimentar o plano de contas."
              : "Ajuste a busca ou o filtro para ver outras contas."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">Código</TableHead>
                  <TableHead>Conta de origem (G2)</TableHead>
                  <TableHead className="w-[260px]">Natureza</TableHead>
                  <TableHead className="w-[120px] text-right">Confirmações</TableHead>
                  <TableHead className="w-[130px] text-right">Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-mono text-xs">
                      {account.source_code ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">{account.source_name}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select
                          value={account.nature ?? ""}
                          onValueChange={(nature) =>
                            natureMutation.mutate({ account_id: account.id, nature })
                          }
                          disabled={natureMutation.isPending}
                        >
                          <SelectTrigger aria-label={`Natureza de ${account.source_name}`}>
                            <SelectValue placeholder="Não classificada" />
                          </SelectTrigger>
                          <SelectContent>
                            {NATURE_OPTIONS.map((nature) => (
                              <SelectItem key={nature} value={nature}>
                                {NATURE_LABEL[nature]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : account.nature ? (
                        (NATURE_LABEL[account.nature] ?? account.nature)
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {account.times_confirmed}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={account.is_confirmed ? "secondary" : "outline"}>
                        {account.is_confirmed ? "Confirmada" : "Pendente"}
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
