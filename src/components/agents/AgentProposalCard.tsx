import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applyAgentAction } from "@/lib/agents.functions";

type Props = {
  threadId: string;
  periodId: string | null;
  payload: Record<string, unknown>;
  isAdmin: boolean;
};

const NATURE_LABELS: Record<string, string> = {
  ativo_circulante: "Ativo circulante",
  ativo_nao_circulante: "Ativo não circulante",
  passivo_circulante: "Passivo circulante",
  passivo_nao_circulante: "Passivo não circulante",
  patrimonio_liquido: "Patrimônio líquido",
  receita: "Receita",
  custo: "Custo",
  despesa: "Despesa",
};

export function AgentProposalCard({ threadId, periodId, payload, isAdmin }: Props) {
  const apply = useServerFn(applyAgentAction);
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const kind = payload["proposta"] as "classificacao" | "apontamento";
  const contas = (payload["contas"] as Array<{ id: string; nome: string }> | undefined) ?? [];
  const natureza = payload["natureza"] as string | undefined;

  async function handleApply() {
    setApplying(true);
    try {
      if (kind === "classificacao") {
        if (!natureza || !contas.length) throw new Error("Proposta incompleta.");
        const result = await apply({
          data: {
            kind: "classificacao",
            thread_id: threadId,
            natureza: natureza as never,
            account_ids: contas.map((c) => c.id),
          },
        });
        toast.success(`${result.affected} conta(s) classificada(s) como ${NATURE_LABELS[natureza]}.`);
      } else {
        if (!periodId) throw new Error("Selecione um período contábil.");
        await apply({
          data: {
            kind: "apontamento",
            thread_id: threadId,
            period_id: periodId,
            tipo: String(payload["tipo"] ?? "achado"),
            descricao: String(payload["descricao"] ?? ""),
            correcao_sugerida: String(payload["correcao_sugerida"] ?? ""),
            severidade: (payload["severidade"] as never) ?? "media",
          },
        });
        toast.success("Apontamento criado.");
      }
      setApplied(true);
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao aplicar a proposta.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--glow-border)] bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-brand" />
          <span className="text-sm font-medium">
            {kind === "classificacao" ? "Proposta de classificação" : "Proposta de apontamento"}
          </span>
        </div>
        <Badge variant="outline">Requer aprovação</Badge>
      </div>

      {kind === "classificacao" ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>
            Natureza sugerida:{" "}
            <span className="font-medium text-foreground">
              {natureza ? (NATURE_LABELS[natureza] ?? natureza) : "-"}
            </span>{" "}
            · {contas.length} conta(s)
          </p>
          <ul className="max-h-32 list-disc overflow-y-auto pl-4">
            {contas.slice(0, 20).map((c) => (
              <li key={c.id}>{c.nome}</li>
            ))}
          </ul>
          {payload["justificativa"] ? <p>{String(payload["justificativa"])}</p> : null}
          {Array.isArray(payload["evidencias"]) && payload["evidencias"].length > 0 ? (
            <div className="rounded-md bg-muted/50 p-2">
              <p className="mb-1 font-medium text-foreground">Contrapartidas que sustentam</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {(payload["evidencias"] as unknown[]).slice(0, 10).map((item, index) => (
                  <li key={index}>{String(item)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p className="text-foreground">{String(payload["descricao"] ?? "")}</p>
          {payload["correcao_sugerida"] ? (
            <p>Correção sugerida: {String(payload["correcao_sugerida"])}</p>
          ) : null}
          <p>Severidade: {String(payload["severidade"] ?? "media")}</p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {applied ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-brand">
            <CheckCircle2 className="size-4" /> Aplicado
          </span>
        ) : isAdmin ? (
          <Button size="sm" onClick={() => void handleApply()} disabled={applying}>
            {applying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Aplicar
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Somente um administrador pode aplicar esta proposta.
          </span>
        )}
      </div>
    </div>
  );
}
