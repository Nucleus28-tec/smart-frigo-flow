/** Pré-visualizador de relatórios em PDF, com impressão e download sem sair do sistema. */
import { useEffect, useMemo, useRef } from "react";
import { Download, Printer, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { base64ToBlob, downloadBlob } from "@/lib/razao-export";

export type PreviewFile = {
  base64: string;
  content_type: string;
  file_name: string;
  size: number;
  title: string;
};

export function VisualizadorRelatorio({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const blob = useMemo(
    () => (file ? base64ToBlob(file.base64, file.content_type) : null),
    [file],
  );

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  function handlePrint() {
    const frame = frameRef.current;
    try {
      if (frame?.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return;
      }
      throw new Error("visualizador indisponível");
    } catch {
      if (url && window.open(url, "_blank", "noopener,noreferrer")) return;
      toast.error("Não foi possível abrir a impressão. Baixe o PDF e imprima pelo leitor.");
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col gap-3 p-4 sm:max-w-[96vw]">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">{file?.title ?? "Relatório"}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {file?.file_name} · {((file?.size ?? 0) / 1024).toFixed(0)} KB
          </p>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (blob && file) downloadBlob(blob, file.file_name);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Baixar PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Abrir em nova aba
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
          {url ? (
            <iframe
              ref={frameRef}
              src={url}
              title="Pré-visualização do relatório"
              className="h-full w-full"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
