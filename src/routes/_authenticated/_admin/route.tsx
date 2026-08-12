import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ensureProfile } from "@/lib/session.functions";

export const Route = createFileRoute("/_authenticated/_admin")({
  ssr: false,
  beforeLoad: async () => {
    const profile = await ensureProfile();
    if (profile.role !== "admin") throw redirect({ to: "/dashboard" });
    return { profile };
  },
  component: () => <Outlet />,
});
