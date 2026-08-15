/** Mapeamento de colunas e validação da importação do razão por CSV/Excel. */

export type RazaoField =
  | "account_reduced_code"
  | "account_name"
  | "opening_balance"
  | "entry_date"
  | "doc_number"
  | "counterpart_reduced_code"
  | "historico"
  | "debit"
  | "credit"
  | "running_balance";

export type FieldDef = {
  key: RazaoField;
  label: string;
  required: boolean;
  kind: "text" | "number" | "date";
  hints: string[];
};

export const RAZAO_FIELDS: FieldDef[] = [
  {
    key: "account_reduced_code",
    label: "Conta reduzida",
    required: true,
    kind: "text",
    hints: ["conta reduzida", "reduzido", "cod reduzido", "codigo conta", "conta"],
  },
  {
    key: "account_name",
    label: "Nome da conta",
    required: false,
    kind: "text",
    hints: ["nome da conta", "descricao conta", "descricao", "historico conta", "conta nome"],
  },
  {
    key: "opening_balance",
    label: "Saldo anterior",
    required: false,
    kind: "number",
    hints: ["saldo anterior", "anterior", "saldo inicial"],
  },
  { key: "entry_date", label: "Data", required: false, kind: "date", hints: ["data", "dt", "emissao"] },
  {
    key: "doc_number",
    label: "Número do lançamento",
    required: false,
    kind: "text",
    hints: ["lancamento", "lcto", "documento", "doc", "numero"],
  },
  {
    key: "counterpart_reduced_code",
    label: "Contrapartida",
    required: false,
    kind: "text",
    hints: ["contrapartida", "contra partida", "c/partida", "cp"],
  },
  {
    key: "historico",
    label: "Histórico",
    required: false,
    kind: "text",
    hints: ["historico", "complemento", "descricao lancamento"],
  },
  { key: "debit", label: "Débito", required: true, kind: "number", hints: ["debito", "debit", "d"] },
  { key: "credit", label: "Crédito", required: true, kind: "number", hints: ["credito", "credit", "c"] },
  {
    key: "running_balance",
    label: "Saldo acumulado",
    required: false,
    kind: "number",
    hints: ["saldo", "saldo atual", "acumulado"],
  },
];

export type Mapping = Partial<Record<RazaoField, string>>;

const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Pré-seleção das colunas por semelhança de nome. */
export function autoMap(columns: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const field of RAZAO_FIELDS) {
    const match = columns.find((column) => {
      if (used.has(column)) return false;
      const n = norm(column);
      return field.hints.some((hint) => n === norm(hint) || n.includes(norm(hint)));
    });
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  return mapping;
}

export function parseNumberBR(value: unknown): number | null {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value).trim();
  if (!text) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/[DC]$/i.test(text)) text = text.slice(0, -1).trim();
  text = text.replace(/[R$\s\u00a0]/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if ((text.match(/\./g) ?? []).length > 1) text = text.replace(/\./g, "");
  if (text === "" || text === "-") return 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function parseDateISO(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  let match = /^(\d{2})[/\-.](\d{2})[/\-.](\d{2,4})$/.exec(text);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2]}-${match[1]}`;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return undefined; // formato inválido
}

export type Leg = {
  account_reduced_code: string;
  account_name: string;
  opening_balance?: number;
  entry_date: string | null;
  doc_number: string | null;
  counterpart_reduced_code: string | null;
  historico: string | null;
  debit: number;
  credit: number;
  running_balance: number | null;
  line_no: number;
};

export type Issue = {
  line: number;
  level: "erro" | "aviso";
  message: string;
  preview: string;
};

export type BuildResult = {
  legs: Leg[];
  issues: Issue[];
  errors: number;
  warnings: number;
  ignored: number;
};

const text = (row: Record<string, unknown>, column?: string) =>
  column ? String(row[column] ?? "").trim() : "";

/** Converte as linhas da planilha em pernas do razão, validando o formato. */
export function buildLegs(rows: Record<string, unknown>[], mapping: Mapping): BuildResult {
  const legs: Leg[] = [];
  const issues: Issue[] = [];
  let ignored = 0;

  const seenAccounts = new Set<string>();
  const knownCodes = new Set<string>();
  for (const row of rows) {
    const code = text(row, mapping.account_reduced_code);
    if (code) knownCodes.add(code);
  }

  rows.forEach((row, index) => {
    const line = index + 2; // 1 = cabeçalho
    const preview = Object.values(row).slice(0, 5).map(String).join(" | ").slice(0, 140);
    const push = (level: Issue["level"], message: string) =>
      issues.push({ line, level, message, preview });

    const code = text(row, mapping.account_reduced_code);
    if (!code) {
      push("erro", "Conta reduzida vazia.");
      return;
    }

    const debit = parseNumberBR(mapping.debit ? row[mapping.debit] : 0);
    const credit = parseNumberBR(mapping.credit ? row[mapping.credit] : 0);
    if (debit == null || credit == null) {
      push("erro", "Valor de débito ou crédito não numérico.");
      return;
    }

    const dateValue = mapping.entry_date ? parseDateISO(row[mapping.entry_date]) : null;
    if (dateValue === undefined) {
      push("erro", "Data em formato inválido (use dd/mm/aaaa ou aaaa-mm-dd).");
      return;
    }

    const running = mapping.running_balance ? parseNumberBR(row[mapping.running_balance]) : null;
    const opening = mapping.opening_balance ? parseNumberBR(row[mapping.opening_balance]) : null;
    const counterpart = text(row, mapping.counterpart_reduced_code) || null;

    if (debit !== 0 && credit !== 0) {
      push("aviso", "Linha com débito e crédito ao mesmo tempo — será ignorada.");
      ignored += 1;
      return;
    }
    if (debit === 0 && credit === 0) {
      push("aviso", "Linha sem débito e sem crédito — será ignorada.");
      ignored += 1;
      return;
    }
    if (counterpart && !knownCodes.has(counterpart)) {
      push("aviso", `Contrapartida ${counterpart} não aparece como conta no arquivo.`);
    }

    const name = text(row, mapping.account_name) || code;
    const leg: Leg = {
      account_reduced_code: code,
      account_name: name,
      entry_date: dateValue ?? null,
      doc_number: text(row, mapping.doc_number) || null,
      counterpart_reduced_code: counterpart,
      historico: text(row, mapping.historico) || null,
      debit,
      credit,
      running_balance: running,
      line_no: index + 1,
    };
    if (opening != null && !seenAccounts.has(code)) {
      leg.opening_balance = opening;
      seenAccounts.add(code);
    }
    legs.push(leg);
  });

  return {
    legs,
    issues,
    errors: issues.filter((i) => i.level === "erro").length,
    warnings: issues.filter((i) => i.level === "aviso").length,
    ignored,
  };
}

const STORAGE_KEY = "rotta:razao-mapping";

export function loadSavedMapping(): Mapping {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Mapping;
  } catch {
    return {};
  }
}

export function saveMapping(mapping: Mapping) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mapping));
  } catch {
    /* armazenamento indisponível */
  }
}
