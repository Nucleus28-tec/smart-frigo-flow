import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { RelatorioInconformidades } from "@/components/importar/RelatorioInconformidades";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatDateTime } from "@/lib/rotta";
import {
  createUploadUrl,
  deleteImportedFile,
  getFileDownloadUrl,
  getPeriodMovementCount,
  parseImportedFile,
  purgePeriodJournal,
  registerImportedFile,
} from "@/lib/imports.functions";

import {
  finalizeJournalImport,
  importJournalChunk,
  importTrialBalanceMirror,
} from "@/lib/razao.functions";
import {
  extractPdfPages,
  parseBalancete,
  parseRazao,
  parseRazaoSheetMatrix,
} from "@/lib/razao-parser";
import {
  isSpreadsheet,
  looksLikeG2RazaoReport,
  readRawMatrix,
  readSheet,
  type SheetData,
} from "@/lib/planilha";
import {
  autoMap,
  buildLegs,
  loadSavedMapping,
  saveMapping,
  type Mapping,
} from "@/lib/razao-mapeamento";
import { MapeamentoColunas } from "@/components/razao/MapeamentoColunas";

export const Route = createFileRoute("/_authenticated/importar")({
  component: ImportarPage,
  head: () => ({
    meta: [
      { title: "Importar arquivos | Rotta Financeiro" },
      {
        name: "description",
        content: "Envio de balancetes, razões e documentos fiscais para o período contábil ativo.",
      },
      { property: "og:title", content: "Importar arquivos | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Envio de balancetes e documentos fiscais no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const FILE_TYPE_LABEL: Record<string, string> = {
  balancete: "Balancete (G2)",
  razao: "Razão contábil (G2)",
  pedido_compra: "Pedido de compra",
  nota_fiscal: "Nota fiscal",
  romaneio_abate: "Romaneio de abate",
  contas_pagar: "Contas a pagar",
  contas_receber: "Contas a receber",
  relatorio_vendas: "Relatório de vendas",
  extrato_sicoob: "Extrato Sicoob",
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  processando: "Processando",
  processado: "Processado",
  processado_com_alertas: "Importado com alertas",
  erro: "Erro",
};

type ImportedFile = {
  id: string;
  file_type: string;
  original_name: string;
  mime_type: string;
  processing_status: string;
  processing_error: string | null;
  created_at: string;
  uploaded_by: string;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "processado_com_alertas") {
    return (
      <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  const variant =
    status === "processado"
      ? "default"
      : status === "erro"
        ? "destructive"
        : status === "processando"
          ? "secondary"
          : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}

function ImportarPage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileType, setFileType] = useState<string>("balancete");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ImportedFile | null>(null);
  const [pendingPurge, setPendingPurge] = useState(false);

  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [skipClosing, setSkipClosing] = useState(true);

  const buildResult = useMemo(
    () => (sheet ? buildLegs(sheet.rows, mapping) : null),
    [sheet, mapping],
  );

  const isAdmin = profile?.role === "admin";
  const isClosed = selectedPeriod?.status === "fechado";

  const createUrl = useServerFn(createUploadUrl);
  const parseFile = useServerFn(parseImportedFile);
  const removeFile = useServerFn(deleteImportedFile);
  const countMovement = useServerFn(getPeriodMovementCount);
  const purgeMovement = useServerFn(purgePeriodJournal);

  const downloadUrl = useServerFn(getFileDownloadUrl);
  const registerFile = useServerFn(registerImportedFile);
  const sendJournalChunk = useServerFn(importJournalChunk);
  const sendMirror = useServerFn(importTrialBalanceMirror);
  const finalizeJournal = useServerFn(finalizeJournalImport);

  const filesQuery = useQuery({
    queryKey: ["imported_files", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((f) => f.processing_status === "processando") ? 4000 : false,
    queryFn: async (): Promise<ImportedFile[]> => {
      const { data, error } = await supabase
        .from("imported_files")
        .select(
          "id, file_type, original_name, mime_type, processing_status, processing_error, created_at, uploaded_by",
        )
        .eq("period_id", selectedPeriodId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ImportedFile[];
    },
  });

  const countsQuery = useQuery({
    queryKey: ["ledger_counts", selectedPeriodId, filesQuery.data?.map((f) => f.id).join(",")],
    enabled: Boolean(selectedPeriodId) && Boolean(filesQuery.data?.length),
    queryFn: async (): Promise<Record<string, number>> => {
      const counts: Record<string, number> = {};
      for (const file of filesQuery.data ?? []) {
        const legs = await supabase
          .from("journal_legs")
          .select("id", { count: "exact", head: true })
          .eq("file_id", file.id);
        if (legs.count && legs.count > 0) {
          counts[file.id] = legs.count;
          continue;
        }
        const entries = await supabase
          .from("ledger_entries")
          .select("id", { count: "exact", head: true })
          .eq("file_id", file.id);
        counts[file.id] = entries.count ?? 0;
      }
      return counts;
    },
  });


  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["imported_files", selectedPeriodId] });
    void queryClient.invalidateQueries({ queryKey: ["ledger_counts", selectedPeriodId] });
  };

  const processMutation = useMutation({
    mutationFn: (fileId: string) => parseFile({ data: { file_id: fileId } }),
    onSuccess: (result) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["recalculation_logs", selectedPeriodId] });
      const merge = result as Partial<{
        firstImport: boolean;
        updated: number;
        inserted: number;
        removed: number;
        manualPreserved: number;
      }>;
      if (merge.firstImport === false) {
        toast.success(
          `Recálculo concluído: ${merge.updated ?? 0} valores atualizados, ${merge.inserted ?? 0} novos, ${merge.removed ?? 0} removidos` +
            ((merge.manualPreserved ?? 0) > 0
              ? ` — ${merge.manualPreserved} edições manuais preservadas.`
              : "."),
          { description: "Veja o detalhe em Atualizações." },
        );
        return;
      }
      toast.success(
        result.entries > 0
          ? `Arquivo processado: ${result.entries} lançamentos gravados.`
          : "Arquivo armazenado com sucesso.",
      );
    },
    onError: (error: Error) => {
      invalidate();
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => removeFile({ data: { file_id: fileId } }),
    onSuccess: (result) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["period_movement", selectedPeriodId] });
      toast.success(
        `Arquivo excluído — ${result.journalLegs} lançamentos do razão removidos.` +
          (result.storageRemoved ? "" : " O arquivo físico não pôde ser apagado do armazenamento."),
      );
    },
    onError: (error: Error) => toast.error("Nada foi excluído", { description: error.message }),
  });

  const movementQuery = useQuery({
    queryKey: ["period_movement", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: () => countMovement({ data: { period_id: selectedPeriodId! } }),
  });

  const purgeMutation = useMutation({
    mutationFn: () => purgeMovement({ data: { period_id: selectedPeriodId! } }),
    onSuccess: (result) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["period_movement", selectedPeriodId] });
      toast.success(
        `Movimento de ${result.label} limpo: ${result.journalLegs} lançamentos removidos.`,
      );
    },
    onError: (error: Error) => toast.error("Não foi possível limpar", { description: error.message }),
  });


  /** Envia as pernas em blocos e finaliza (validação + casamento + recálculo). */
  async function enviarPernas(
    fileId: string,
    periodId: string,
    legs: unknown[],
    base = 45,
  ): Promise<void> {
    const CHUNK = 1500;
    const total = {
      inserted: 0,
      new_accounts: 0,
      openings: 0,
      skipped_closing: 0,
      ignored_no_account: 0,
      ignored_no_value: 0,
      bad_numbers: 0,
      bad_dates: 0,
    };
    for (let i = 0; i < legs.length; i += CHUNK) {
      const chunk = legs.slice(i, i + CHUNK);
      const result = await sendJournalChunk({
        data: {
          file_id: fileId,
          legs: chunk as never,
          reset: i === 0,
          skip_closing: skipClosing,
        },
      });
      for (const key of Object.keys(total) as (keyof typeof total)[]) {
        total[key] += ((result as unknown as Record<string, number | undefined>)[key] ?? 0);
      }
      const done = Math.min(i + CHUNK, legs.length);
      setProgress({
        label: `Gravando lançamentos (${done} de ${legs.length})...`,
        pct: base + (done / legs.length) * (95 - base),
      });
    }

    setProgress({ label: "Validando e recalculando o período...", pct: 96 });
    const done = await finalizeJournal({ data: { period_id: periodId, file_id: fileId } });
    setProgress(null);

    const detalhes = [
      `${total.inserted} lançamentos gravados`,
      `${total.new_accounts} conta(s) nova(s)`,
      `${total.openings} saldo(s) anterior(es)`,
      skipClosing ? `${total.skipped_closing} encerramento(s) descartado(s)` : null,
      total.ignored_no_account ? `${total.ignored_no_account} sem conta` : null,
      total.ignored_no_value ? `${total.ignored_no_value} cabeçalho(s) de conta` : null,
      total.bad_numbers ? `${total.bad_numbers} valor(es) inválido(s)` : null,
      total.bad_dates ? `${total.bad_dates} data(s) inválida(s)` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const alertas = [...(done.validation?.warnings ?? [])];
    if (done.gaps && done.gaps.lines > 0) {
      alertas.unshift(
        `Importação incompleta: ${done.gaps.lines} lançamento(s) perdido(s) em ${done.gaps.accounts} conta(s) (R$ ${done.gaps.value.toFixed(2)}). Reimporte o arquivo.`,
      );
    }
    const vinculadas = `${done.by_name + done.by_value} contas vinculadas`;
    if (alertas.length > 0) {
      toast.warning("Razão importado com alertas.", {
        description: `${alertas.join(" ")} — ${detalhes} · ${vinculadas}.`,
        duration: 12000,
      });
      return;
    }
    toast.success(`Razão importado: ${vinculadas}.`, {
      description:
        detalhes +
        (done.pending > 0
          ? ` · ${done.pending} conta(s) aguardam confirmação em Razão › Pendências.`
          : ""),
      duration: 10000,
    });
  }


  /** Lê o razão em PDF no navegador e envia as pernas em blocos. */
  async function importRazaoNoNavegador(fileId: string, periodId: string, source: File) {
    setProgress({ label: "Lendo o PDF do razão...", pct: 2 });
    const pages = await extractPdfPages(source, (page, total) =>
      setProgress({ label: `Lendo página ${page} de ${total}...`, pct: (page / total) * 45 }),
    );
    const { legs } = parseRazao(pages);
    if (legs.length === 0) throw new Error("Nenhum lançamento reconhecido neste arquivo.");
    await enviarPernas(fileId, periodId, legs);
  }

  /**
   * Lê o razão em XLS/XLSX exportado do G2 (relatório paginado por conta) e
   * envia as pernas em blocos, sem passar pelo mapeamento manual de colunas.
   */
  async function importRazaoPlanilhaG2(fileId: string, periodId: string, matrix: unknown[][]) {
    setProgress({ label: "Lendo o razão (layout G2)...", pct: 5 });
    const { legs } = parseRazaoSheetMatrix(matrix);
    if (legs.length === 0) throw new Error("Nenhum lançamento reconhecido neste arquivo.");
    await enviarPernas(fileId, periodId, legs);
  }

  /** Grava o espelho oficial do balancete (árvore de contas do G2). */
  async function importarEspelhoBalancete(fileId: string, source: File) {
    try {
      const pages = await extractPdfPages(source);
      const lines = parseBalancete(pages);
      if (!lines.length) return;
      for (let i = 0; i < lines.length; i += 1000) {
        await sendMirror({ data: { file_id: fileId, lines: lines.slice(i, i + 1000) } });
      }
      toast.success(`Espelho do balancete gravado: ${lines.length} contas.`);
    } catch {
      // espelho é complementar: falha aqui não impede a leitura principal
    }
  }

  async function enviarArquivo(source: File, periodId: string) {
    const { path, token } = await createUrl({
      data: { period_id: periodId, file_type: fileType as never, original_name: source.name },
    });
    const { error: uploadError } = await supabase.storage
      .from("imports")
      .uploadToSignedUrl(path, token, source);
    if (uploadError) throw new Error(uploadError.message);
    const { file_id } = await registerFile({
      data: {
        period_id: periodId,
        file_type: fileType as never,
        original_name: source.name,
        storage_path: path,
        mime_type: source.type || "application/octet-stream",
      },
    });
    return file_id;
  }

  function limparSelecao() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUpload() {
    if (!selectedPeriodId || !file) return;

    // Razão em planilha: detecta o relatório paginado do G2 (por blocos de
    // conta) e importa direto, sem mapeamento manual. Só cai no mapeamento de
    // colunas genérico se a planilha não tiver essa estrutura reconhecível.
    if (fileType === "razao" && isSpreadsheet(file)) {
      try {
        const { matrix } = await readRawMatrix(file);
        if (looksLikeG2RazaoReport(matrix)) {
          setUploading(true);
          try {
            const file_id = await enviarArquivo(file, selectedPeriodId);
            limparSelecao();
            invalidate();
            toast.success("Arquivo enviado. Lendo o razão (layout G2)...");
            await importRazaoPlanilhaG2(file_id, selectedPeriodId, matrix);
            invalidate();
          } catch (error) {
            setProgress(null);
            toast.error(error instanceof Error ? error.message : "Falha ao importar o razão.");
          } finally {
            setUploading(false);
          }
          return;
        }

        // Planilha genérica: mapeamento de colunas e validação antes de salvar.
        const data = await readSheet(file);
        const saved = loadSavedMapping();
        const auto = autoMap(data.columns);
        const restored: Mapping = {};
        for (const [key, column] of Object.entries(saved)) {
          if (column && data.columns.includes(column)) restored[key as keyof Mapping] = column;
        }
        setSheet(data);
        setSheetFile(file);
        setMapping({ ...auto, ...restored });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
      }
      return;
    }

    setUploading(true);
    try {
      const file_id = await enviarArquivo(file, selectedPeriodId);
      const uploaded = file;
      limparSelecao();
      invalidate();

      if (fileType === "razao") {
        toast.success("Arquivo enviado. Lendo o razão no navegador...");
        await importRazaoNoNavegador(file_id, selectedPeriodId, uploaded);
        invalidate();
        return;
      }

      toast.success("Arquivo enviado. Iniciando leitura...");
      processMutation.mutate(file_id);
      if (fileType === "balancete" && uploaded.name.toLowerCase().endsWith(".pdf")) {
        void importarEspelhoBalancete(file_id, uploaded);
      }
    } catch (error) {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : "Falha no envio do arquivo.");
    } finally {
      setUploading(false);
    }
  }

  async function confirmarMapeamento() {
    if (!selectedPeriodId || !sheetFile || !buildResult) return;
    setUploading(true);
    try {
      saveMapping(mapping);
      setProgress({ label: "Enviando a planilha...", pct: 5 });
      const file_id = await enviarArquivo(sheetFile, selectedPeriodId);
      invalidate();
      await enviarPernas(file_id, selectedPeriodId, buildResult.legs, 10);
      setSheet(null);
      setSheetFile(null);
      limparSelecao();
      invalidate();
    } catch (error) {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : "Falha ao importar a planilha.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(fileId: string) {
    try {
      const { url } = await downloadUrl({ data: { file_id: fileId } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
    }
  }

  if (!selectedPeriodId) {
    return (
      <>
        <PageHeader
          title="Importar arquivos"
          description="Envio de balancetes, razões e documentos fiscais em PDF ou Excel."
        />
        <EmptyState
          title="Selecione um período"
          description="Escolha um período contábil no cabeçalho para enviar arquivos."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Importar arquivos"
        description={`Arquivos do período ${selectedPeriod?.label ?? ""}. Balancetes em PDF são lidos por IA; planilhas via parser.`}
      />

      {isAdmin && (movementQuery.data?.legs ?? 0) > 0 ? (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
            <div className="text-sm">
              <p className="font-medium">
                {movementQuery.data!.legs.toLocaleString("pt-BR")} lançamentos no razão de{" "}
                {selectedPeriod?.label}
                {(movementQuery.data?.orphans ?? 0) > 0
                  ? ` — ${movementQuery.data!.orphans.toLocaleString("pt-BR")} sem arquivo vinculado`
                  : ""}
                .
              </p>
              <p className="text-muted-foreground">
                Excluir o arquivo remove os lançamentos dele. Lançamentos sem arquivo (importações
                antigas ou manuais) só saem com a limpeza do período.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={isClosed || purgeMutation.isPending}
              onClick={() => setPendingPurge(true)}
            >
              {purgeMutation.isPending ? "Limpando…" : "Limpar movimento do período"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {selectedPeriodId ? <RelatorioInconformidades periodId={selectedPeriodId} /> : null}

      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-2">
            <Label>Tipo de arquivo</Label>
            <Select value={fileType} onValueChange={setFileType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FILE_TYPE_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {value === "balancete" ? `${label} — em descontinuação` : label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fileType === "balancete" ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Em descontinuação: o balancete oficial agora é gerado pelo razão contábil. Esta
                importação serve apenas como espelho de conferência.
              </p>
            ) : null}
            {fileType === "razao" ? (
              <label className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 accent-primary"
                  checked={skipClosing}
                  onChange={(e) => setSkipClosing(e.target.checked)}
                />
                <span>
                  Descartar lançamentos de encerramento do G2.
                  <span className="block">
                    O fechamento contábil passa a ser executado no RotaBase.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="arquivo">Arquivo (PDF, Excel ou CSV)</Label>
            <Input
              id="arquivo"
              ref={inputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv"
              disabled={isClosed}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button onClick={() => void handleUpload()} disabled={!file || uploading || isClosed}>
            {uploading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <UploadCloud className="mr-2 size-4" />
            )}
            Enviar
          </Button>
          {progress ? (
            <div className="md:col-span-3">
              <div className="mb-1 flex justify-between text-sm text-muted-foreground">
                <span>{progress.label}</span>
                <span className="tabular-nums">{Math.round(progress.pct)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          ) : null}
          {isClosed ? (
            <p className="text-sm text-muted-foreground md:col-span-3">
              Este período está fechado. Reabra-o em Períodos para importar novos arquivos.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {filesQuery.isLoading ? (
        <LoadingRows />
      ) : filesQuery.error ? (
        <ErrorState
          message={(filesQuery.error as Error).message}
          onRetry={() => void filesQuery.refetch()}
        />
      ) : filesQuery.data && filesQuery.data.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Lançamentos</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filesQuery.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[280px]">
                      <span className="block truncate font-medium">{row.original_name}</span>
                      {row.processing_error ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.processing_error}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="block">
                        {FILE_TYPE_LABEL[row.file_type] ?? row.file_type}
                      </span>
                      {row.file_type === "balancete" ? (
                        <Badge variant="outline" className="mt-1 text-amber-700 dark:text-amber-400">
                          Em descontinuação
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.processing_status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {countsQuery.data?.[row.id] ?? 0}
                    </TableCell>
                    <TableCell>{formatDateTime(row.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDownload(row.id)}
                        >
                          <Download className="size-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            processMutation.isPending || isClosed || row.file_type === "razao"
                          }
                          title={
                            row.file_type === "razao"
                              ? "O razão é lido no navegador: reenvie o arquivo para reprocessar."
                              : undefined
                          }
                          onClick={() => processMutation.mutate(row.id)}
                        >
                          {processMutation.isPending && processMutation.variables === row.id ? (
                            <Loader2 className="mr-2 size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 size-4" />
                          )}
                          Reprocessar
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingDelete(row)}
                            aria-label={`Excluir ${row.original_name}`}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="Nenhum arquivo importado"
          description="Envie o balancete do período para iniciar a leitura automática."
        />
      )}

      {sheet && sheetFile && buildResult ? (
        <MapeamentoColunas
          open
          onOpenChange={(open) => {
            if (!open && !uploading) {
              setSheet(null);
              setSheetFile(null);
            }
          }}
          fileName={sheetFile.name}
          sheet={sheet}
          mapping={mapping}
          onMappingChange={setMapping}
          result={buildResult}
          busy={uploading}
          onConfirm={() => void confirmarMapeamento()}
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {pendingDelete?.original_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo e todos os lançamentos gerados por ele serão removidos deste período.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingPurge} onOpenChange={setPendingPurge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar o movimento de {selectedPeriod?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Serão removidos {movementQuery.data?.legs.toLocaleString("pt-BR") ?? 0} lançamentos do
              razão (inclusive manuais e cancelados), o balancete importado e os saldos de abertura
              deste período. Os indicadores serão recalculados. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                purgeMutation.mutate();
                setPendingPurge(false);
              }}
            >
              Limpar movimento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
