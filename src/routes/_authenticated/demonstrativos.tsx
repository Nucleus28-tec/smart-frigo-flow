import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/PageState";

export const Route = createFileRoute("/_authenticated/demonstrativos")({
  component: () => (
    <>
      <PageHeader
        title="Demonstrativos"
        description="DRE, Balanço Patrimonial e Fluxo de Caixa gerados a partir do balancete do período."
      />
      <ComingSoon area="Os demonstrativos contábeis" />
    </>
  ),
  head: () => ({
    meta: [
      { title: "Demonstrativos | Rotta Financeiro" },
      {
        name: "description",
        content: "DRE, Balanço Patrimonial e Fluxo de Caixa gerados a partir do balancete.",
      },
      { property: "og:title", content: "Demonstrativos | Rotta Financeiro" },
      {
        property: "og:description",
        content: "DRE, Balanço e Fluxo de Caixa do período no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
