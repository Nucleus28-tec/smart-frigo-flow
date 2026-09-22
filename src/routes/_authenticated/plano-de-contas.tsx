import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * O plano de contas passou a ser único: o do razão contábil, dentro de /razao.
 * Esta rota permanece apenas para não quebrar links antigos.
 */
export const Route = createFileRoute("/_authenticated/plano-de-contas")({
  beforeLoad: () => {
    throw redirect({ to: "/razao", search: { tab: "plano" } });
  },
  component: () => null,
});
