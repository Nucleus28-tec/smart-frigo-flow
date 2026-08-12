import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/PageState";

export const Route = createFileRoute("/_authenticated/apontamentos")({
  component: () => (
    <>
      <PageHeader
        title="Apontamentos"
        description="Achados de auditoria levantados sobre o período, com severidade e tratativa."
      />
      <ComingSoon area="Os apontamentos de auditoria" />
    </>
  ),
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
