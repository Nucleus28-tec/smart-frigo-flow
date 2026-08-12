import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/dashboard" : "/login" });
  },
  component: () => null,
  head: () => ({
    meta: [
      { title: "Rotta Financeiro | ERP para frigoríficos" },
      {
        name: "description",
        content:
          "ERP Financeiro Inteligente para frigoríficos: importação de balancetes, reclassificação assistida por IA e demonstrativos confiáveis.",
      },
      { property: "og:title", content: "Rotta Financeiro | ERP para frigoríficos" },
      {
        property: "og:description",
        content:
          "Importação de balancetes, reclassificação assistida por IA e demonstrativos confiáveis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
