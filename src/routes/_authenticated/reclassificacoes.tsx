import { createFileRoute } from "@tanstack/react-router";

import { useProfile } from "@/hooks/useProfile";
import { ComingSoon, PageHeader } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reclassificacoes")({
  component: ReclassificacoesPage,
  head: () => ({
    meta: [
      { title: "Reclassificações | Rotta Financeiro" },
      {
        name: "description",
        content: "Sugestões de reclassificação contábil com aprovação humana obrigatória.",
      },
      { property: "og:title", content: "Reclassificações | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Fila de sugestões de reclassificação contábil do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ReclassificacoesPage() {
  const { data: profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  return (
    <>
      <PageHeader
        title="Reclassificações"
        description="Sugestões da IA para reclassificar contas, com aprovação humana obrigatória."
      />

      {isAdmin ? (
        <div className="mb-4 flex gap-2">
          <Button size="sm" disabled>
            Aprovar
          </Button>
          <Button size="sm" variant="outline" disabled>
            Rejeitar
          </Button>
        </div>
      ) : (
        <Alert className="mb-4">
          <Lock className="size-4" />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            A aprovação e a rejeição de reclassificações são restritas ao Admin.
          </AlertDescription>
        </Alert>
      )}

      <ComingSoon area="As reclassificações sugeridas" />
    </>
  );
}
