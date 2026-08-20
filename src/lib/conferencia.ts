import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaldoConta = {
  reduced_code: string;
  account_name: string;
  hierarchical_code: string | null;
  nature: string | null;
  opening_balance: number;
  debit_mov: number;
  credit_mov: number;
  debit_all: number;
  credit_all: number;
  closing_balance: number;
};

export type PendenciaConta = {
  reduced_code: string;
  account_name: string;
  nature: string | null;
  opening_balance: number;
  movimento: number;
  share: number;
  causa: string;
  acao: string;
};

export type Conferencia = {
  contas: SaldoConta[];
  ativo: number;
  passivoPl: number;
  delta: number;
  fecha: boolean;
  pendencias: PendenciaConta[];
};

const ATIVO = new Set(["ativo_circulante", "ativo_nao_circulante"]);
const PASSIVO_PL = new Set([
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
]);

/** Limiares do sinalizador de contas candidatas a reclassificação. */
const SHARE_MIN = 0.1; // 10% do grupo
const OPENING_VS_MOV = 3; // abertura ao menos 3x a movimentação do período

export function analisarConferencia(rows: SaldoConta[]): Conferencia {
  const contas = rows.map((r) => ({
    ...r,
    opening_balance: Number(r.opening_balance ?? 0),
    debit_mov: Number(r.debit_mov ?? 0),
    credit_mov: Number(r.credit_mov ?? 0),
    debit_all: Number(r.debit_all ?? 0),
    credit_all: Number(r.credit_all ?? 0),
    closing_balance: Number(r.closing_balance ?? 0),
  }));

  const ativo = contas
    .filter((c) => c.nature && ATIVO.has(c.nature))
    .reduce((acc, c) => acc + c.closing_balance, 0);
  // Grupos credores chegam com sinal devedor; invertemos para leitura contábil.
  const passivoPl = -contas
    .filter((c) => c.nature && PASSIVO_PL.has(c.nature))
    .reduce((acc, c) => acc + c.closing_balance, 0);
  const delta = ativo - passivoPl;

  const grupoPl = contas.filter((c) => c.nature && PASSIVO_PL.has(c.nature));
  const totalPl = grupoPl.reduce((acc, c) => acc + Math.abs(c.closing_balance), 0);

  const pendencias: PendenciaConta[] = grupoPl
    .map((c) => {
      const abertura = Math.abs(c.opening_balance);
      const movimento = Math.abs(c.debit_mov) + Math.abs(c.credit_mov);
      const share = totalPl > 0 ? Math.abs(c.closing_balance) / totalPl : 0;
      return { conta: c, abertura, movimento, share };
    })
    .filter(
      ({ abertura, movimento, share }) =>
        abertura > 0 &&
        share >= SHARE_MIN &&
        abertura >= OPENING_VS_MOV * Math.max(movimento, 1),
    )
    .sort((a, b) => b.abertura - a.abertura)
    .map(({ conta, movimento, share }): PendenciaConta => ({
      reduced_code: conta.reduced_code,
      account_name: conta.account_name,
      nature: conta.nature,
      opening_balance: conta.opening_balance,
      movimento,
      share,
      causa:
        movimento === 0
          ? "Saldo de abertura acumulado sem movimentação no período — provável resíduo de encerramentos mensais nunca zerados por fechamento anual."
          : "Saldo de abertura muito maior que a movimentação do período — provável acúmulo de encerramentos anteriores nesta conta.",
      acao:
        "Revisar a natureza/classificação da conta ou lançar o ajuste de zeramento no razão. Contas de apuração não devem compor o Patrimônio Líquido.",
    }));

  return {
    contas,
    ativo,
    passivoPl,
    delta,
    fecha: Math.abs(delta) < 0.01,
    pendencias,
  };
}

export function useConferencia(periodId: string | null) {
  return useQuery({
    queryKey: ["conferencia_balanco", periodId],
    enabled: Boolean(periodId),
    queryFn: async (): Promise<Conferencia> => {
      const { data, error } = await supabase.rpc("period_account_balances", {
        _period_id: periodId!,
      });
      if (error) throw error;
      return analisarConferencia((data ?? []) as unknown as SaldoConta[]);
    },
  });
}
