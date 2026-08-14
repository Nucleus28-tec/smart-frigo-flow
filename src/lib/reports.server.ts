import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";

export type StatementLine = { label: string; value: number; kind?: string };
export type StatementContent = { titulo: string; linhas: StatementLine[] };
export type StatementRecord = { statement_type: string; content: StatementContent };

export const STATEMENT_LABEL: Record<string, string> = {
  dre: "DRE — Demonstração do Resultado",
  balanco_patrimonial: "Balanço Patrimonial",
  fluxo_de_caixa: "Fluxo de Caixa",
};

const BRAND = rgb(0.54, 0.18, 0.15);
const INK = rgb(0.13, 0.12, 0.12);
const MUTED = rgb(0.42, 0.4, 0.4);

function money(value: number) {
  const abs = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${abs})` : abs;
}

/** Remove caracteres fora do WinAnsi suportado pelas fontes padrão do PDF. */
function safe(text: string) {
  return text
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\xFF]/g, "");
}

export async function buildStatementsPdf(options: {
  periodLabel: string;
  statements: StatementRecord[];
  generatedAt: Date;
}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Demonstrativos ${options.periodLabel} — Rotta Financeiro`);
  pdf.setAuthor("Rotta Financeiro");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = () => {
    const p = pdf.addPage([595.28, 841.89]);
    const { width, height } = p.getSize();
    // Faixa de marca com o logo Rotta
    p.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: BRAND });
    p.drawRectangle({
      x: 44,
      y: height - 72,
      width: 40,
      height: 40,
      color: rgb(1, 1, 1),
      opacity: 0.14,
    });
    p.drawText("R", {
      x: 56,
      y: height - 62,
      size: 24,
      font: bold,
      color: rgb(1, 1, 1),
    });
    p.drawText("ROTTA", {
      x: 96,
      y: height - 50,
      size: 20,
      font: bold,
      color: rgb(1, 1, 1),
    });
    p.drawText(safe("Financeiro Inteligente"), {
      x: 96,
      y: height - 66,
      size: 9,
      font,
      color: rgb(1, 1, 1),
    });
    p.drawText(safe(`Periodo: ${options.periodLabel}`), {
      x: width - 200,
      y: height - 50,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    });
    p.drawText(
      safe(`Gerado em ${options.generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`),
      { x: width - 200, y: height - 66, size: 8, font, color: rgb(1, 1, 1) },
    );
    return p;
  };

  let current = page();
  let y = current.getSize().height - 130;
  const width = current.getSize().width;

  for (const statement of options.statements) {
    if (y < 160) {
      current = page();
      y = current.getSize().height - 130;
    }
    current.drawText(safe(STATEMENT_LABEL[statement.statement_type] ?? statement.statement_type), {
      x: 44,
      y,
      size: 14,
      font: bold,
      color: BRAND,
    });
    y -= 8;
    current.drawLine({
      start: { x: 44, y },
      end: { x: width - 44, y },
      thickness: 1,
      color: BRAND,
    });
    y -= 22;

    for (const line of statement.content?.linhas ?? []) {
      if (y < 70) {
        current = page();
        y = current.getSize().height - 130;
      }
      const isTotal = line.kind === "total" || line.kind === "subtotal";
      const lineFont = isTotal ? bold : font;
      const color = isTotal ? INK : MUTED;
      current.drawText(safe(line.label), { x: 52, y, size: 10, font: lineFont, color });
      const text = safe(money(Number(line.value ?? 0)));
      const textWidth = lineFont.widthOfTextAtSize(text, 10);
      current.drawText(text, {
        x: width - 52 - textWidth,
        y,
        size: 10,
        font: lineFont,
        color: Number(line.value) < 0 ? rgb(0.6, 0.15, 0.15) : color,
      });
      if (isTotal) {
        current.drawLine({
          start: { x: 52, y: y - 5 },
          end: { x: width - 52, y: y - 5 },
          thickness: 0.5,
          color: rgb(0.8, 0.78, 0.78),
        });
      }
      y -= 18;
    }
    y -= 26;
  }

  for (const p of pdf.getPages()) {
    p.drawText(safe("Rotta Financeiro — documento gerado automaticamente. Valores em R$."), {
      x: 44,
      y: 30,
      size: 8,
      font,
      color: MUTED,
    });
  }

  return await pdf.save();
}

export function buildStatementsXlsx(options: {
  periodLabel: string;
  statements: StatementRecord[];
  generatedAt: Date;
}) {
  const wb = XLSX.utils.book_new();

  const resumo = [
    ["Rotta Financeiro — Demonstrativos"],
    ["Período", options.periodLabel],
    [
      "Gerado em",
      options.generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    ],
    [],
    ["Demonstrativo", "Linhas"],
    ...options.statements.map((s) => [
      STATEMENT_LABEL[s.statement_type] ?? s.statement_type,
      (s.content?.linhas ?? []).length,
    ]),
  ];
  const resumoSheet = XLSX.utils.aoa_to_sheet(resumo);
  resumoSheet["!cols"] = [{ wch: 38 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, resumoSheet, "Resumo");

  const sheetNames: Record<string, string> = {
    dre: "DRE",
    balanco_patrimonial: "Balanço Patrimonial",
    fluxo_de_caixa: "Fluxo de Caixa",
  };

  for (const statement of options.statements) {
    const rows: (string | number)[][] = [
      [STATEMENT_LABEL[statement.statement_type] ?? statement.statement_type],
      ["Período", options.periodLabel],
      [],
      ["Linha", "Valor (R$)", "Tipo"],
      ...(statement.content?.linhas ?? []).map((line) => [
        line.label,
        Number(line.value ?? 0),
        line.kind === "total" ? "Total" : line.kind === "subtotal" ? "Subtotal" : "Item",
      ]),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 42 }, { wch: 18 }, { wch: 12 }];
    for (let r = 4; r < rows.length; r += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell) cell.z = "#,##0.00;(#,##0.00)";
    }
    XLSX.utils.book_append_sheet(
      wb,
      sheet,
      (sheetNames[statement.statement_type] ?? statement.statement_type).slice(0, 31),
    );
  }

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
