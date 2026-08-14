import * as XLSX from "xlsx";
import { callAiJson } from "./ai-router.server";

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

/** Schema no dialeto responseSchema do Gemini. */
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          codigo: { type: "string", nullable: true },
          conta: { type: "string" },
          valor: { type: "number" },
          data: { type: "string", nullable: true },
        },
        required: ["conta", "valor"],
      },
    },
  },
  required: ["entries"],
} as const;

function mapAiRows(rows: Array<Record<string, unknown>>): ParsedEntry[] {
  return rows
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

const SYSTEM_INSTRUCTION =
  "Você extrai lançamentos de balancetes contábeis brasileiros exportados do sistema G2. " +
  "Retorne TODAS as linhas de conta das páginas enviadas, sem inventar dados. " +
  "Ignore cabeçalhos, rodapés e linhas de totalização geral. " +
  "O campo valor deve ser o saldo atual/final da conta em número (negativo quando devedor for indicado por D, parênteses ou sinal). " +
  "O campo data usa o formato AAAA-MM-DD e vem nulo quando não existir no documento.";

/** Quantidade de páginas por chamada — evita truncar a resposta da IA em balancetes longos. */
const PAGES_PER_CHUNK = 4;

async function splitPdfPages(bytes: ArrayBuffer): Promise<Uint8Array[]> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = source.getPageCount();
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < total; start += PAGES_PER_CHUNK) {
    const target = await PDFDocument.create();
    const indices = [];
    for (let i = start; i < Math.min(start + PAGES_PER_CHUNK, total); i += 1) indices.push(i);
    const pages = await target.copyPages(source, indices);
    pages.forEach((page) => target.addPage(page));
    chunks.push(await target.save());
  }
  return chunks;
}

async function readPdfChunk(data: string, mimeType: string): Promise<ParsedEntry[]> {
  const parsed = await callGeminiJson<{ entries?: Array<Record<string, unknown>> }>({
    errorContext: "Leitura do PDF",
    schema: EXTRACTION_SCHEMA,
    systemInstruction: SYSTEM_INSTRUCTION,
    parts: [
      { text: "Extraia todas as contas e valores das páginas deste balancete." },
      { inline_data: { mime_type: mimeType, data } },
    ],
  });
  return mapAiRows(parsed.entries ?? []);
}

/** Lê um PDF de balancete usando a API do Google Gemini e devolve os lançamentos. */
export async function parsePdfWithAi(
  bytes: ArrayBuffer,
  _filename: string,
  mimeType: string,
): Promise<ParsedEntry[]> {
  if (!bytes.byteLength) throw new Error("Arquivo PDF vazio.");

  let chunks: Uint8Array[];
  try {
    chunks = await splitPdfPages(bytes);
  } catch {
    chunks = [new Uint8Array(bytes)];
  }
  if (!chunks.length) chunks = [new Uint8Array(bytes)];

  const entries: ParsedEntry[] = [];
  const failures: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const base64 = bytesToBase64(chunks[index]!);
    try {
      entries.push(...(await readPdfChunk(base64, mimeType)));
    } catch (error) {
      failures.push(`bloco ${index + 1}: ${(error as Error).message}`);
    }
  }

  if (!entries.length && failures.length) {
    throw new Error(failures[0]!);
  }

  return entries;
}

