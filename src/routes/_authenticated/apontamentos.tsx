import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { detectInconsistencies } from "@/lib/audit.functions";


type Finding = {
  id: string;
  finding_type: string;
  description: string;
  suggested_fix: string | null;
  severity: string;
  status: string;
  created_at: string;
};

const SEVERITY_LABEL: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
};

const STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  resolvido: "Resolvido",
  ignorado: "Ignorado",
};

function ApontamentosPage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();

  const findings = useQuery({
    queryKey: ["audit_findings", selectedPeriodId],
    enabled: Boolean(selectedPeriodId),
    queryFn: async (): Promise<Finding[]> => {
      const { data, error } = await supabase
        .from("audit_findings")
        .select("id, finding_type, description, suggested_fix, severity, status, created_at")
        .eq("period_id", selectedPeriodId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Finding[];
    },
  });

  const rows = findings.data ?? [];
  const { isAdmin } = useProfile();
  const detect = useServerFn(detectInconsistencies);
  const detectMutation = useMutation({
    mutationFn: async () => detect({ data: { period_id: selectedPeriodId! } }),
    onSuccess: (result: { created: number }) => {
      toast.success(`${result.created} apontamento(s) atualizado(s).`);
      void findings.refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Apontamentos"
        description={
          selectedPeriod
            ? `Inconsistências detectadas em ${selectedPeriod.label}, com sugestão de correção na origem (G2).`
            : "Inconsistências detectadas no período, com sugestão de correção na origem (G2)."
        }
        actions={
          isAdmin && selectedPeriodId ? (
            <Button
              onClick={() => detectMutation.mutate()}
              disabled={detectMutation.isPending}
            >
              {detectMutation.isPending ? "Verificando…" : "Verificar inconsistências"}
            </Button>
          ) : null
        }
      />


      {!selectedPeriodId ? (
        <EmptyState
          title="Nenhum período selecionado"
          description="Escolha um período contábil no topo da tela para ver os apontamentos."
        />
      ) : findings.isLoading ? (
        <LoadingRows />
      ) : findings.isError ? (
        <ErrorState
          message={(findings.error as Error)?.message}
          onRetry={() => void findings.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma inconsistência encontrada"
          description="Nada foi apontado neste período. Importe e processe os arquivos na tela Importar para gerar novas verificações."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="hidden md:table-cell">Sugestão de correção</TableHead>
                  <TableHead>Severidade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Detectado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.finding_type}</TableCell>
                    <TableCell className="max-w-[320px]">{row.description}</TableCell>
                    <TableCell className="hidden max-w-[320px] text-sm text-muted-foreground md:table-cell">
                      {row.suggested_fix ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.severity === "alta" ? "destructive" : "outline"}>
                        {SEVERITY_LABEL[row.severity] ?? row.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === "aberto" ? "secondary" : "outline"}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {formatDateTime(row.created_at)}
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

export const Route = createFileRoute("/_authenticated/apontamentos")({
  component: ApontamentosPage,
  head: () => ({
    meta: [
      { title: "Apontamentos | Rotta Financeiro" },
      {
        name: "description",
        content: "Achados de auditoria do período contábil, com severidade, responsável e status.",
      },
      { property: "og:title", content: "Apontamentos | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Achados de auditoria do período contábil no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
