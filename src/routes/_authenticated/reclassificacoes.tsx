import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/PageState";

export const Route = createFileRoute("/_authenticated/reclassificacoes")({
  component: () => (
    <>
      <PageHeader
        title="Reclassificações"
        description="Sugestões da IA para reclassificar contas, com aprovação humana obrigatória."
      />
      <ComingSoon area="As reclassificações sugeridas" />
    </>
  ),
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
