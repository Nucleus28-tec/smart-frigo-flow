/** Leitura de CSV/Excel no navegador para importação com mapeamento de colunas. */
import * as XLSX from "xlsx";

export type SheetData = {
  columns: string[];
  rows: Record<string, unknown>[];
  sheetName: string;
};

export function isSpreadsheet(file: File) {
  return /\.(csv|xlsx|xls|txt)$/i.test(file.name);
}

export async function readSheet(file: File): Promise<SheetData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("Planilha vazia ou ilegível.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (matrix.length === 0) throw new Error("Planilha sem linhas.");

  // Cabeçalho = primeira linha com pelo menos duas células preenchidas.
  const headerIndex = matrix.findIndex(
    (row) => row.filter((cell) => String(cell ?? "").trim() !== "").length >= 2,
  );
  const header = (matrix[headerIndex >= 0 ? headerIndex : 0] ?? []).map((cell, index) => {
    const label = String(cell ?? "").trim();
    return label || `Coluna ${index + 1}`;
  });

  const rows: Record<string, unknown>[] = [];
  for (let i = (headerIndex >= 0 ? headerIndex : 0) + 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    if (raw.every((cell) => String(cell ?? "").trim() === "")) continue;
    const row: Record<string, unknown> = {};
    header.forEach((name, index) => {
      row[name] = raw[index] ?? "";
    });
    rows.push(row);
  }

  return { columns: header, rows, sheetName: sheetName ?? "" };
}

/**
 * Lê a planilha como matriz bruta (linha x coluna), sem colapsar cabeçalho.
 * Necessário para formatos de relatório paginado (ex.: razão do G2 exportado em
 * XLS), onde a estrutura é por blocos — não uma tabela plana de 1 linha por
 * registro. Ver `parseRazaoSheetMatrix` em `razao-parser.ts`.
 */
export async function readRawMatrix(
  file: File,
): Promise<{ matrix: unknown[][]; sheetName: string }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("Planilha vazia ou ilegível.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: "",
  });
  return { matrix, sheetName: sheetName ?? "" };
}

/**
 * Detecta se a planilha é o relatório "Razão Contábil Analítico" do G2
 * exportado em XLS/XLSX (estrutura por blocos de conta, não tabular) em vez de
 * uma planilha genérica de lançamentos.
 */
export function looksLikeG2RazaoReport(matrix: unknown[][]): boolean {
  let hits = 0;
  for (const row of matrix.slice(0, 200)) {
    const cells = row.map((c) => String(c ?? "").trim());
    if (cells.some((c) => /^CONTA:$/i.test(c))) hits += 1;
    if (cells.includes("CÓDIGO") && cells.some((c) => /^HIST[ÓO]RICO$/i.test(c))) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}
