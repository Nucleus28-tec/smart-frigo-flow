import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type PeriodStatus = {
  legs: number;
  files: number;
  openings: number;
  hasMovement: boolean;
};

/**
 * Estado real do período: existe razão importado? Serve para as telas não
 * exibirem números de importações que já foram apagadas.
 */
export function usePeriodStatus(periodId: string | null) {
  return useQuery({
    queryKey: ["period_status", periodId],
    enabled: Boolean(periodId),
    queryFn: async (): Promise<PeriodStatus> => {
      const [legs, files, openings] = await Promise.all([
        supabase
          .from("journal_legs")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId!),
        supabase
          .from("imported_files")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId!),
        supabase
          .from("journal_account_openings")
          .select("id", { count: "exact", head: true })
          .eq("period_id", periodId!),
      ]);
      if (legs.error) throw legs.error;
      if (files.error) throw files.error;
      if (openings.error) throw openings.error;
      const l = legs.count ?? 0;
      const o = openings.count ?? 0;
      return {
        legs: l,
        files: files.count ?? 0,
        openings: o,
        hasMovement: l > 0 || o > 0,
      };
    },
  });
}
