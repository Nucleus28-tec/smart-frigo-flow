import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PeriodProvider } from "@/hooks/usePeriod";
import { ensureProfile } from "@/lib/session.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Verificação local e instantânea: getSession() lê o token do storage sem
  // chamada de rede. Qualquer trabalho lento (reconciliação de perfil) roda
  // dentro do componente, para que a tela nunca fique em branco esperando.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  pendingComponent: LayoutFallback,
  component: ProtectedLayout,
});

function LayoutFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Carregando…</p>
    </div>
  );
}

function ProtectedLayout() {
  const navigate = useNavigate();

  // Reconciliação de perfil em segundo plano — não bloqueia a renderização.
  const { data: profile } = useQuery({
    queryKey: ["ensure-profile"],
    queryFn: () => ensureProfile(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (profile && !profile.is_active) {
      void supabase.auth.signOut().then(() => navigate({ to: "/login" }));
    }
  }, [profile, navigate]);

  return (
    <PeriodProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </PeriodProvider>
  );
}
