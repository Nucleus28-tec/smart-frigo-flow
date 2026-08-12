import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AccountingPeriod = {
  id: string;
  label: string;
  reference_month: string;
  status: string;
  last_recalculated_at: string | null;
  created_by: string;
  created_at: string;
};

type PeriodContextValue = {
  periods: AccountingPeriod[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  selectedPeriodId: string | null;
  selectedPeriod: AccountingPeriod | null;
  selectPeriod: (id: string) => void;
};

const PeriodContext = createContext<PeriodContextValue | null>(null);

const STORAGE_KEY = "rotta:selected-period";

export function usePeriodsQuery() {
  return useQuery({
    queryKey: ["accounting_periods"],
    queryFn: async (): Promise<AccountingPeriod[]> => {
      const { data, error } = await supabase
        .from("accounting_periods")
        .select("id, label, reference_month, status, last_recalculated_at, created_by, created_at")
        .order("reference_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccountingPeriod[];
    },
  });
}

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error, refetch } = usePeriodsQuery();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedPeriodId(stored);
  }, []);

  const periods = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    if (!periods.length) return;
    const exists = periods.some((p) => p.id === selectedPeriodId);
    if (!exists) {
      const fallback = periods[0]!.id;
      setSelectedPeriodId(fallback);
      window.localStorage.setItem(STORAGE_KEY, fallback);
    }
  }, [periods, selectedPeriodId]);

  const selectPeriod = useCallback((id: string) => {
    setSelectedPeriodId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value: PeriodContextValue = {
    periods,
    isLoading,
    error,
    refetch: () => void refetch(),
    selectedPeriodId,
    selectedPeriod: periods.find((p) => p.id === selectedPeriodId) ?? null,
    selectPeriod,
  };

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod deve ser usado dentro de PeriodProvider");
  return ctx;
}
