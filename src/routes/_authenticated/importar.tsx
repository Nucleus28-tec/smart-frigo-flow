import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "@/components/PageState";

export const Route = createFileRoute("/_authenticated/importar")({
  component: () => (
    <>
      <PageHeader
        title="Importar arquivos"
        description="Envio de balancetes, razões e documentos fiscais em PDF ou Excel."
      />
      <ComingSoon area="A importação de arquivos" />
    </>
  ),
  head: () => ({
    meta: [
      { title: "Importar arquivos | Rotta Financeiro" },
      {
        name: "description",
        content: "Envio de balancetes, razões e documentos fiscais para o período contábil ativo.",
      },
      { property: "og:title", content: "Importar arquivos | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Envio de balancetes e documentos fiscais no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
