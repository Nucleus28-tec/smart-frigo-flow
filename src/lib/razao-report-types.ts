/** Tipos compartilhados dos relatórios do razão (razão analítico e balancete analítico). */

export type ReportKind = "razao" | "balancete";

export type LedgerReportLine = {
  id: string;
  doc_number: string | null;
  entry_date: string | null;
  historico: string | null;
  debit: number;
  credit: number;
  counterpart_reduced_code: string | null;
  counterpart_name: string | null;
  partida_multipla?: boolean;
  running_balance: number;
};

export type LedgerReportAccount = {
  code: string;
  name: string;
  hierarchical_code: string | null;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  line_count: number;
  partidas_multiplas?: number;
  lines: LedgerReportLine[];
};

export type LedgerReport = {
  period_id: string;
  from: string | null;
  to: string | null;
  from_actual?: string | null;
  to_actual?: string | null;
  total_lines?: number;
  doc_number: string | null;
  truncated: boolean;
  accounts: LedgerReportAccount[];
};

export type TrialBalanceReportRow = {
  code: string;
  name: string;
  hierarchical_code: string | null;
  nature: string | null;
  is_analytic: boolean;
  level: number;
  saldo_anterior: number;
  debito: number;
  credito: number;
  saldo_atual: number;
};

export type TrialBalanceReport = {
  period_id: string;
  from: string | null;
  to: string | null;
  totals: { debito: number; credito: number };
  rows: TrialBalanceReportRow[];
};

export function balanceLabel(value: number) {
  const abs = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value === 0) return `${abs}`;
  return `${abs} ${value > 0 ? "D" : "C"}`;
}

export function amount(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDay(value: string | null) {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
