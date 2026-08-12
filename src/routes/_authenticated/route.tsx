import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PeriodProvider } from "@/hooks/usePeriod";
import { ensureProfile } from "@/lib/session.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });

    const profile = await ensureProfile();
    if (!profile.is_active) {
      await supabase.auth.signOut();
      throw redirect({ to: "/login" });
    }

    return { user: data.user, profile };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  return (
    <PeriodProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </PeriodProvider>
  );
}
