import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { PERIOD_STATUS_LABEL, formatDateTime, formatMonth } from "@/lib/rotta";

export const Route = createFileRoute("/_authenticated/periodos")({
  component: PeriodosPage,
  head: () => ({
    meta: [
      { title: "Períodos contábeis | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Crie, selecione e controle o status dos períodos contábeis mensais usados em todo o ERP.",
      },
      { property: "og:title", content: "Períodos contábeis | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Controle dos períodos contábeis mensais do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function PeriodosPage() {
  const { periods, isLoading, error, refetch, selectedPeriodId, selectPeriod } = usePeriod();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [label, setLabel] = useState("");
  const [pendingClose, setPendingClose] = useState<{ id: string; label: string } | null>(null);

  const createPeriod = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { error: insertError } = await supabase.from("accounting_periods").insert({
        reference_month: `${month}-01`,
        label: label || formatMonth(month),
        status: "aberto",
        created_by: userData.user!.id,
      });
      if (insertError) {
        if (insertError.code === "23505") {
          throw new Error(`Já existe um período cadastrado para ${formatMonth(month)}.`);
        }
        throw insertError;
      }
      await supabase.rpc("log_activity", {
        _action: "criou período",
        _entity_type: "accounting_periods",
        _metadata: { reference_month: month },
      });
    },
    onSuccess: () => {
      toast.success("Período criado");
      setOpen(false);
      setMonth("");
      setLabel("");
      void queryClient.invalidateQueries({ queryKey: ["accounting_periods"] });
    },
    onError: (e: Error) => toast.error("Erro ao criar período", { description: e.message }),
  });

  const changeStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error: updateError } = await supabase
        .from("accounting_periods")
        .update({ status })
        .eq("id", id);
      if (updateError) throw updateError;
      await supabase.rpc("log_activity", {
        _action: `alterou status do período para ${status}`,
        _entity_type: "accounting_periods",
        _entity_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      void queryClient.invalidateQueries({ queryKey: ["accounting_periods"] });
    },
    onError: (e: Error) => toast.error("Erro ao atualizar", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Períodos contábeis"
        description="Todo o sistema trabalha sobre o período selecionado no topo da tela."
        actions={
          isAdmin ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>Novo período</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo período contábil</DialogTitle>
                  <DialogDescription>
                    Informe o mês de referência. O período nasce com status Aberto.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="month">Mês de referência</Label>
                    <Input
                      id="month"
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="label">Rótulo (opcional)</Label>
                    <Input
                      id="label"
                      value={label}
                      placeholder={month ? formatMonth(month) : "Ex.: Janeiro/2026"}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => createPeriod.mutate()}
                    disabled={!month || createPeriod.isPending}
                  >
                    {createPeriod.isPending ? "Criando…" : "Criar período"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {isLoading ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState message={(error as Error)?.message} onRetry={refetch} />
      ) : periods.length === 0 ? (
        <EmptyState
          title="Nenhum período criado"
          description={
            isAdmin
              ? "Crie o primeiro período contábil para liberar importação, balancete e demonstrativos."
              : "Peça a um administrador para criar o primeiro período contábil."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Último recálculo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => (
                  <TableRow
                    key={period.id}
                    className={period.status === "fechado" ? "opacity-70" : undefined}
                  >
                    <TableCell className="font-medium">
                      {period.label}
                      {period.id === selectedPeriodId ? (
                        <Badge className="ml-2" variant="secondary">
                          Selecionado
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{period.reference_month.slice(0, 7)}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select
                          value={period.status}
                          onValueChange={(status) => {
                            if (status === "fechado") {
                              setPendingClose({ id: period.id, label: period.label });
                              return;
                            }
                            changeStatus.mutate({ id: period.id, status });
                          }}
                        >
                          <SelectTrigger className="w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(PERIOD_STATUS_LABEL).map(([value, text]) => (
                              <SelectItem key={value} value={value}>
                                {text}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">
                          {PERIOD_STATUS_LABEL[
                            period.status as keyof typeof PERIOD_STATUS_LABEL
                          ] ?? period.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(period.last_recalculated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={period.id === selectedPeriodId}
                        onClick={() => selectPeriod(period.id)}
                      >
                        Selecionar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={pendingClose !== null}
        onOpenChange={(o: boolean) => {
          if (!o) setPendingClose(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar {pendingClose?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Um período fechado sinaliza que o mês está encerrado para a operação. Você pode
              reabri-lo depois alterando o status novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingClose) changeStatus.mutate({ id: pendingClose.id, status: "fechado" });
                setPendingClose(null);
              }}
            >
              Fechar período
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
