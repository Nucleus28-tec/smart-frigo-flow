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
