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
