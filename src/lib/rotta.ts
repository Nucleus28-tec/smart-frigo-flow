export type AppRole = "admin" | "usuario";

export type PeriodStatus = "aberto" | "em_revisao" | "fechado";

export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  aberto: "Aberto",
  em_revisao: "Em revisão",
  fechado: "Fechado",
};

export const NATURE_LABEL: Record<string, string> = {
  ativo_circulante: "Ativo circulante",
  ativo_nao_circulante: "Ativo não circulante",
  passivo_circulante: "Passivo circulante",
  passivo_nao_circulante: "Passivo não circulante",
  patrimonio_liquido: "Patrimônio líquido",
  receita: "Receita",
  custo: "Custo",
  despesa: "Despesa",
};

export function roleLabel(role: string) {
  return role === "admin" ? "Admin" : "Usuário";
}

export function formatMonth(reference: string) {
  const [year, month] = reference.split("-");
  const names = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const index = Number(month) - 1;
  return `${names[index] ?? month}/${year}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const NATURE_OPTIONS = [
  "ativo_circulante",
  "ativo_nao_circulante",
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
  "receita",
  "custo",
  "despesa",
] as const;

export function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

/** Converte um valor digitado em formato brasileiro para número. */
export function parseCurrencyInput(input: string): number | null {
  let text = input.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  text = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
