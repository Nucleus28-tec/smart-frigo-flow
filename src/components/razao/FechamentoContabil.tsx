/**
 * Fechamento contábil: grade dos 12 meses do exercício, resumo de saldos por grupo
 * e geração dos lançamentos de encerramento (parcial por mês e do exercício).
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarPlus,
  FileSpreadsheet,
  FileText,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorState, LoadingRows } from "@/components/PageState";
import {
  closeFiscalYear,
  closePeriodPartial,
  ensurePeriodForMonth,
  exportLedgerReport,
  getClosingGrid,
  getClosingSummary,
  reopenFiscalYear,
  reopenPeriod,
  saveClosingAccounts,
} from "@/lib/razao.functions";
import { amount, balanceLabel } from "@/lib/razao-report-types";
import { downloadExported } from "@/lib/razao-export";

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

type MonthRow = {
  month: number;
  period_id: string | null;
  label: string | null;
  status: string;
  closing_id: string | null;
  closed_at: string | null;
  mode: string | null;
  result_value: number | null;
  closed_by_name: string | null;
  has_external_closing: boolean;
};

type Grid = {
  year: number;
  months: MonthRow[];
  annual: { id: string; closed_at: string; result_value: number; closed_by_name: string } | null;
  closed_months: number;
  period_count: number;
  result_code: string;
  profit_code: string;
  is_admin: boolean;
};

type SummaryRow = {
  grp: string;
  name: string;
  saldo_anterior: number;
  debito: number;
  credito: number;
  saldo_periodo: number;
  saldo_atual: number;
};

type Props = {
  periodId: string | null;
  periodLabel: string;
  referenceMonth: string | null;
  isAdmin: boolean;
};

function statusBadge(row: MonthRow) {
  if (row.status === "inexistente")
    return <Badge variant="outline">Não cadastrado</Badge>;
  if (row.status === "fechado")
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Fechado</Badge>;
  if (row.status === "em_revisao") return <Badge variant="secondary">Em revisão</Badge>;
  return <Badge variant="outline">Aberto</Badge>;
}

function listMonths(months: number[]) {
  const names = months.map((m) => MONTHS[m - 1]);
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Motivo que impede fechar o mês, ou null quando o fechamento é permitido. */
function closeBlocker(row: MonthRow, grid: Grid | undefined): string | null {
  if (!grid) return null;
  if (grid.annual)
    return `O exercício ${grid.year} está fechado. Cancele o fechamento do exercício antes de movimentar os meses.`;
  const pending = grid.months
    .filter((m) => m.month < row.month && m.status !== "fechado" && m.status !== "inexistente")
    .map((m) => m.month);
  if (pending.length > 0)
    return `Ordem obrigatória: feche antes ${listMonths(pending)} de ${grid.year}.`;
  return null;
}

/** Motivo que impede cancelar o fechamento do mês, ou null quando é permitido. */
function reopenBlocker(row: MonthRow, grid: Grid | undefined): string | null {
  if (!grid) return null;
  if (grid.annual)
    return `Cancele primeiro o fechamento do exercício ${grid.year} para poder reabrir os meses.`;
  const later = grid.months.filter((m) => m.month > row.month && m.status === "fechado").map((m) => m.month);
  if (later.length > 0)
    return `Ordem obrigatória: reabra antes ${listMonths(later)} de ${grid.year} (do mês mais recente para o mais antigo).`;
  return null;
}

/** Motivo que impede fechar o exercício, ou null quando é permitido. */
function yearBlocker(grid: Grid | undefined): string | null {
  if (!grid) return null;
  const missing = grid.months.filter((m) => m.status === "inexistente").map((m) => m.month);
  if (missing.length > 0)
    return `Falta cadastrar o período de ${listMonths(missing)} de ${grid.year}.`;
  const open = grid.months.filter((m) => m.status !== "fechado").map((m) => m.month);
  if (open.length > 0)
    return `Ainda estão abertos ${listMonths(open)} de ${grid.year}. Feche os 12 meses, em ordem, antes do fechamento anual.`;
  return null;
}


