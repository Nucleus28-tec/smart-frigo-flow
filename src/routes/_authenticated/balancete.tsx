import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/PageState";

export const Route = createFileRoute("/_authenticated/balancete")({
  component: () => (
    <>
      <PageHeader
        title="Balancete"
        description="Lançamentos consolidados do período com saldos por conta contábil."
      />
      <ComingSoon area="O balancete" />
    </>
  ),
  head: () => ({
    meta: [
      { title: "Balancete | Rotta Financeiro" },
      {
        name: "description",
        content: "Lançamentos consolidados do período com saldos por conta contábil.",
      },
      { property: "og:title", content: "Balancete | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Lançamentos e saldos por conta contábil no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
