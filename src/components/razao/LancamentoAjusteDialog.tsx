/**
 * Diálogo de lançamento de ajuste no razão, usado pelo balancete derivado.
 * Grava por `saveManualJournalEntry` → RPC `upsert_manual_journal_entry`.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveManualJournalEntry } from "@/lib/razao.functions";

export type AjusteContexto = {
  reduced_code: string;
  account_name: string;
  /** Lado em que a conta clicada entra no lançamento. */
  side: "debito" | "credito";
};

function parseValor(raw: string) {
  const normalized = raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  return Number(normalized);
}

export function LancamentoAjusteDialog({
  periodId,
  contexto,
  defaultDate,
  onOpenChange,
}: {
  periodId: string;
  contexto: AjusteContexto | null;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const runSave = useServerFn(saveManualJournalEntry);

  const [side, setSide] = useState<"debito" | "credito">("debito");
  const [contrapartida, setContrapartida] = useState("");
  const [entryDate, setEntryDate] = useState(defaultDate);
  const [docNumber, setDocNumber] = useState("");
  const [value, setValue] = useState("");
  const [historico, setHistorico] = useState("");

  useEffect(() => {
    if (!contexto) return;
    setSide(contexto.side);
    setContrapartida("");
    setEntryDate(defaultDate);
    setDocNumber("");
    setValue("");
    setHistorico(`Ajuste manual — ${contexto.reduced_code} ${contexto.account_name}`);
  }, [contexto, defaultDate]);

  const save = useMutation({
    mutationFn: async () => {
      if (!contexto) throw new Error("Conta não informada.");
      const conta = contexto.reduced_code.trim();
      const outra = contrapartida.trim();
      const valor = parseValor(value);
      if (!outra) throw new Error("Informe a conta de contrapartida.");
      if (outra === conta) throw new Error("A contrapartida deve ser diferente da conta ajustada.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Valor inválido.");
      if (!entryDate) throw new Error("Informe a data.");
      if (!historico.trim()) throw new Error("Informe o histórico.");
      return (await runSave({
        data: {
          period_id: periodId,
          leg_id: null,
          debit_code: side === "debito" ? conta : outra,
          credit_code: side === "debito" ? outra : conta,
          entry_date: entryDate,
          doc_number: docNumber.trim(),
          value: valor,
          historico: historico.trim(),
        },
      })) as unknown as { id: string };
    },
    onSuccess: () => {
      toast.success("Lançamento de ajuste registrado.");
      void queryClient.invalidateQueries({ queryKey: ["conferencia_balanco"] });
      void queryClient.invalidateQueries({ queryKey: ["journal_grid"] });
      void queryClient.invalidateQueries({ queryKey: ["journal_document"] });
      void queryClient.invalidateQueries({ queryKey: ["indicators"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={Boolean(contexto)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar por lançamento</DialogTitle>
          <DialogDescription>
            {contexto
              ? `${contexto.reduced_code} · ${contexto.account_name}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Esta conta entra como</Label>
            <div className="flex gap-2">
              {(["debito", "credito"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={side === option ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSide(option)}
                >
                  {option === "debito" ? "Débito" : "Crédito"}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ajuste-contrapartida">
              Conta de contrapartida ({side === "debito" ? "crédito" : "débito"})
            </Label>
            <Input
              id="ajuste-contrapartida"
              placeholder="Código reduzido, ex.: 023101"
              value={contrapartida}
              onChange={(e) => setContrapartida(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="ajuste-data">Data</Label>
              <Input
                id="ajuste-data"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ajuste-doc">Documento</Label>
              <Input
                id="ajuste-doc"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ajuste-valor">Valor</Label>
              <Input
                id="ajuste-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ajuste-historico">Histórico</Label>
            <Input
              id="ajuste-historico"
              value={historico}
              onChange={(e) => setHistorico(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Gravar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