export function FechamentoContabil({ periodId, periodLabel, referenceMonth, isAdmin }: Props) {
  const currentYear = referenceMonth ? Number(referenceMonth.slice(0, 4)) : new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [busy, setBusy] = useState<string | null>(null);
  const [resultCode, setResultCode] = useState("");
  const [profitCode, setProfitCode] = useState("");
  const [confirm, setConfirm] = useState<
    | null
    | { kind: "close"; row: MonthRow }
    | { kind: "reopen"; row: MonthRow }
    | { kind: "close-year" }
    | { kind: "reopen-year" }
  >(null);

  const qc = useQueryClient();
  const runGrid = useServerFn(getClosingGrid);
  const runSummary = useServerFn(getClosingSummary);
  const runClose = useServerFn(closePeriodPartial);
  const runReopen = useServerFn(reopenPeriod);
  const runCloseYear = useServerFn(closeFiscalYear);
  const runReopenYear = useServerFn(reopenFiscalYear);
  const runSaveAccounts = useServerFn(saveClosingAccounts);
  const runEnsurePeriod = useServerFn(ensurePeriodForMonth);

  const gridQuery = useQuery({
    queryKey: ["closing_grid", year],
    queryFn: async () => {
      const result = (await runGrid({ data: { year } })) as unknown as Grid;
      setResultCode((prev) => prev || result.result_code);
      setProfitCode((prev) => prev || result.profit_code);
      return result;
    },
  });

  const summaryQuery = useQuery({
    queryKey: ["closing_summary", periodId],
    enabled: Boolean(periodId),
    queryFn: async () => {
      const result = (await runSummary({ data: { period_id: periodId! } })) as unknown as {
        rows: SummaryRow[];
      };
      return result.rows ?? [];
    },
  });

  const years = useMemo(() => {
    const base = new Date().getFullYear();
    const set = new Set([base, base - 1, base + 1, currentYear, year]);
    return Array.from(set).sort((a, b) => b - a);
  }, [currentYear, year]);

  const grid = gridQuery.data;
  const yearBlock = yearBlocker(grid);

  const totals = useMemo(() => {
    const rows = summaryQuery.data ?? [];
    return rows.reduce(
      (acc, row) => ({
        debito: acc.debito + Number(row.debito),
        credito: acc.credito + Number(row.credito),
      }),
      { debito: 0, credito: 0 },
    );
  }, [summaryQuery.data]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["closing_grid"] });
    void qc.invalidateQueries({ queryKey: ["closing_summary"] });
    void qc.invalidateQueries({ queryKey: ["accounting_periods"] });
    void qc.invalidateQueries({ queryKey: ["journal_entries"] });
  }

  async function action(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      toast.success(await fn());
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  async function handleExportBalancete(format: "pdf" | "xlsx", mode: "analitico" | "sintetico") {
    if (!periodId) {
      toast.error("Selecione um período no cabeçalho.");
      return;
    }
    setBusy(`${mode}-${format}`);
    try {
      const runExport = exportLedgerReport;
      const result = await runExport({
        data: {
          period_id: periodId,
          codes: [],
          from: null,
          to: null,
          doc_number: null,
          kind: "balancete" as const,
          format,
          multi_page: false,
          mode,
          show_plan: mode === "analitico",
        },
      });
      downloadExported(result);
      toast.success(`Download iniciado: ${result.file_name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Exercício</Label>
            <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Conta de resultado do exercício</Label>
            <Input
              className="w-56"
              value={resultCode}
              disabled={!isAdmin}
              onChange={(e) => setResultCode(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Conta de lucros/prejuízos</Label>
            <Input
              className="w-56"
              value={profitCode}
              disabled={!isAdmin}
              onChange={(e) => setProfitCode(e.target.value)}
            />
          </div>
          {isAdmin ? (
            <Button
              variant="outline"
              disabled={busy === "accounts"}
              onClick={() =>
                void action("accounts", async () => {
                  await runSaveAccounts({
                    data: { result_code: resultCode, profit_code: profitCode },
                  });
                  return "Contas de encerramento salvas.";
                })
              }
            >
              {busy === "accounts" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar contas
            </Button>
          ) : null}

          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
            {grid?.annual ? (
              isAdmin ? (
                <Button variant="destructive" onClick={() => setConfirm({ kind: "reopen-year" })}>
                  <LockOpen className="mr-2 h-4 w-4" />
                  Cancelar fechamento do exercício
                </Button>
              ) : null
            ) : isAdmin ? (
              <div className="flex flex-col items-end gap-1">
                <Button
                  disabled={Boolean(yearBlock)}
                  title={yearBlock ?? undefined}
                  onClick={() => setConfirm({ kind: "close-year" })}
                >
                  <Lock className="mr-2 h-4 w-4" />
                  Fechar exercício {year}
                </Button>
                {yearBlock ? (
                  <span className="max-w-xs text-right text-xs text-muted-foreground">
                    {yearBlock}
                  </span>
                ) : null}
              </div>
            ) : null}

          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">
            Meses do exercício {year}
            {grid ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {grid.closed_months} de 12 fechados
              </span>
            ) : null}
          </CardTitle>
          {grid?.annual ? (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              Exercício fechado · resultado {balanceLabel(Number(grid.annual.result_value ?? 0))}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {gridQuery.isLoading ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : gridQuery.error ? (
            <div className="p-4">
              <ErrorState
                message={(gridQuery.error as Error).message}
                onRetry={() => void gridQuery.refetch()}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Mês</TableHead>
                  <TableHead className="w-40">Situação</TableHead>
                  <TableHead className="w-44 text-right">Resultado apurado</TableHead>
                  <TableHead>Fechado por</TableHead>
                  <TableHead className="w-72 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grid?.months ?? []).map((row) => {
                  const closed = row.status === "fechado";
                  const key = `m${row.month}`;
                  return (
                    <TableRow key={row.month} className={closed ? "bg-muted/40" : undefined}>
                      <TableCell className="py-1.5 font-medium">
                        {MONTHS[row.month - 1]}
                        {row.label ? (
                          <span className="ml-2 text-xs text-muted-foreground">{row.label}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-2">
                          {statusBadge(row)}
                          {row.has_external_closing && !closed ? (
                            <Badge variant="outline" className="text-amber-600">
                              Encerramento importado
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {row.result_value === null ? "—" : balanceLabel(Number(row.result_value))}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">
                        {row.closed_by_name ?? "—"}
                        {row.closed_at
                          ? ` · ${new Date(row.closed_at).toLocaleDateString("pt-BR")}`
                          : ""}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        {!isAdmin ? (
                          <span className="text-xs text-muted-foreground">Somente Admin</span>
                        ) : row.status === "inexistente" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === key}
                            onClick={() =>
                              void action(key, async () => {
                                await runEnsurePeriod({ data: { year, month: row.month } });
                                return `${MONTHS[row.month - 1]} criado.`;
                              })
                            }
                          >
                            <CalendarPlus className="mr-2 h-4 w-4" />
                            Criar período
                          </Button>
                        ) : closed ? (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === key || Boolean(reopenBlocker(row, grid))}
                              title={reopenBlocker(row, grid) ?? undefined}
                              onClick={() => setConfirm({ kind: "reopen", row })}
                            >
                              <LockOpen className="mr-2 h-4 w-4" />
                              Reabrir
                            </Button>
                            {reopenBlocker(row, grid) ? (
                              <span className="max-w-[18rem] text-right text-xs text-muted-foreground">
                                {reopenBlocker(row, grid)}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              disabled={busy === key || Boolean(closeBlocker(row, grid))}
                              title={closeBlocker(row, grid) ?? undefined}
                              onClick={() => setConfirm({ kind: "close", row })}
                            >
                              {busy === key ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Lock className="mr-2 h-4 w-4" />
                              )}
                              Fechar mês
                            </Button>
                            {closeBlocker(row, grid) ? (
                              <span className="max-w-[18rem] text-right text-xs text-muted-foreground">
                                {closeBlocker(row, grid)}
                              </span>
                            ) : null}
                          </div>
                        )}

                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-base">
            Resumo de saldos {periodLabel ? `· ${periodLabel}` : ""}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "analitico-pdf"}
              onClick={() => void handleExportBalancete("pdf", "analitico")}
            >
              <FileText className="mr-2 h-4 w-4" />
              Balancete analítico (PDF)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "sintetico-pdf"}
              onClick={() => void handleExportBalancete("pdf", "sintetico")}
            >
              <FileText className="mr-2 h-4 w-4" />
              Balancete sintético (PDF)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "analitico-xlsx"}
              onClick={() => void handleExportBalancete("xlsx", "analitico")}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {summaryQuery.isLoading ? (
            <div className="p-4">
              <LoadingRows />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Grupo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Saldo anterior</TableHead>
                  <TableHead className="text-right">Débito</TableHead>
                  <TableHead className="text-right">Crédito</TableHead>
                  <TableHead className="text-right">Saldo atual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summaryQuery.data ?? []).map((row) => (
                  <TableRow key={row.grp}>
                    <TableCell className="py-1.5 font-mono text-xs">{row.grp}</TableCell>
                    <TableCell className="py-1.5">{row.name}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">
                      {balanceLabel(Number(row.saldo_anterior))}
                    </TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">
                      {amount(Number(row.debito))}
                    </TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">
                      {amount(Number(row.credito))}
                    </TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">
                      {balanceLabel(Number(row.saldo_atual))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell className="py-1.5" colSpan={3}>
                    Totais do período
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">
                    {amount(totals.debito)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">
                    {amount(totals.credito)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">
                    {amount(totals.debito - totals.credito)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "close"
                ? `Fechar ${MONTHS[(confirm.row.month ?? 1) - 1]}/${year}?`
                : confirm?.kind === "reopen"
                  ? `Reabrir ${MONTHS[(confirm.row.month ?? 1) - 1]}/${year}?`
                  : confirm?.kind === "close-year"
                    ? `Fechar o exercício ${year}?`
                    : `Cancelar o fechamento do exercício ${year}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "close"
                ? "Serão gerados os lançamentos de apuração das contas de resultado contra a conta de resultado do exercício, e o período será travado para edição. Depois de fechado, só é possível reabrir este mês se nenhum mês posterior estiver fechado."
                : confirm?.kind === "reopen"
                  ? "Os lançamentos de encerramento gerados serão cancelados e o período volta a aceitar edições. A reabertura segue a ordem inversa: do mês mais recente para o mais antigo."
                  : confirm?.kind === "close-year"
                    ? "O saldo da conta de resultado será transferido para a conta de lucros/prejuízos acumulados em 31/12. Enquanto o exercício estiver fechado, nenhum mês do ano poderá ser fechado ou reaberto."
                    : "Os lançamentos do encerramento anual serão cancelados, liberando a reabertura dos meses (a partir de dezembro)."}
            </AlertDialogDescription>

          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === "close") {
                  const row = confirm.row;
                  void action(`m${row.month}`, async () => {
                    const result = (await runClose({
                      data: {
                        period_id: row.period_id!,
                        result_code: resultCode,
                        profit_code: profitCode,
                        mode: "gerar" as const,
                      },
                    })) as unknown as { accounts: number; result_value: number };
                    return `Mês fechado. ${result.accounts} contas encerradas · resultado ${balanceLabel(Number(result.result_value ?? 0))}.`;
                  });
                } else if (confirm.kind === "reopen") {
                  const row = confirm.row;
                  void action(`m${row.month}`, async () => {
                    await runReopen({ data: { period_id: row.period_id! } });
                    return "Período reaberto.";
                  });
                } else if (confirm.kind === "close-year") {
                  void action("year", async () => {
                    await runCloseYear({ data: { year } });
                    return `Exercício ${year} fechado.`;
                  });
                } else {
                  void action("year", async () => {
                    await runReopenYear({ data: { year } });
                    return `Fechamento do exercício ${year} cancelado.`;
                  });
                }
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
