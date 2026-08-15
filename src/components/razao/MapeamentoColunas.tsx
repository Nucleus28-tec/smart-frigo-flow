import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RAZAO_FIELDS, type BuildResult, type Mapping } from "@/lib/razao-mapeamento";
import type { SheetData } from "@/lib/planilha";

const NONE = "__none__";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  sheet: SheetData;
  mapping: Mapping;
  onMappingChange: (mapping: Mapping) => void;
  result: BuildResult;
  busy: boolean;
  onConfirm: () => void;
};

export function MapeamentoColunas({
  open,
  onOpenChange,
  fileName,
  sheet,
  mapping,
  onMappingChange,
  result,
  busy,
  onConfirm,
}: Props) {
  const missing = RAZAO_FIELDS.filter((field) => field.required && !mapping[field.key]);
  const blocked = missing.length > 0 || result.errors > 0 || result.legs.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mapear colunas do razão</DialogTitle>
          <DialogDescription>
            {fileName} · aba “{sheet.sheetName}” · {sheet.rows.length} linha(s). Confirme qual coluna
            da planilha alimenta cada campo do razão antes de salvar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {RAZAO_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="flex items-center gap-2 text-xs">
                {field.label}
                {field.required ? <Badge variant="outline">obrigatório</Badge> : null}
              </Label>
              <Select
                value={mapping[field.key] ?? NONE}
                onValueChange={(value) =>
                  onMappingChange({
                    ...mapping,
                    [field.key]: value === NONE ? undefined : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Não usar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Não usar</SelectItem>
                  {sheet.columns.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <div className="rounded-lg border p-3 text-sm">
          {blocked ? (
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="size-4" />
              {missing.length > 0
                ? `Faltam campos obrigatórios: ${missing.map((f) => f.label).join(", ")}.`
                : result.legs.length === 0
                  ? "Nenhuma linha válida encontrada com este mapeamento."
                  : `${result.errors} linha(s) com erro de formato. Corrija o arquivo ou o mapeamento.`}
            </p>
          ) : (
            <p className="flex items-center gap-2 font-medium text-brand">
              <CheckCircle2 className="size-4" />
              {result.legs.length} lançamento(s) prontos para importar.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {result.warnings} aviso(s) · {result.ignored} linha(s) ignorada(s) por não ter débito nem
            crédito.
          </p>

          {result.issues.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
              {result.issues.slice(0, 40).map((issue, index) => (
                <li key={`${issue.line}-${index}`} className="flex gap-2">
                  <span
                    className={
                      issue.level === "erro"
                        ? "font-medium text-destructive"
                        : "font-medium text-muted-foreground"
                    }
                  >
                    Linha {issue.line}
                  </span>
                  <span className="text-muted-foreground">{issue.message}</span>
                </li>
              ))}
              {result.issues.length > 40 ? (
                <li className="text-muted-foreground">
                  … e mais {result.issues.length - 40} ocorrência(s).
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={blocked || busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Importar {result.legs.length} lançamento(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
