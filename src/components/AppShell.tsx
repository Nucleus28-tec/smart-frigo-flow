import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  CalendarRange,
  FileSpreadsheet,
  LogOut,
  Menu,
  RefreshCw,
  Table2,
  Upload,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePeriod } from "@/hooks/usePeriod";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { getAiProvider, setAiProvider } from "@/lib/ai-settings.functions";
import { rebuildLedgerChain } from "@/lib/razao.functions";
import { PERIOD_STATUS_LABEL, roleLabel } from "@/lib/rotta";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof BarChart3;
  adminOnly: boolean;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operação",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: BarChart3, adminOnly: false },
      { to: "/periodos", label: "Períodos", icon: CalendarRange, adminOnly: false },
      { to: "/importar", label: "Importar", icon: Upload, adminOnly: false },
    ],
  },
  {
    title: "Contabilidade",
    items: [
      { to: "/razao", label: "Razão", icon: BookOpen, adminOnly: false },
      { to: "/balancete", label: "Balancete", icon: Table2, adminOnly: false },
      { to: "/demonstrativos", label: "Demonstrativos", icon: FileSpreadsheet, adminOnly: false },
    ],
  },
  {
    title: "Revisão",
    items: [
      { to: "/reclassificacoes", label: "Reclassificações", icon: Wand2, adminOnly: false },
      { to: "/apontamentos", label: "Apontamentos", icon: AlertTriangle, adminOnly: false },
      { to: "/atualizacoes", label: "Atualizações", icon: RefreshCw, adminOnly: false },
      { to: "/agentes", label: "IA Agentes", icon: Bot, adminOnly: false },
    ],
  },
  {
    title: "Administração",
    items: [{ to: "/usuarios", label: "Usuários", icon: Users, adminOnly: true }],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading } = useProfile();
  const { periods, selectedPeriodId, selectedPeriod, selectPeriod } = usePeriod();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isAdmin = profile?.role === "admin";

  const fetchProvider = useServerFn(getAiProvider);
  const saveProvider = useServerFn(setAiProvider);
  const { data: providerData, isLoading: isLoadingProvider } = useQuery({
    queryKey: ["ai-provider"],
    queryFn: () => fetchProvider(),
    enabled: isAdmin,
  });
  const providerMutation = useMutation({
    mutationFn: (provider: "gemini" | "lovable") => saveProvider({ data: { provider } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ai-provider"] }),
  });

  const { data: staleData } = useQuery({
    queryKey: ["chain-stale"],
    queryFn: async (): Promise<{ label: string }[]> => {
      const { data, error } = await supabase
        .from("accounting_periods")
        .select("label")
        .eq("chain_stale", true);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const staleCount = staleData?.length ?? 0;
  const rebuildChain = useServerFn(rebuildLedgerChain);
  const rebuildMutation = useMutation({
    mutationFn: () => rebuildChain({ data: { from_period_id: null } }),
    onSuccess: () => {
      toast.success("Saldos reconstruídos.");
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) =>
      toast.error("Não foi possível reconstruir os saldos", { description: error.message }),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/login", replace: true });
  }

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isAdmin || !item.adminOnly),
  })).filter((group) => group.items.length > 0);

  const navLinks = groups.flatMap((group) => group.items);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-header/95 shadow-[var(--shadow-header)] backdrop-blur-xl">
        <div className="mx-auto grid min-h-16 max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 lg:gap-5">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
            >
              {mobileMenuOpen ? <X /> : <Menu />}
            </Button>

            <Link to="/dashboard" className="flex min-w-0 shrink-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-bold text-brand-foreground shadow-[var(--glow-strong-shadow)]">
                R
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate font-display text-base font-bold text-foreground">
                  Rotta Financeiro
                </span>
                <span className="block text-[11px] text-muted-foreground">Rota Alimentos</span>
              </span>
            </Link>

            <div className="hidden min-w-0 items-center gap-2 md:flex">
              {periods.length > 0 ? (
                <>
                  <Select
                    {...(selectedPeriodId ? { value: selectedPeriodId } : {})}
                    onValueChange={selectPeriod}
                  >
                    <SelectTrigger className="w-48 bg-surface xl:w-56">
                      <SelectValue placeholder="Selecione o período" />
                    </SelectTrigger>
                    <SelectContent>
                      {periods.map((period) => (
                        <SelectItem key={period.id} value={period.id}>
                          {period.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPeriod ? (
                    <Badge variant="outline" className="hidden xl:inline-flex">
                      {PERIOD_STATUS_LABEL[
                        selectedPeriod.status as keyof typeof PERIOD_STATUS_LABEL
                      ] ?? selectedPeriod.status}
                    </Badge>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhum período</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {staleCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="hidden border-warning/50 text-warning-foreground xl:inline-flex"
                onClick={() => rebuildMutation.mutate()}
                disabled={rebuildMutation.isPending}
                title={`${staleCount} período(s) com saldos pendentes de recálculo`}
              >
                <RefreshCw className={cn(rebuildMutation.isPending && "animate-spin")} />
                Saldos pendentes
              </Button>
            ) : null}

            {isAdmin ? (
              <div className="hidden items-center gap-2 2xl:flex">
                <Bot className="size-4 text-muted-foreground" />
                {isLoadingProvider ? (
                  <Skeleton className="h-9 w-40" />
                ) : (
                  <Select
                    value={providerData?.provider ?? "gemini"}
                    onValueChange={(value) =>
                      providerMutation.mutate(value as "gemini" | "lovable")
                    }
                    disabled={providerMutation.isPending}
                  >
                    <SelectTrigger className="w-44 bg-surface">
                      <SelectValue placeholder="Provedor de IA" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Gemini (própria)</SelectItem>
                      <SelectItem value="lovable">Lovable AI Gateway</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : null}

            <ThemeToggle />
            {isLoading ? (
              <Skeleton className="hidden h-9 w-32 sm:block" />
            ) : (
              <div className="hidden border-l border-border pl-3 text-right sm:block">
                <p className="max-w-36 truncate text-sm font-semibold leading-tight">
                  {profile?.full_name}
                </p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  {roleLabel(profile?.role ?? "usuario")}
                </p>
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair" title="Sair">
              <LogOut />
            </Button>
          </div>
        </div>

        <div className="border-t border-border/70 bg-nav">
          <div className="mx-auto max-w-[1600px] px-4 lg:px-8">
            <nav
              aria-label="Navegação principal"
              className={cn(
                "items-stretch gap-1 py-2 lg:flex lg:overflow-x-auto lg:py-0",
                mobileMenuOpen ? "grid grid-cols-2" : "hidden",
              )}
            >
              {navLinks.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "group relative flex min-h-11 items-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors lg:min-h-12 lg:shrink-0 lg:rounded-none",
                      active
                        ? "bg-brand-soft text-brand-soft-foreground lg:bg-transparent lg:text-brand"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground lg:hover:bg-transparent lg:hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active && "text-brand")} />
                    <span>{item.label}</span>
                    {active ? (
                      <span className="absolute inset-x-2 bottom-0 hidden h-0.5 rounded-full bg-brand lg:block" />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] p-4 lg:p-8">{children}</main>
    </div>
  );
}