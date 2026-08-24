/** Exportação de extratos e lançamentos do razão em CSV e PDF (no navegador). */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ExportTable = {
  title: string;
  subtitle?: string;
  info?: { label: string; value: string }[];
  headers: string[];
  rows: (string | number)[][];
  /** índices das colunas alinhadas à direita */
  numeric?: number[];
};

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const csvCell = (value: string | number) => {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
};

export function exportCsv(table: ExportTable, filename: string) {
  const lines: string[] = [];
  lines.push(csvCell(table.title));
  if (table.subtitle) lines.push(csvCell(table.subtitle));
  for (const item of table.info ?? []) lines.push([item.label, item.value].map(csvCell).join(";"));
  if ((table.info ?? []).length || table.subtitle) lines.push("");
  lines.push(table.headers.map(csvCell).join(";"));
  for (const row of table.rows) lines.push(row.map(csvCell).join(";"));
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  download(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

const clean = (value: string | number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\xFF]/g, "");

export async function exportPdf(table: ExportTable, filename: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const width = 842;
  const height = 595; // paisagem A4
  const margin = 32;
  const usable = width - margin * 2;
  const columnCount = table.headers.length;
  const columnWidth = usable / columnCount;

  let page = pdf.addPage([width, height]);
  let y = height - margin;

  const truncate = (value: string, size: number, max: number) => {
    let text = clean(value);
    while (text.length > 0 && font.widthOfTextAtSize(text, size) > max) text = text.slice(0, -1);
    return text;
  };

  const header = () => {
    page.drawText(truncate(table.title, 14, usable), {
      x: margin,
      y: y - 14,
      size: 14,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 22;
    if (table.subtitle) {
      page.drawText(truncate(table.subtitle, 9, usable), {
        x: margin,
        y: y - 10,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 16;
    }
    for (const item of table.info ?? []) {
      page.drawText(truncate(`${item.label}: ${item.value}`, 9, usable), {
        x: margin,
        y: y - 10,
        size: 9,
        font,
        color: rgb(0.25, 0.25, 0.25),
      });
      y -= 13;
    }
    y -= 6;
    table.headers.forEach((label, index) => {
      const right = table.numeric?.includes(index);
      const text = truncate(label, 8, columnWidth - 6);
      const textWidth = bold.widthOfTextAtSize(text, 8);
      page.drawText(text, {
        x: right
          ? margin + columnWidth * (index + 1) - 4 - textWidth
          : margin + columnWidth * index + 2,
        y: y - 9,
        size: 8,
        font: bold,
      });
    });
    y -= 14;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.6,
      color: rgb(0.75, 0.75, 0.75),
    });
    y -= 4;
  };

  header();

  for (const row of table.rows) {
    if (y < margin + 24) {
      page = pdf.addPage([width, height]);
      y = height - margin;
      header();
    }
    row.slice(0, columnCount).forEach((cell, index) => {
      const right = table.numeric?.includes(index);
      const text = truncate(String(cell ?? ""), 8, columnWidth - 6);
      const textWidth = font.widthOfTextAtSize(text, 8);
      page.drawText(text, {
        x: right
          ? margin + columnWidth * (index + 1) - 4 - textWidth
          : margin + columnWidth * index + 2,
        y: y - 9,
        size: 8,
        font,
      });
    });
    y -= 12;
  }

  const bytes = await pdf.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  download(new Blob([buffer], { type: "application/pdf" }), filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

/* ------------------- Download local a partir do retorno do servidor ------------------- */

/** Converte o conteúdo base64 devolvido pelo servidor em Blob no navegador. */
export function base64ToBlob(base64: string, contentType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/** Dispara o download de um Blob sem depender de pop-up ou URL externa. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

/** Baixa o arquivo devolvido por uma server function de exportação. */
export function downloadExported(result: {
  base64: string;
  content_type: string;
  file_name: string;
}) {
  downloadBlob(base64ToBlob(result.base64, result.content_type), result.file_name);
}
