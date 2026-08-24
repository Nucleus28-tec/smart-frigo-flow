/**
 * Relatórios do razão contábil: seleção de contas do plano, filtros de data/documento,
 * visualização em tela do Razão Contábil Analítico e do Balancete Analítico,
 * com exportação em PDF (multi página opcional) e Excel.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Eraser,
  FileSpreadsheet,
  FileText,
  Loader2,
  Play,
  Rows3,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { EmptyState, ErrorState, LoadingRows } from "@/components/PageState";
import { DateRangeField } from "@/components/ui/date-range-field";
import { usePeriod } from "@/hooks/usePeriod";
import {
  exportLedgerReport,
  getLedgerReport,
  getTrialBalanceReport,
  listChartAccounts,
} from "@/lib/razao.functions";
import {
  amount,
  balanceLabel,
  formatDay,
  type LedgerReport,
  type ReportKind,
  type TrialBalanceReport,
} from "@/lib/razao-report-types";


const PAGE_SIZE = 100;

type AccountRow = {
  id: string;
  reduced_code: string;
  hierarchical_code: string | null;
  name: string;
  legs_count: number;
};

export type DrillDown = {
  token: string;
  codes: string[];
  kind?: ReportKind;
  from?: string | null;
  to?: string | null;
};

type ViewOverrides = {
  codes?: string[];
  kind?: ReportKind;
  from?: string | null;
  to?: string | null;
};

type Props = {
  periodId: string;
  periodLabel: string;
  referenceMonth: string | null;
  drill?: DrillDown | null;
};

function monthRange(referenceMonth: string | null) {
  if (!referenceMonth) return { from: "", to: "" };
  const base = referenceMonth.slice(0, 10);
  const [y, m] = base.split("-").map(Number);
  if (!y || !m) return { from: "", to: "" };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${base.slice(0, 8)}01`,
    to: `${base.slice(0, 8)}${String(last).padStart(2, "0")}`,
  };
}

export function RelatoriosRazao({ periodId, periodLabel, referenceMonth, drill }: Props) {
  const initial = monthRange(referenceMonth);
  const { periods } = usePeriod();
  const [kind, setKind] = useState<ReportKind>("razao");
  const [range, setRange] = useState({ from: initial.from, to: initial.to });
  const from = range.from;
  const to = range.to;
  const [docNumber, setDocNumber] = useState("");
  const [multiPage, setMultiPage] = useState(false);
  const [onlyWithMovement, setOnlyWithMovement] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [compact, setCompact] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerReport | null>(null);
  const [trial, setTrial] = useState<TrialBalanceReport | null>(null);

  const runList = useServerFn(listChartAccounts);
  const runLedger = useServerFn(getLedgerReport);
  const runTrial = useServerFn(getTrialBalanceReport);
  const runExport = useServerFn(exportLedgerReport);

  /** Períodos contábeis cujo mês de referência intersecta o intervalo escolhido. */
  const periodIds = useMemo(() => {
    if (!from && !to) return [periodId];
    const matches = periods
      .filter((p) => {
        const base = p.reference_month.slice(0, 10);
        const [y, m] = base.split("-").map(Number);
        if (!y || !m) return false;
        const start = `${base.slice(0, 8)}01`;
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const end = `${base.slice(0, 8)}${String(lastDay).padStart(2, "0")}`;
        if (from && end < from) return false;
        if (to && start > to) return false;
        return true;
      })
      .map((p) => p.id);
    return matches.length ? matches : [periodId];
  }, [periods, periodId, from, to]);

  const accountsQuery = useQuery({
    queryKey: ["report_accounts", periodId, query, page],
    queryFn: async () => {
      const result = (await runList({
        data: {
          period_id: periodId,
          query,
          nature: null,
          type: null,
          only_pending: false,
          only_active: false,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      })) as unknown as { total: number; rows: AccountRow[] };
      return result;
    },
  });

  const rows = useMemo(() => {
    const list = accountsQuery.data?.rows ?? [];
    return onlyWithMovement ? list.filter((r) => Number(r.legs_count) > 0) : list;
  }, [accountsQuery.data, onlyWithMovement]);

  const total = accountsQuery.data?.total ?? 0;
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.includes(r.reduced_code));

  const filters = (overrides?: ViewOverrides) => ({
    period_id: periodId,
    period_ids: periodIds,
    codes: overrides?.codes ?? selected,
    from: (overrides?.from ?? from) || null,
    to: (overrides?.to ?? to) || null,
  });


  async function handleView(overrides?: ViewOverrides) {
    const effectiveKind = overrides?.kind ?? kind;
    setBusy("view");
    try {
      if (effectiveKind === "razao") {
        const result = (await runLedger({
          data: { ...filters(overrides), doc_number: docNumber.trim() || null },
        })) as unknown as LedgerReport;
        setLedger(result);
        setTrial(null);
        if ((result?.accounts ?? []).length === 0) toast.info("Nenhum lançamento no filtro.");
        if (result?.truncated) toast.warning("Resultado muito grande: exibindo as primeiras linhas.");
      } else {
        const result = (await runTrial({ data: filters(overrides) })) as unknown as TrialBalanceReport;
        setTrial(result);
        setLedger(null);
        if ((result?.rows ?? []).length === 0) toast.info("Nenhum movimento no filtro.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar o relatório.");
    } finally {
      setBusy(null);
    }
  }

  /** Drill-down vindo de /demonstrativos: aplica os filtros da linha e já executa. */
  const lastDrill = useRef<string | null>(null);
  useEffect(() => {
    if (!drill || drill.token === lastDrill.current) return;
    lastDrill.current = drill.token;
    const codes = drill.codes ?? [];
    const drillKind = drill.kind ?? "razao";
    const next = { from: drill.from ?? initial.from, to: drill.to ?? initial.to };
    setKind(drillKind);
    setSelected(codes);
    setDocNumber("");
    setRange(next);
    void handleView({ codes, kind: drillKind, from: next.from, to: next.to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill?.token]);

  /** Gera o arquivo no servidor e devolve o conteúdo para uso local. */
  async function generate(format: "pdf" | "xlsx") {
    return runExport({
      data: {
        ...filters(),
        doc_number: docNumber.trim() || null,
        kind,
        format,
        multi_page: kind === "razao" && multiPage,
      },
    });
  }

  async function handleExport(format: "pdf" | "xlsx") {
    setBusy(format);
    try {
      // O arquivo vem no retorno da função (base64) e o download é montado no
      // navegador: sem pop-up e sem URL assinada de outro domínio.
      const result = await generate(format);
      downloadExported(result);
      if (result.storage_error) {
        toast.warning("Arquivo baixado, mas não foi possível arquivá-lo no histórico.");
      }
      toast.success(`Download iniciado: ${result.file_name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview() {
    setBusy("preview");
    try {
      const result = await generate("pdf");
      setPreview({
        base64: result.base64,
        content_type: result.content_type,
        file_name: result.file_name,
        size: result.size,
        title:
          kind === "razao"
            ? `Razão Contábil Analítico — ${periodLabel}`
            : `Balancete Analítico — ${periodLabel}`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar a pré-visualização.");
    } finally {
      setBusy(null);
    }
  }

  const cellPad = compact ? "py-1" : "py-2";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de relatório</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ReportKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="razao">Razão Contábil Analítico</SelectItem>
                <SelectItem value="balancete">Balancete Analítico</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Data movimento (de / até)</Label>
            <DateRangeField
              value={range}
              onChange={setRange}
              referenceMonth={referenceMonth}
              placeholder="Todo o período"
            />
            <p className="text-[11px] text-muted-foreground">
              {periodIds.length > 1
                ? `${periodIds.length} períodos contábeis incluídos no intervalo.`
                : `Período ${periodLabel}.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Núm. documento</Label>
            <Input
              value={docNumber}
              placeholder="opcional"
              disabled={kind !== "razao"}
              onChange={(e) => setDocNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Multi página</Label>
            <Select
              value={multiPage ? "sim" : "nao"}
              onValueChange={(value) => setMultiPage(value === "sim")}
              disabled={kind !== "razao"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nao">NÃO</SelectItem>
                <SelectItem value="sim">SIM — uma conta por página</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Pesquisar por código, plano de contas ou descrição"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={onlyWithMovement}
                onCheckedChange={(value) => setOnlyWithMovement(value === true)}
              />
              Somente contas com movimento
            </label>
            <Button variant="outline" size="sm" onClick={() => setCompact((v) => !v)}>
              <Rows3 className="mr-2 h-4 w-4" />
              {compact ? "Compacto" : "Confortável"}
            </Button>
            <Badge variant="secondary">{selected.length} selecionada(s)</Badge>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              <Eraser className="mr-2 h-4 w-4" /> Limpar seleção
            </Button>
          </div>

          {accountsQuery.isLoading ? (
            <LoadingRows />
          ) : accountsQuery.error ? (
            <ErrorState
              message={(accountsQuery.error as Error).message}
              onRetry={() => void accountsQuery.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nenhuma conta encontrada"
              description="Ajuste a pesquisa ou desmarque “somente contas com movimento”."
            />
          ) : (
            <div className="max-h-[340px] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/60">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(value) => {
                          const codes = rows.map((r) => r.reduced_code);
                          setSelected((prev) =>
                            value === true
                              ? Array.from(new Set([...prev, ...codes]))
                              : prev.filter((c) => !codes.includes(c)),
                          );
                        }}
                      />
                    </TableHead>
                    <TableHead className="w-28">Código</TableHead>
                    <TableHead className="w-48">Plano de contas</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-20 text-right">Lçtos.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const checked = selected.includes(row.reduced_code);
                    return (
                      <TableRow
                        key={row.id}
                        data-state={checked ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() =>
                          setSelected((prev) =>
                            checked
                              ? prev.filter((c) => c !== row.reduced_code)
                              : [...prev, row.reduced_code],
                          )
                        }
                      >
                        <TableCell className={cellPad}>
                          <Checkbox checked={checked} />
                        </TableCell>
                        <TableCell className={`${cellPad} font-mono text-xs`}>
                          {row.reduced_code}
                        </TableCell>
                        <TableCell className={`${cellPad} font-mono text-xs`}>
                          {row.hierarchical_code ?? "—"}
                        </TableCell>
                        <TableCell className={`${cellPad} text-sm`}>{row.name}</TableCell>
                        <TableCell className={`${cellPad} text-right text-xs tabular-nums`}>
                          {row.legs_count}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {total} conta(s) · página {page + 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              Sem seleção = todas as contas com movimento no intervalo.
            </span>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button onClick={() => void handleView()} disabled={busy !== null}>
              {busy === "view" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Visualizar
            </Button>
            <Button variant="secondary" onClick={() => void handleExport("pdf")} disabled={busy !== null}>
              {busy === "pdf" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Exportar PDF
            </Button>
            <Button variant="secondary" onClick={() => void handleExport("xlsx")} disabled={busy !== null}>
              {busy === "xlsx" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Exportar Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {ledger ? <LedgerView report={ledger} periodLabel={periodLabel} /> : null}
      {trial ? <TrialView report={trial} periodLabel={periodLabel} /> : null}
    </div>
  );
}

function LedgerView({ report, periodLabel }: { report: LedgerReport; periodLabel: string }) {
  if ((report.accounts ?? []).length === 0) {
    return (
      <EmptyState
        title="Sem lançamentos no filtro"
        description="Nenhum movimento encontrado para as contas e datas selecionadas."
      />
    );
  }
  return (
    <Card>
      <CardContent className="space-y-6 p-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Relatório Razão Contábil Analítico
          </h3>
          <p className="text-xs text-muted-foreground">
            {periodLabel} · Data mov.: {formatDay(report.from_actual ?? report.from) || "início"} a{" "}
            {formatDay(report.to_actual ?? report.to) || "fim"} ·{" "}
            {report.total_lines ?? report.accounts.reduce((s, a) => s + a.line_count, 0)}{" "}
            lançamentos
          </p>
        </div>

        {report.accounts.map((account) => (
          <div key={account.code} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
              <span className="text-sm font-semibold">
                CONTA: {account.code} — {account.name}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {account.partidas_multiplas ? (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {account.partidas_multiplas} partida(s) múltipla(s)
                  </span>
                ) : null}
                Saldo anterior: {balanceLabel(account.opening_balance)}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Código</TableHead>
                  <TableHead className="w-24">Data</TableHead>
                  <TableHead className="w-28">Contra-part.</TableHead>
                  <TableHead>Histórico</TableHead>
                  <TableHead className="w-28 text-right">Débito</TableHead>
                  <TableHead className="w-28 text-right">Crédito</TableHead>
                  <TableHead className="w-32 text-right">Saldo atual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="py-1 font-mono text-xs">{line.doc_number ?? ""}</TableCell>
                    <TableCell className="py-1 text-xs">{formatDay(line.entry_date)}</TableCell>
                    <TableCell className="py-1 font-mono text-xs">
                      {line.counterpart_reduced_code ?? (
                        <span className="text-amber-600 dark:text-amber-400">múltipla</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-xs">{line.historico ?? ""}</TableCell>
                    <TableCell className="py-1 text-right text-xs tabular-nums">
                      {line.debit ? amount(line.debit) : ""}
                    </TableCell>
                    <TableCell className="py-1 text-right text-xs tabular-nums">
                      {line.credit ? amount(line.credit) : ""}
                    </TableCell>
                    <TableCell className="py-1 text-right text-xs tabular-nums">
                      {balanceLabel(line.running_balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell className="py-1 text-xs" colSpan={4}>
                    Total de itens: {account.line_count}
                  </TableCell>
                  <TableCell className="py-1 text-right text-xs tabular-nums">
                    {amount(account.total_debit)}
                  </TableCell>
                  <TableCell className="py-1 text-right text-xs tabular-nums">
                    {amount(account.total_credit)}
                  </TableCell>
                  <TableCell className="py-1 text-right text-xs tabular-nums">
                    {balanceLabel(account.closing_balance)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TrialView({ report, periodLabel }: { report: TrialBalanceReport; periodLabel: string }) {
  if ((report.rows ?? []).length === 0) {
    return (
      <EmptyState
        title="Sem movimento no filtro"
        description="Nenhuma conta movimentada para o intervalo selecionado."
      />
    );
  }
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide">Balancete Analítico</h3>
          <p className="text-xs text-muted-foreground">
            {periodLabel} · Data mov.: {formatDay(report.from) || "início"} a{" "}
            {formatDay(report.to) || "fim"}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead className="w-44">Plano de contas</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-36 text-right">Saldo anterior</TableHead>
              <TableHead className="w-32 text-right">Débito</TableHead>
              <TableHead className="w-32 text-right">Crédito</TableHead>
              <TableHead className="w-36 text-right">Saldo atual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row) => (
              <TableRow key={row.code}>
                <TableCell className="py-1 font-mono text-xs">{row.code}</TableCell>
                <TableCell className="py-1 font-mono text-xs">
                  {row.hierarchical_code ?? "—"}
                </TableCell>
                <TableCell className="py-1 text-xs">{row.name}</TableCell>
                <TableCell className="py-1 text-right text-xs tabular-nums">
                  {balanceLabel(row.saldo_anterior)}
                </TableCell>
                <TableCell className="py-1 text-right text-xs tabular-nums">
                  {amount(row.debito)}
                </TableCell>
                <TableCell className="py-1 text-right text-xs tabular-nums">
                  {amount(row.credito)}
                </TableCell>
                <TableCell className="py-1 text-right text-xs tabular-nums">
                  {balanceLabel(row.saldo_atual)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/60 font-semibold">
              <TableCell className="py-1 text-xs" colSpan={4}>
                Total de contas: {report.rows.length}
              </TableCell>
              <TableCell className="py-1 text-right text-xs tabular-nums">
                {amount(report.totals.debito)}
              </TableCell>
              <TableCell className="py-1 text-right text-xs tabular-nums">
                {amount(report.totals.credito)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
