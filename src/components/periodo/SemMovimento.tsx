import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/PageState";

/**
 * Estado vazio único do sistema: o período existe, mas ainda não tem razão
 * importado — nenhuma tela deve mostrar números residuais nesse caso.
 */
export function SemMovimento({
  periodLabel,
  contexto,
}: {
  periodLabel?: string | undefined;
  contexto?: string | undefined;
}) {
  return (
    <EmptyState
      title={`Nenhum razão importado${periodLabel ? ` em ${periodLabel}` : ""}`}
      description={
        contexto ??
        "Importe o razão contábil do período em Importar › Razão contábil (G2). Todos os números do sistema são derivados do razão."
      }
      action={
        <Button asChild>
          <Link to="/importar">Ir para Importar</Link>
        </Button>
      }
    />
  );
}
