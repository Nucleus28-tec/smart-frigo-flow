import { formatCurrency } from "@/lib/rotta";

export type IndicatorKind = "currency" | "percent" | "ratio" | "days";

export type IndicatorMeta = {
  key: string;
  label: string;
  kind: IndicatorKind;
  group: "resultado" | "margens" | "liquidez" | "endividamento" | "giro";
  hint: string;
};

/** Metadados espelhados de public.indicator_formulas() — a fórmula real vive no banco. */
export const INDICATORS: IndicatorMeta[] = [
  { key: "receita_total", label: "Receita total", kind: "currency", group: "resultado", hint: "Movimento das contas de receita" },
  { key: "custo_total", label: "Custo total", kind: "currency", group: "resultado", hint: "Movimento das contas de custo" },
  { key: "despesa_total", label: "Despesa total", kind: "currency", group: "resultado", hint: "Movimento das contas de despesa" },
  { key: "ebitda", label: "EBITDA", kind: "currency", group: "resultado", hint: "Receita − Custo − Despesa" },
  { key: "resultado_liquido", label: "Resultado líquido", kind: "currency", group: "resultado", hint: "Receita − Custo − Despesa" },
  { key: "posicao_caixa", label: "Posição de caixa", kind: "currency", group: "resultado", hint: "Saldo de caixa, bancos e aplicações" },

  { key: "margem_bruta", label: "Margem bruta", kind: "percent", group: "margens", hint: "(Receita − Custo) ÷ Receita" },
  { key: "margem_ebitda", label: "Margem EBITDA", kind: "percent", group: "margens", hint: "EBITDA ÷ Receita" },
  { key: "margem_liquida", label: "Margem líquida", kind: "percent", group: "margens", hint: "Resultado líquido ÷ Receita" },

  { key: "liquidez_corrente", label: "Liquidez corrente", kind: "ratio", group: "liquidez", hint: "Ativo circulante ÷ Passivo circulante" },
  { key: "liquidez_seca", label: "Liquidez seca", kind: "ratio", group: "liquidez", hint: "(AC − Estoques) ÷ Passivo circulante" },
  { key: "liquidez_imediata", label: "Liquidez imediata", kind: "ratio", group: "liquidez", hint: "Caixa ÷ Passivo circulante" },
  { key: "capital_giro", label: "Capital de giro", kind: "currency", group: "liquidez", hint: "Ativo circulante − Passivo circulante" },

  { key: "endividamento_geral", label: "Endividamento geral", kind: "percent", group: "endividamento", hint: "(PC + PNC) ÷ Ativo total" },
  { key: "endividamento_pl", label: "Endividamento sobre PL", kind: "ratio", group: "endividamento", hint: "(PC + PNC) ÷ Patrimônio líquido" },
  { key: "ativo_total", label: "Ativo total", kind: "currency", group: "endividamento", hint: "Ativo circulante + não circulante" },

  { key: "giro_ativo", label: "Giro do ativo", kind: "ratio", group: "giro", hint: "Receita ÷ Ativo total" },
  { key: "giro_estoque", label: "Giro do estoque", kind: "ratio", group: "giro", hint: "Custo ÷ Estoques" },
  { key: "pmr", label: "Prazo médio de recebimento", kind: "days", group: "giro", hint: "Clientes ÷ Receita × 30" },
  { key: "pmp", label: "Prazo médio de pagamento", kind: "days", group: "giro", hint: "Fornecedores ÷ Custo × 30" },
];

export const INDICATOR_BY_KEY = new Map(INDICATORS.map((i) => [i.key, i]));

export const GROUP_LABEL: Record<IndicatorMeta["group"], string> = {
  resultado: "Resultado do período",
  margens: "Margens",
  liquidez: "Liquidez e capital de giro",
  endividamento: "Estrutura e endividamento",
  giro: "Giro e prazos médios",
};

export const GROUP_ORDER: IndicatorMeta["group"][] = [
  "resultado",
  "margens",
  "liquidez",
  "endividamento",
  "giro",
];

export const COMPONENT_LABEL: Record<string, string> = {
  receita: "Receitas",
  custo: "Custos",
  despesa: "Despesas",
  caixa: "Caixa, bancos e aplicações",
  estoques: "Estoques",
  clientes: "Clientes e contas a receber",
  fornecedores: "Fornecedores e contas a pagar",
  ativo_circulante: "Ativo circulante",
  ativo_nao_circulante: "Ativo não circulante",
  passivo_circulante: "Passivo circulante",
  passivo_nao_circulante: "Passivo não circulante",
  patrimonio_liquido: "Patrimônio líquido",
};

export function formatIndicatorValue(kind: IndicatorKind, value: number | undefined | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  switch (kind) {
    case "currency":
      return formatCurrency(value);
    case "percent":
      return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "ratio":
      return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
    case "days":
      return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} dias`;
  }
}

/** Primeiro e último dia do mês de referência do período (YYYY-MM-DD). */
export function periodRange(referenceMonth: string | null | undefined) {
  const ref = referenceMonth?.slice(0, 10);
  if (!ref) return null;
  const y = Number(ref.slice(0, 4));
  const m = Number(ref.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ref.slice(0, 8)}01`, to: `${ref.slice(0, 8)}${String(last).padStart(2, "0")}` };
}
