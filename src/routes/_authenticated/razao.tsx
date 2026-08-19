import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, FileDown, FileText, Loader2, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { NATURE_LABEL, NATURE_OPTIONS, formatCurrency, formatDateTime } from "@/lib/rotta";
import {
  getAccountStatement,
  getJournalDocument,
  linkReducedAccounts,
  pendingReport,
  reconcileJournal,
  setAccountLink,
} from "@/lib/razao.functions";
import { exportCsv, exportPdf, type ExportTable } from "@/lib/razao-export";

export const Route = createFileRoute("/_authenticated/razao")({
  component: RazaoPage,
  head: () => ({
    meta: [
      { title: "Razão contábil | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Gerenciador do razão contábil: extrato por conta, partida e contrapartida de cada lançamento e conferência com o balancete.",
      },
      { property: "og:title", content: "Razão contábil | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Movimento completo das contas do período, com contrapartidas e conferência.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type AccountRow = {
  reduced_code: string;
  name: string;
  hierarchical_code: string | null;
  nature: string | null;
  link_status: string;
  opening_balance: number;
};

type Leg = {
  id: string;
  doc_number: string | null;
  entry_date: string | null;
  historico: string | null;
  debit: number;
  credit: number;
  running_balance: number | null;
  counterpart_reduced_code: string | null;
  counterpart_name: string | null;
  counterpart_code: string | null;
};

type Statement = {
  account: { name?: string; hierarchical_code?: string | null } | null;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  count: number;
  legs: Leg[];
};

type DocLeg = {
  id: string;
  entry_date: string | null;
  historico: string | null;
  debit: number;
  credit: number;
  account_reduced_code: string;
  account_name: string | null;
  counterpart_reduced_code: string | null;
  counterpart_name: string | null;
};

type ReconRow = {
  reduced_code: string;
  name: string | null;
  code: string | null;
  razao_debito: number;
  razao_credito: number;
  balancete_debito: number | null;
  balancete_credito: number | null;
  status: string;
};

const PENDING_CAUSE: Record<string, string> = {
  sem_candidato: "Conta nova no razão",
  varios_candidatos: "Vários candidatos",
  candidato_ambiguo: "Candidato ambíguo",
  sem_natureza: "Sem natureza",
  diferenca_valor: "Diferença de valor",
  so_balancete: "Só no balancete",
};

type PendingRow = {
  reduced_code: string | null;
  name: string | null;
  code: string | null;
  causa: string;
  detalhe: string;
  acao: string;
  delta: number;
};

type AuditRow = {
  id: string;
  entity_type: string;
  account_key: string;
  account_name: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  source: string | null;
  actor_id: string | null;
  created_at: string;
  actor_name: string;
};


function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function RazaoPage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState<string | null>(null);
  const [docInput, setDocInput] = useState("");
  const [tab, setTab] = useState("extrato");
  const [lancMode, setLancMode] = useState<"buscar" | "numero">("buscar");
  const [freeQuery, setFreeQuery] = useState("");
  const [freeTerm, setFreeTerm] = useState("");
  const [freePage, setFreePage] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      setFreeTerm(freeQuery.trim());
      setFreePage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [freeQuery]);

  const fetchStatement = useServerFn(getAccountStatement);
  const fetchDocument = useServerFn(getJournalDocument);
  const runSearch = useServerFn(searchJournalLegs);
  const runLink = useServerFn(linkReducedAccounts);
  const runReconcile = useServerFn(reconcileJournal);
  const saveLink = useServerFn(setAccountLink);
  const fetchPending = useServerFn(pendingReport);

  const searchQuery = useQuery({
    queryKey: ["journal_search", selectedPeriodId, freeTerm, freePage],
    enabled: Boolean(selectedPeriodId) && freeTerm.length >= 2,
    queryFn: async (): Promise<SearchResult> =>
      (await runSearch({
        data: {
          period_id: selectedPeriodId!,
          query: freeTerm,
          limit: SEARCH_PAGE_SIZE,
          offset: freePage * SEARCH_PAGE_SIZE,
        },
      })) as unknown as SearchResult,
  });


  const accounts = useQuery({
    queryKey: ["journal_accounts", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<AccountRow[]> => {
      const { data: openings, error } = await supabase
        .from("journal_account_openings")
        .select("account_reduced_code, account_name, opening_balance")
        .eq("period_id", selectedPeriodId!)
        .limit(5000);
      if (error) throw error;
      const { data: accs, error: accError } = await supabase
        .from("ledger_accounts")
        .select("reduced_code, name, hierarchical_code, nature, link_status")
        .limit(5000);
      if (accError) throw accError;
      const byCode = new Map((accs ?? []).map((a) => [a.reduced_code, a]));
      return (openings ?? [])
        .map((o) => {
          const acc = byCode.get(o.account_reduced_code);
          return {
            reduced_code: o.account_reduced_code,
            name: acc?.name ?? o.account_name,
            hierarchical_code: acc?.hierarchical_code ?? null,
            nature: acc?.nature ?? null,
            link_status: acc?.link_status ?? "pendente",
            opening_balance: Number(o.opening_balance ?? 0),
          };
        })
        .sort((a, b) =>
          (a.hierarchical_code ?? "zzz").localeCompare(b.hierarchical_code ?? "zzz") ||
          a.reduced_code.localeCompare(b.reduced_code),
        );
    },
  });

  const tbAccounts = useQuery({
    queryKey: ["tb_accounts", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trial_balance_lines")
        .select("code, name, is_analytic")
        .eq("period_id", selectedPeriodId!)
        .eq("is_analytic", true)
        .order("code")
        .limit(3000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const statement = useQuery({
    queryKey: ["journal_statement", selectedPeriodId, selectedAccount],
    enabled: Boolean(selectedPeriodId && selectedAccount),
    queryFn: async () =>
      (await fetchStatement({
        data: { period_id: selectedPeriodId!, reduced_code: selectedAccount!, limit: 500, offset: 0 },
      })) as unknown as Statement,
  });

  const documentQuery = useQuery({
    queryKey: ["journal_document", selectedPeriodId, docNumber],
    enabled: Boolean(selectedPeriodId && docNumber),
    queryFn: async () =>
      (await fetchDocument({
        data: { period_id: selectedPeriodId!, doc_number: docNumber! },
      })) as unknown as { doc_number: string; total_debit: number; total_credit: number; legs: DocLeg[] },
  });

  const reconciliation = useQuery({
    queryKey: ["journal_recon", selectedPeriodId],
    enabled: Boolean(selectedPeriodId) && tab === "conferencia",
    queryFn: async () =>
      (await runReconcile({ data: { period_id: selectedPeriodId! } })) as unknown as {
        total: number;
        ok: number;
        divergente: number;
        so_razao: number;
        so_balancete: number;
        linhas: ReconRow[];
      },
  });

  const pendingQuery = useQuery({
    queryKey: ["journal_pending", selectedPeriodId],
    enabled: Boolean(selectedPeriodId) && tab === "pendencias",
    queryFn: async () =>
      (await fetchPending({ data: { period_id: selectedPeriodId! } })) as unknown as {
        total: number;
        por_causa: Record<string, number>;
        linhas: PendingRow[];
      },
  });

  const auditQuery = useQuery({
    queryKey: ["ledger_audit", selectedPeriodId],
    enabled: tab === "historico",
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("ledger_account_audit")
        .select(
          "id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []) as Omit<AuditRow, "actor_name">[];
      const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: people } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        for (const person of people ?? []) names.set(person.id, person.full_name);
      }
      return rows.map((row) => ({
        ...row,
        actor_name: row.actor_id ? (names.get(row.actor_id) ?? "—") : "Sistema",
      }));
    },
  });



  const linkMutation = useMutation({
    mutationFn: () => runLink({ data: { period_id: selectedPeriodId! } }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["journal_accounts", selectedPeriodId] });
      void queryClient.invalidateQueries({ queryKey: ["journal_recon", selectedPeriodId] });
      toast.success(
        `${result.by_name + result.by_value} conta(s) vinculada(s). ${result.pending} pendente(s).`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveLinkMutation = useMutation({
    mutationFn: (vars: { reduced_code: string; hierarchical_code?: string; nature?: string }) =>
      saveLink({
        data: {
          reduced_code: vars.reduced_code,
          hierarchical_code: vars.hierarchical_code ?? "",
          nature: vars.nature ?? "",
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["journal_accounts", selectedPeriodId] });
      toast.success("Vínculo confirmado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = accounts.data ?? [];
    if (!term) return list;
    return list.filter(
      (a) =>
        a.reduced_code.includes(term) ||
        a.name.toLowerCase().includes(term) ||
        (a.hierarchical_code ?? "").includes(term),
    );
  }, [accounts.data, search]);

  const accountName = useMemo(
    () => (accounts.data ?? []).find((a) => a.reduced_code === selectedAccount)?.name ?? "",
    [accounts.data, selectedAccount],
  );

  function extratoTable(): ExportTable | null {
    const data = statement.data;
    if (!data || !selectedAccount) return null;
    const saldoFinal =
      Number(data.opening_balance) + Number(data.total_debit) - Number(data.total_credit);
    return {
      title: `Extrato do razão — ${accountName || selectedAccount}`,
      subtitle: `Período ${selectedPeriod?.label ?? ""} · conta ${selectedAccount}${
        data.account?.hierarchical_code ? ` · ${data.account.hierarchical_code}` : ""
      }`,
      info: [
        { label: "Saldo anterior", value: formatCurrency(data.opening_balance) },
        { label: "Débitos", value: formatCurrency(data.total_debit) },
        { label: "Créditos", value: formatCurrency(data.total_credit) },
        { label: "Saldo final", value: formatCurrency(saldoFinal) },
      ],
      headers: ["Data", "Lçto", "Contrapartida", "Histórico", "Débito", "Crédito", "Saldo"],
      numeric: [4, 5, 6],
      rows: (data.legs ?? []).map((leg) => [
        fmtDate(leg.entry_date),
        leg.doc_number ?? "",
        leg.counterpart_name ?? leg.counterpart_reduced_code ?? "",
        leg.historico ?? "",
        leg.debit ? formatCurrency(leg.debit) : "",
        leg.credit ? formatCurrency(leg.credit) : "",
        leg.running_balance != null ? formatCurrency(leg.running_balance) : "",
      ]),
    };
  }

  function lancamentoTable(): ExportTable | null {
    const data = documentQuery.data;
    if (!data) return null;
    return {
      title: `Lançamento ${data.doc_number}`,
      subtitle: `Período ${selectedPeriod?.label ?? ""}`,
      info: [
        { label: "Total débito", value: formatCurrency(data.total_debit) },
        { label: "Total crédito", value: formatCurrency(data.total_credit) },
      ],
      headers: ["Data", "Conta", "Contrapartida", "Histórico", "Débito", "Crédito"],
      numeric: [4, 5],
      rows: data.legs.map((leg) => [
        fmtDate(leg.entry_date),
        `${leg.account_reduced_code} ${leg.account_name ?? ""}`.trim(),
        leg.counterpart_name ?? leg.counterpart_reduced_code ?? "",
        leg.historico ?? "",
        leg.debit ? formatCurrency(leg.debit) : "",
        leg.credit ? formatCurrency(leg.credit) : "",
      ]),
    };
  }

  async function exportar(table: ExportTable | null, filename: string, kind: "csv" | "pdf") {
    if (!table || table.rows.length === 0) {
      toast.error("Nada para exportar.");
      return;
    }
    try {
      if (kind === "csv") exportCsv(table, filename);
      else await exportPdf(table, filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar o arquivo.");
    }
  }

  function ExportButtons({ table, filename }: { table: ExportTable | null; filename: string }) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void exportar(table, filename, "csv")}>
          <FileDown className="mr-2 size-4" />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => void exportar(table, filename, "pdf")}>
          <FileText className="mr-2 size-4" />
          PDF
        </Button>
      </div>
    );
  }

  const pending = useMemo(
    () => (accounts.data ?? []).filter((a) => !a.hierarchical_code || !a.nature),
    [accounts.data],
  );

  if (!selectedPeriodId) {
    return (
      <>
        <PageHeader
          title="Razão contábil"
          description="Movimento completo das contas, com partida e contrapartida."
        />
        <EmptyState
          title="Selecione um período"
          description="Escolha um período contábil no cabeçalho para abrir o razão."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Razão contábil"
        description={`Movimento do período ${selectedPeriod?.label ?? ""}. O razão é a fonte do cálculo; o balancete é o espelho de conferência.`}
      />

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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="extrato">Contas e extrato</TabsTrigger>
            <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
            <TabsTrigger value="conferencia">Conferência</TabsTrigger>
            <TabsTrigger value="pendencias">Pendências</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="vinculos">
              Vínculos
              {pending.length > 0 ? (
                <Badge variant="secondary" className="ml-2">
                  {pending.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          {/* ------------------------- EXTRATO ------------------------- */}
          <TabsContent value="extrato">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              <Card className="h-fit">
                <CardContent className="p-3">
                  <div className="relative mb-3">
                    <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Código ou nome da conta"
                      className="pl-8"
                      aria-label="Buscar conta"
                    />
                  </div>
                  <p className="mb-2 px-1 text-xs text-muted-foreground">
                    {filtered.length} conta(s) com movimento
                  </p>
                  <div className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
                    {filtered.map((account) => (
                      <button
                        key={account.reduced_code}
                        type="button"
                        onClick={() => setSelectedAccount(account.reduced_code)}
                        className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent ${
                          selectedAccount === account.reduced_code ? "bg-accent" : ""
                        }`}
                      >
                        <span className="block font-medium">{account.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {account.reduced_code}
                          {account.hierarchical_code ? ` · ${account.hierarchical_code}` : ""}
                          {account.nature ? ` · ${NATURE_LABEL[account.nature] ?? account.nature}` : " · sem natureza"}
                        </span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  {!selectedAccount ? (
                    <div className="p-6">
                      <EmptyState
                        title="Escolha uma conta"
                        description="Selecione uma conta à esquerda para ver o extrato do período."
                      />
                    </div>
                  ) : statement.isLoading ? (
                    <div className="p-4">
                      <LoadingRows />
                    </div>
                  ) : statement.error ? (
                    <div className="p-4">
                      <ErrorState
                        message={(statement.error as Error).message}
                        onRetry={() => void statement.refetch()}
                      />
                    </div>
                  ) : statement.data ? (
                    <>
                      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                        <p className="truncate text-sm font-medium">
                          {accountName || selectedAccount}
                        </p>
                        <ExportButtons
                          table={extratoTable()}
                          filename={`extrato-${selectedAccount}`}
                        />
                      </div>
                      <div className="grid gap-3 border-b p-4 sm:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Saldo anterior</p>
                          <p className="tabular-nums font-medium">
                            {formatCurrency(statement.data.opening_balance)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Débitos</p>
                          <p className="tabular-nums font-medium">
                            {formatCurrency(statement.data.total_debit)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Créditos</p>
                          <p className="tabular-nums font-medium">
                            {formatCurrency(statement.data.total_credit)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Saldo final</p>
                          <p className="tabular-nums font-semibold">
                            {formatCurrency(
                              Number(statement.data.opening_balance) +
                                Number(statement.data.total_debit) -
                                Number(statement.data.total_credit),
                            )}
                          </p>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Lçto</TableHead>
                            <TableHead>Contrapartida</TableHead>
                            <TableHead>Histórico</TableHead>
                            <TableHead className="text-right">Débito</TableHead>
                            <TableHead className="text-right">Crédito</TableHead>
                            <TableHead className="text-right">Saldo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(statement.data.legs ?? []).map((leg) => (
                            <TableRow key={leg.id}>
                              <TableCell className="whitespace-nowrap">
                                {fmtDate(leg.entry_date)}
                              </TableCell>
                              <TableCell>
                                <button
                                  type="button"
                                  className="text-primary underline-offset-2 hover:underline"
                                  onClick={() => {
                                    setDocNumber(leg.doc_number);
                                    setDocInput(leg.doc_number ?? "");
                                    setTab("lancamento");
                                  }}
                                >
                                  {leg.doc_number ?? "—"}
                                </button>
                              </TableCell>
                              <TableCell className="max-w-[220px]">
                                {leg.counterpart_reduced_code ? (
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 text-left hover:underline"
                                    onClick={() =>
                                      setSelectedAccount(leg.counterpart_reduced_code)
                                    }
                                  >
                                    <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                                    <span className="truncate">
                                      {leg.counterpart_name ?? leg.counterpart_reduced_code}
                                    </span>
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="max-w-[320px]">
                                <span className="block truncate" title={leg.historico ?? ""}>
                                  {leg.historico ?? "—"}
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {leg.debit ? formatCurrency(leg.debit) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {leg.credit ? formatCurrency(leg.credit) : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {leg.running_balance != null
                                  ? formatCurrency(leg.running_balance)
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {statement.data.count > (statement.data.legs?.length ?? 0) ? (
                        <p className="border-t p-3 text-sm text-muted-foreground">
                          Exibindo {statement.data.legs.length} de {statement.data.count}{" "}
                          lançamentos.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ------------------------ LANÇAMENTO ------------------------ */}
          <TabsContent value="lancamento">
            {!docNumber ? (
              <>
                <Card className="mb-4">
                  <CardContent className="space-y-4 pt-6">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={lancMode === "buscar" ? "default" : "outline"}
                        onClick={() => setLancMode("buscar")}
                      >
                        Buscar
                      </Button>
                      <Button
                        size="sm"
                        variant={lancMode === "numero" ? "default" : "outline"}
                        onClick={() => setLancMode("numero")}
                      >
                        Abrir por número
                      </Button>
                    </div>

                    {lancMode === "buscar" ? (
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="busca-livre">
                          Pesquisar lançamentos
                        </label>
                        <div className="relative">
                          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                          <Input
                            id="busca-livre"
                            value={freeQuery}
                            onChange={(e) => setFreeQuery(e.target.value)}
                            placeholder="Núm. doc., conta, contrapartida, histórico ou valor"
                            className="pl-8"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Ignora acentos e maiúsculas. Digite ao menos 2 caracteres.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="grow space-y-2">
                          <label className="text-sm font-medium" htmlFor="doc">
                            Número do lançamento
                          </label>
                          <Input
                            id="doc"
                            value={docInput}
                            onChange={(e) => setDocInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setDocNumber(docInput.trim() || null);
                            }}
                            placeholder="Ex.: 100721"
                          />
                        </div>
                        <Button onClick={() => setDocNumber(docInput.trim() || null)}>Abrir</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {lancMode === "numero" ? (
                  <EmptyState
                    title="Nenhum lançamento aberto"
                    description="Informe o número do lançamento ou clique em um número no extrato."
                  />
                ) : freeTerm.length < 2 ? (
                  <EmptyState
                    title="Busca livre de lançamentos"
                    description="Procure por fornecedor, funcionário, conta, contrapartida, histórico, número do documento ou valor."
                  />
                ) : searchQuery.isLoading ? (
                  <LoadingRows />
                ) : searchQuery.error ? (
                  <ErrorState
                    message={(searchQuery.error as Error).message}
                    onRetry={() => void searchQuery.refetch()}
                  />
                ) : (searchQuery.data?.rows.length ?? 0) === 0 ? (
                  <EmptyState
                    title="Nenhum lançamento encontrado"
                    description={`Nada combina com “${freeTerm}” neste período.`}
                  />
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                        <p className="text-sm text-muted-foreground">
                          {searchQuery.data!.total} lançamento(s) encontrado(s)
                        </p>
                        <ExportButtons table={buscaTable()} filename={`busca-${freeTerm}`} />
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Núm. doc.</TableHead>
                            <TableHead>Conta débito</TableHead>
                            <TableHead>Conta crédito</TableHead>
                            <TableHead className="text-right">Valor</TableHead>
                            <TableHead>Histórico</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {searchQuery.data!.rows.map((row) => (
                            <TableRow
                              key={row.id}
                              className="cursor-pointer"
                              onClick={() => {
                                if (row.doc_number) {
                                  setDocInput(row.doc_number);
                                  setDocNumber(row.doc_number);
                                }
                              }}
                            >
                              <TableCell className="whitespace-nowrap">
                                {fmtDate(row.entry_date)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap font-medium">
                                {row.doc_number ?? "—"}
                              </TableCell>
                              <TableCell>{row.debit_name ?? row.debit_code ?? "—"}</TableCell>
                              <TableCell>{row.credit_name ?? row.credit_code ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(row.valor)}
                              </TableCell>
                              <TableCell className="max-w-[320px]">
                                <span className="block truncate">{row.historico ?? "—"}</span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
                        <span>
                          {freePage * SEARCH_PAGE_SIZE + 1}–
                          {freePage * SEARCH_PAGE_SIZE + searchQuery.data!.rows.length} de{" "}
                          {searchQuery.data!.total}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={freePage === 0}
                            onClick={() => setFreePage((p) => Math.max(0, p - 1))}
                          >
                            Anterior
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              (freePage + 1) * SEARCH_PAGE_SIZE >= (searchQuery.data!.total ?? 0)
                            }
                            onClick={() => setFreePage((p) => p + 1)}
                          >
                            Próxima
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>

            ) : documentQuery.isLoading ? (
              <LoadingRows />
            ) : documentQuery.data && documentQuery.data.legs.length > 0 ? (
              <Card>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-end border-b px-4 pt-3">
                    <ExportButtons
                      table={lancamentoTable()}
                      filename={`lancamento-${documentQuery.data.doc_number}`}
                    />
                  </div>
                  <div className="flex flex-wrap gap-6 border-b p-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Lançamento</p>
                      <p className="font-medium">{documentQuery.data.doc_number}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total débito</p>
                      <p className="tabular-nums font-medium">
                        {formatCurrency(documentQuery.data.total_debit)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total crédito</p>
                      <p className="tabular-nums font-medium">
                        {formatCurrency(documentQuery.data.total_credit)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Conferência</p>
                      <Badge
                        variant={
                          Math.abs(
                            Number(documentQuery.data.total_debit) -
                              Number(documentQuery.data.total_credit),
                          ) < 0.01
                            ? "default"
                            : "destructive"
                        }
                      >
                        {Math.abs(
                          Number(documentQuery.data.total_debit) -
                            Number(documentQuery.data.total_credit),
                        ) < 0.01
                          ? "Débito = crédito"
                          : "Partidas desbalanceadas"}
                      </Badge>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Conta</TableHead>
                        <TableHead>Contrapartida</TableHead>
                        <TableHead>Histórico</TableHead>
                        <TableHead className="text-right">Débito</TableHead>
                        <TableHead className="text-right">Crédito</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documentQuery.data.legs.map((leg) => (
                        <TableRow key={leg.id}>
                          <TableCell className="whitespace-nowrap">
                            {fmtDate(leg.entry_date)}
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => {
                                setSelectedAccount(leg.account_reduced_code);
                                setTab("extrato");
                              }}
                            >
                              {leg.account_name ?? leg.account_reduced_code}
                            </button>
                          </TableCell>
                          <TableCell>{leg.counterpart_name ?? leg.counterpart_reduced_code ?? "—"}</TableCell>
                          <TableCell className="max-w-[320px]">
                            <span className="block truncate">{leg.historico ?? "—"}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {leg.debit ? formatCurrency(leg.debit) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {leg.credit ? formatCurrency(leg.credit) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                title="Lançamento não encontrado"
                description="Confira o número informado para este período."
              />
            )}
          </TabsContent>

          {/* ------------------------ CONFERÊNCIA ------------------------ */}
          <TabsContent value="conferencia">
            {reconciliation.isLoading ? (
              <LoadingRows />
            ) : reconciliation.error ? (
              <ErrorState
                message={(reconciliation.error as Error).message}
                onRetry={() => void reconciliation.refetch()}
              />
            ) : reconciliation.data ? (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-4">
                  {[
                    ["Conferem", reconciliation.data.ok],
                    ["Divergentes", reconciliation.data.divergente],
                    ["Só no razão", reconciliation.data.so_razao],
                    ["Só no balancete", reconciliation.data.so_balancete],
                  ].map(([label, value]) => (
                    <Card key={String(label)}>
                      <CardContent className="pt-6">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-2xl font-semibold tabular-nums">{value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                {reconciliation.data.linhas.length === 0 ? (
                  <EmptyState
                    title="Razão e balancete conferem"
                    description="Nenhuma divergência encontrada neste período."
                  />
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Conta</TableHead>
                            <TableHead>Código</TableHead>
                            <TableHead className="text-right">Débito razão</TableHead>
                            <TableHead className="text-right">Débito balancete</TableHead>
                            <TableHead className="text-right">Crédito razão</TableHead>
                            <TableHead className="text-right">Crédito balancete</TableHead>
                            <TableHead>Situação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reconciliation.data.linhas.map((row, index) => (
                            <TableRow key={`${row.reduced_code}-${row.code}-${index}`}>
                              <TableCell className="max-w-[260px]">
                                <span className="block truncate font-medium">{row.name ?? "—"}</span>
                                <span className="text-xs text-muted-foreground">
                                  {row.reduced_code}
                                </span>
                              </TableCell>
                              <TableCell>{row.code ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(row.razao_debito)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.balancete_debito != null
                                  ? formatCurrency(row.balancete_debito)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatCurrency(row.razao_credito)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {row.balancete_credito != null
                                  ? formatCurrency(row.balancete_credito)
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={row.status === "divergente" ? "destructive" : "secondary"}
                                >
                                  {row.status === "divergente"
                                    ? "Divergente"
                                    : row.status === "so_razao"
                                      ? "Só no razão"
                                      : "Só no balancete"}
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
            ) : null}
          </TabsContent>

          {/* -------------------------- VÍNCULOS -------------------------- */}
          <TabsContent value="vinculos">
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <p className="text-sm text-muted-foreground">
                  {pending.length} conta(s) do razão ainda sem código do balancete ou sem natureza.
                </p>
                {isAdmin ? (
                  <Button
                    onClick={() => linkMutation.mutate()}
                    disabled={linkMutation.isPending}
                    variant="outline"
                  >
                    {linkMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Casar automaticamente
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            {pending.length === 0 ? (
              <EmptyState
                title="Nenhum vínculo pendente"
                description="Todas as contas com movimento estão ligadas ao balancete e classificadas."
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conta do razão</TableHead>
                        <TableHead>Conta do balancete</TableHead>
                        <TableHead>Natureza</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pending.map((account) => (
                        <TableRow key={account.reduced_code}>
                          <TableCell>
                            <span className="block font-medium">{account.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {account.reduced_code}
                            </span>
                          </TableCell>
                          <TableCell className="min-w-[280px]">
                            <Select
                              value={account.hierarchical_code ?? ""}
                              disabled={!isAdmin || saveLinkMutation.isPending}
                              onValueChange={(code) =>
                                saveLinkMutation.mutate({
                                  reduced_code: account.reduced_code,
                                  hierarchical_code: code,
                                })
                              }
                            >
                              <SelectTrigger aria-label={`Conta do balancete de ${account.name}`}>
                                <SelectValue placeholder="Selecionar conta do balancete" />
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {(tbAccounts.data ?? []).map((line) => (
                                  <SelectItem key={line.code} value={line.code}>
                                    {line.code} — {line.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="min-w-[220px]">
                            <Select
                              value={account.nature ?? ""}
                              disabled={!isAdmin || saveLinkMutation.isPending}
                              onValueChange={(nature) =>
                                saveLinkMutation.mutate({
                                  reduced_code: account.reduced_code,
                                  nature,
                                })
                              }
                            >
                              <SelectTrigger aria-label={`Natureza de ${account.name}`}>
                                <SelectValue placeholder="Sem natureza" />
                              </SelectTrigger>
                              <SelectContent>
                                {NATURE_OPTIONS.map((nature) => (
                                  <SelectItem key={nature} value={nature}>
                                    {NATURE_LABEL[nature]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          {/* ------------------------- PENDÊNCIAS ------------------------- */}
          <TabsContent value="pendencias">
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <p className="text-sm text-muted-foreground">
                  Relatório de pendências do casamento razão × balancete, com a causa provável de
                  cada uma.
                </p>
                <div className="flex gap-2">
                  {isAdmin ? (
                    <Button
                      variant="outline"
                      onClick={() => linkMutation.mutate()}
                      disabled={linkMutation.isPending}
                    >
                      {linkMutation.isPending ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Casar automaticamente
                    </Button>
                  ) : null}
                  <ExportButtons
                    table={
                      pendingQuery.data
                        ? {
                            title: "Pendências do razão",
                            subtitle: `Período ${selectedPeriod?.label ?? ""}`,
                            headers: [
                              "Conta reduzida",
                              "Nome",
                              "Código balancete",
                              "Causa",
                              "Detalhe",
                              "Ação sugerida",
                            ],
                            rows: pendingQuery.data.linhas.map((row) => [
                              row.reduced_code ?? "",
                              row.name ?? "",
                              row.code ?? "",
                              PENDING_CAUSE[row.causa] ?? row.causa,
                              row.detalhe,
                              row.acao,
                            ]),
                          }
                        : null
                    }
                    filename="pendencias-razao"
                  />
                </div>
              </CardContent>
            </Card>

            {pendingQuery.isLoading ? (
              <LoadingRows />
            ) : pendingQuery.error ? (
              <ErrorState
                message={(pendingQuery.error as Error).message}
                onRetry={() => void pendingQuery.refetch()}
              />
            ) : pendingQuery.data && pendingQuery.data.linhas.length > 0 ? (
              <>
                <div className="mb-4 flex flex-wrap gap-2">
                  {Object.entries(pendingQuery.data.por_causa).map(([causa, count]) => (
                    <Badge key={causa} variant="secondary">
                      {(PENDING_CAUSE[causa] ?? causa) + `: ${count}`}
                    </Badge>
                  ))}
                </div>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Conta</TableHead>
                          <TableHead>Causa provável</TableHead>
                          <TableHead>Detalhe</TableHead>
                          <TableHead>Ação sugerida</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingQuery.data.linhas.map((row, index) => (
                          <TableRow key={`${row.reduced_code ?? row.code}-${index}`}>
                            <TableCell className="max-w-[240px]">
                              <span className="block truncate font-medium">{row.name ?? "—"}</span>
                              <span className="text-xs text-muted-foreground">
                                {row.reduced_code ?? "sem código reduzido"}
                                {row.code ? ` · ${row.code}` : ""}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.causa === "diferenca_valor" ? "destructive" : "secondary"
                                }
                              >
                                {PENDING_CAUSE[row.causa] ?? row.causa}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[380px]">
                              <span className="block truncate" title={row.detalhe}>
                                {row.detalhe}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {row.acao}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            ) : (
              <EmptyState
                title="Nenhuma pendência"
                description="Razão e balancete estão casados e todas as contas têm natureza."
              />
            )}
          </TabsContent>

          {/* -------------------------- HISTÓRICO -------------------------- */}
          <TabsContent value="historico">
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <p className="text-sm text-muted-foreground">
                  Trilha de auditoria de vínculos e classificações: quem alterou, quando e qual era
                  o valor anterior.
                </p>
                <ExportButtons
                  table={
                    auditQuery.data
                      ? {
                          title: "Trilha de auditoria — vínculos e classificações",
                          headers: [
                            "Data",
                            "Usuário",
                            "Conta",
                            "Campo",
                            "Valor anterior",
                            "Valor novo",
                            "Origem",
                          ],
                          rows: auditQuery.data.map((row) => [
                            formatDateTime(row.created_at),
                            row.actor_name,
                            `${row.account_key} ${row.account_name ?? ""}`.trim(),
                            row.field_changed,
                            row.old_value ?? "",
                            row.new_value ?? "",
                            row.source ?? "",
                          ]),
                        }
                      : null
                  }
                  filename="auditoria-razao"
                />
              </CardContent>
            </Card>

            {auditQuery.isLoading ? (
              <LoadingRows />
            ) : auditQuery.error ? (
              <ErrorState
                message={(auditQuery.error as Error).message}
                onRetry={() => void auditQuery.refetch()}
              />
            ) : (auditQuery.data ?? []).length === 0 ? (
              <EmptyState
                title="Nenhuma alteração registrada"
                description="Vínculos e classificações aplicados passam a aparecer aqui."
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Conta</TableHead>
                        <TableHead>Campo</TableHead>
                        <TableHead>De</TableHead>
                        <TableHead>Para</TableHead>
                        <TableHead>Origem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(auditQuery.data ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDateTime(row.created_at)}
                          </TableCell>
                          <TableCell>{row.actor_name}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <span className="block truncate font-medium">
                              {row.account_name ?? row.account_key}
                            </span>
                            <span className="text-xs text-muted-foreground">{row.account_key}</span>
                          </TableCell>
                          <TableCell>{row.field_changed}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.old_value ?? "—"}
                          </TableCell>
                          <TableCell className="font-medium">{row.new_value ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.source ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
