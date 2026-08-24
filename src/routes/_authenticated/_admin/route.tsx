import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useProfile } from "@/hooks/useProfile";

export const Route = createFileRoute("/_authenticated/_admin")({
  ssr: false,
  component: AdminGate,
});

function AdminGate() {
  const { data: profile, isLoading } = useProfile();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && profile && profile.role !== "admin") {
      void navigate({ to: "/dashboard" });
    }
  }, [isLoading, profile, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (profile && profile.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }

  return <Outlet />;
}
