import * as XLSX from "xlsx";

export type ParsedEntry = {
  source_account_code: string | null;
  source_account_name: string;
  raw_value: number;
  entry_date: string | null;
};

/** Converte texto numérico no formato brasileiro para número. */
export function parseBrNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const suffix = text.match(/([CD])\s*$/i);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === "D") negative = true;
    text = text.replace(/([CD])\s*$/i, "");
  }
  if (text.trim().startsWith("-")) {
    negative = true;
    text = text.replace("-", "");
  }
  text = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!text) return null;

  // 1.234.567,89 -> 1234567.89 ; 1234.56 mantém ponto decimal
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  }
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const NAME_HINTS = ["descricao", "conta", "historico", "classificacao", "nome"];
const CODE_HINTS = ["codigo", "cod", "conta contabil", "reduzido", "classificador"];
const VALUE_HINTS = [
  "saldo atual",
  "saldo final",
  "saldo",
  "valor",
  "total",
  "montante",
  "credito",
  "debito",
];
const DATE_HINTS = ["data", "emissao", "vencimento", "competencia"];

function pickColumn(headers: string[], hints: string[]): number {
  for (const hint of hints) {
    const index = headers.findIndex((h) => h.includes(hint));
    if (index >= 0) return index;
  }
  return -1;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const br = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    const iso = value.trim().match(/^\d{4}-\d{2}-\d{2}$/);
    if (iso) return value.trim().slice(0, 10);
  }
  return null;
}

/** Lê planilhas (xlsx/xls/csv) do balancete e devolve os lançamentos brutos. */
export function parseSpreadsheet(bytes: ArrayBuffer): ParsedEntry[] {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const entries: ParsedEntry[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
    });
    if (!rows.length) continue;

    // Procura a linha de cabeçalho nas 30 primeiras linhas.
    let headerIndex = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
      const candidate = (rows[i] ?? []).map(normalizeHeader);
      const hasName = NAME_HINTS.some((hint) => candidate.some((c) => c.includes(hint)));
      const hasValue = VALUE_HINTS.some((hint) => candidate.some((c) => c.includes(hint)));
      if (hasName && hasValue) {
        headerIndex = i;
        headers = candidate;
        break;
      }
    }
    if (headerIndex < 0) continue;

    const nameCol = pickColumn(headers, NAME_HINTS);
    const codeCol = pickColumn(headers, CODE_HINTS);
    const valueCol = pickColumn(headers, VALUE_HINTS);
    const dateCol = pickColumn(headers, DATE_HINTS);
    if (nameCol < 0 || valueCol < 0) continue;

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const name = String(row[nameCol] ?? "").trim();
      if (!name) continue;
      const normalized = normalizeHeader(name);
      if (normalized.startsWith("total") && !row[valueCol]) continue;
      const value = parseBrNumber(row[valueCol]);
      if (value === null) continue;
      const code = codeCol >= 0 ? String(row[codeCol] ?? "").trim() : "";
      entries.push({
        source_account_code: code || null,
        source_account_name: name,
        raw_value: value,
        entry_date: dateCol >= 0 ? toIsoDate(row[dateCol]) : null,
      });
    }

    if (entries.length) break;
  }

  return entries;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          codigo: { type: ["string", "null"] },
          conta: { type: "string" },
          valor: { type: "number" },
          data: { type: ["string", "null"] },
        },
        required: ["codigo", "conta", "valor", "data"],
      },
    },
  },
  required: ["entries"],
} as const;

/** Lê um PDF de balancete usando o AI Gateway da Lovable e devolve os lançamentos. */
export async function parsePdfWithAi(
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<ParsedEntry[]> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurada para a leitura de PDF.");

  const base64 = bytesToBase64(new Uint8Array(bytes));
  if (!base64) throw new Error("Arquivo PDF vazio.");

  const response = await fetch(AI_GATEWAY_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "Você extrai lançamentos de balancetes contábeis brasileiros exportados do sistema G2. " +
            "Retorne TODAS as linhas de conta do documento, sem inventar dados. " +
            "Ignore cabeçalhos, rodapés e linhas de totalização geral. " +
            "O campo valor deve ser o saldo atual/final da conta em número (negativo quando devedor for indicado por D, parênteses ou sinal). " +
            "O campo data usa o formato AAAA-MM-DD e vem nulo quando não existir no documento. " +
            "Responda em json seguindo o schema informado.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extraia todas as contas e valores deste balancete.",
            },
            {
              type: "file",
              file: {
                filename,
                file_data: `data:${mimeType};base64,${base64}`,
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "balancete",
          strict: true,
          schema: EXTRACTION_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) throw new Error("Limite de uso da IA atingido. Tente novamente.");
    if (response.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
    throw new Error(`Falha na leitura do PDF pela IA (${response.status}). ${detail.slice(0, 300)}`);
  }

  const text = await readChatStream(response);

  if (!text.trim()) throw new Error("A IA não retornou conteúdo para este PDF.");

  let parsed: { entries?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(text) as { entries?: Array<Record<string, unknown>> };
  } catch {
    throw new Error("Não foi possível interpretar o retorno da IA para este PDF.");
  }

  return (parsed.entries ?? [])
    .map((row) => {
      const name = String(row["conta"] ?? "").trim();
      const value =
        typeof row["valor"] === "number" ? row["valor"] : parseBrNumber(row["valor"] as string);
      if (!name || value === null || value === undefined) return null;
      const code = row["codigo"] == null ? null : String(row["codigo"]).trim() || null;
      const date = row["data"] == null ? null : toIsoDate(String(row["data"]));
      return {
        source_account_code: code,
        source_account_name: name,
        raw_value: value,
        entry_date: date,
      } satisfies ParsedEntry;
    })
    .filter((entry): entry is ParsedEntry => entry !== null);
}
