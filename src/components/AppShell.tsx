import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BarChart3,
  CalendarRange,
  Upload,
  Table2,
  Wand2,
  ListTree,
  AlertTriangle,
  FileSpreadsheet,
  RefreshCw,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { usePeriod } from "@/hooks/usePeriod";
import { PERIOD_STATUS_LABEL, roleLabel } from "@/lib/rotta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: BarChart3, adminOnly: false },
  { to: "/periodos", label: "Períodos", icon: CalendarRange, adminOnly: false },
  { to: "/importar", label: "Importar", icon: Upload, adminOnly: false },
  { to: "/balancete", label: "Balancete", icon: Table2, adminOnly: false },
  { to: "/reclassificacoes", label: "Reclassificações", icon: Wand2, adminOnly: false },
  { to: "/plano-de-contas", label: "Plano de Contas", icon: ListTree, adminOnly: false },
  { to: "/apontamentos", label: "Apontamentos", icon: AlertTriangle, adminOnly: false },
  { to: "/demonstrativos", label: "Demonstrativos", icon: FileSpreadsheet, adminOnly: false },
  { to: "/atualizacoes", label: "Atualizações", icon: RefreshCw, adminOnly: false },
  { to: "/usuarios", label: "Usuários", icon: Users, adminOnly: true },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading } = useProfile();
  const { periods, selectedPeriodId, selectedPeriod, selectPeriod } = usePeriod();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const isAdmin = profile?.role === "admin";

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const items = NAV.filter((item) => isAdmin || !item.adminOnly);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-4">
          <div>
            <p className="text-sm font-semibold tracking-tight">Rotta Financeiro</p>
            <p className="text-xs text-sidebar-foreground/60">Rota Alimentos</p>
          </div>
          <button
            className="lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4 text-xs text-sidebar-foreground/60">
          ERP Financeiro · MVP
        </div>
      </aside>

      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
          <button
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
            type="button"
          >
            <Menu className="size-5" />
          </button>

          <div className="flex min-w-[200px] items-center gap-2">
            {periods.length > 0 ? (
              <>
                <Select
                  {...(selectedPeriodId ? { value: selectedPeriodId } : {})}
                  onValueChange={selectPeriod}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Selecione o período" />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPeriod ? (
                  <Badge variant="outline">
                    {PERIOD_STATUS_LABEL[
                      selectedPeriod.status as keyof typeof PERIOD_STATUS_LABEL
                    ] ?? selectedPeriod.status}
                  </Badge>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Nenhum período criado</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {isLoading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <div className="text-right">
                <p className="text-sm font-medium leading-tight">{profile?.full_name}</p>
                <Badge variant="secondary" className="mt-0.5">
                  {roleLabel(profile?.role ?? "usuario")}
                </Badge>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="size-4" />
              Sair
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
