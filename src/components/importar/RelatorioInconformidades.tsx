import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getImportDiagnostics, type ImportDiagnostics } from "@/lib/imports.functions";
import { formatCurrency } from "@/lib/rotta";

function formatDate(value: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

async function exportarExcel(diag: ImportDiagnostics) {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();

  const resumo = [
    ["Relatório de inconformidades da importação"],
    ["Período", diag.period_label],
    ["Débito total", diag.debit],
    ["Crédito total", diag.credit],
    ["Diferença (débito - crédito)", diag.difference],
    ["Contas no período", diag.accounts],
    [`Contas no período anterior (${diag.previous_label ?? "—"})`, diag.accounts_prev ?? ""],
    ["Documentos que não fecham", diag.unbalanced_docs.length],
    ["Contrapartidas sem conta no período", diag.missing_counterparts.length],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(resumo), "Resumo");

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      diag.unbalanced_docs.map((d) => ({
        Documento: d.doc_number,
        Data: formatDate(d.entry_date),
        Pernas: d.legs,
        Débito: d.debito,
        Crédito: d.credito,
        Diferença: d.diferenca,
        Conta: d.conta ?? "",
        Contrapartida: d.contrapartida ?? "",
        Histórico: d.historico ?? "",
        "Ação sugerida": "Conferir no G2 e lançar ajuste no razão",
      })),
    ),
    "Documentos sem fechar",
  );

  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      diag.missing_counterparts.map((c) => ({
        "Código da conta": c.codigo,
        Nome: c.nome ?? "(não cadastrada)",
        Ocorrências: c.ocorrencias,
        "Valor envolvido": c.valor,
        "Primeiro documento": c.primeiro_doc ?? "",
        "Primeira data": formatDate(c.primeira_data),
        "Ação sugerida": "Reexportar o razão do G2 incluindo esta conta",
      })),
    ),
    "Contrapartidas ausentes",
  );

  const slug = diag.period_label.replace(/[^\w]+/g, "-").toLowerCase();
  XLSX.writeFile(book, `inconformidades-${slug}.xlsx`);
}

export function RelatorioInconformidades({ periodId }: { periodId: string }) {
  const fetchDiagnostics = useServerFn(getImportDiagnostics);
  const query = useQuery({
    queryKey: ["import_diagnostics", periodId],
    queryFn: () => fetchDiagnostics({ data: { period_id: periodId } }),
  });

  const diag = query.data;
  if (query.isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Conferindo o razão do período…
        </CardContent>
      </Card>
    );
  }
  if (!diag) return null;

  const semProblema =
    diag.difference === 0 &&
    diag.unbalanced_docs.length === 0 &&
    diag.missing_counterparts.length === 0;
  const quedaContas =
    diag.accounts_prev != null && diag.accounts < diag.accounts_prev
      ? diag.accounts_prev - diag.accounts
      : 0;

  if (semProblema && quedaContas === 0) {
    return (
      <Card className="mb-6 border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="flex items-center gap-2 pt-6 text-sm">
          <CheckCircle2 className="size-4 text-emerald-600" />
          <span>
            Conferência do razão de {diag.period_label}: débito e crédito fecham e todas as
            contrapartidas têm conta no período.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-amber-500/40">
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-amber-600" />
            Relatório de inconformidades — {diag.period_label}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Débito {formatCurrency(diag.debit)} × crédito {formatCurrency(diag.credit)} ·{" "}
            <strong className={diag.difference === 0 ? "" : "text-amber-700 dark:text-amber-400"}>
              diferença {formatCurrency(diag.difference)}
            </strong>{" "}
            · {diag.accounts} contas
            {diag.accounts_prev != null
              ? ` (${diag.accounts_prev} em ${diag.previous_label ?? "mês anterior"})`
              : ""}
            .
          </p>
        </div>
        <Button variant="outline" onClick={() => void exportarExcel(diag).catch((e: Error) => toast.error(e.message))}>
          <FileSpreadsheet className="mr-2 size-4" />
          Exportar Excel
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {quedaContas > 0 ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {quedaContas} conta(s) a menos que em {diag.previous_label}. Pode ser truncamento na
            exportação do G2 — confira se o relatório saiu completo.
          </p>
        ) : null}

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Documentos em que débito ≠ crédito{" "}
            <Badge variant="outline">{diag.unbalanced_docs.length}</Badge>
          </h3>
          {diag.unbalanced_docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento desbalanceado.</p>
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Contrapartida</TableHead>
                    <TableHead className="text-right">Débito</TableHead>
                    <TableHead className="text-right">Crédito</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead>Histórico</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diag.unbalanced_docs.map((d) => (
                    <TableRow key={d.doc_number}>
                      <TableCell className="font-medium tabular-nums">{d.doc_number}</TableCell>
                      <TableCell className="tabular-nums">{formatDate(d.entry_date)}</TableCell>
                      <TableCell className="tabular-nums">{d.conta ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{d.contrapartida ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(d.debito)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(d.credito)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-amber-700 dark:text-amber-400">
                        {formatCurrency(d.diferenca)}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {d.historico ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/razao" search={{ tab: "lancamentos", q: d.doc_number } as never}>
                            Ver no razão
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Contrapartidas citadas sem conta no período{" "}
            <Badge variant="outline">{diag.missing_counterparts.length}</Badge>
          </h3>
          {diag.missing_counterparts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma contrapartida órfã.</p>
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead className="text-right">Ocorrências</TableHead>
                    <TableHead className="text-right">Valor envolvido</TableHead>
                    <TableHead>1º documento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diag.missing_counterparts.map((c) => (
                    <TableRow key={c.codigo}>
                      <TableCell className="font-medium tabular-nums">{c.codigo}</TableCell>
                      <TableCell>{c.nome ?? "(não cadastrada)"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.ocorrencias}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(c.valor)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {c.primeiro_doc ?? "—"} · {formatDate(c.primeira_data)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            A perna dessas contas não veio no arquivo do G2. Reexporte o razão incluindo-as ou lance
            o ajuste manualmente no razão — nada é corrigido automaticamente.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
