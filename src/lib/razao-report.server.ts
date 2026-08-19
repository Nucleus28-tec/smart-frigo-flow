/** Geração de PDF e Excel dos relatórios do razão contábil e do balancete analítico. */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import {
  amount,
  balanceLabel,
  formatDay,
  type LedgerReport,
  type TrialBalanceReport,
} from "@/lib/razao-report-types";

const BRAND = rgb(0.54, 0.18, 0.15);
const INK = rgb(0.13, 0.12, 0.12);
const MUTED = rgb(0.42, 0.4, 0.4);

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 34;

function safe(text: string) {
  return String(text ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

function periodText(from: string | null, to: string | null) {
  if (!from && !to) return "Todo o periodo";
  return `${formatDay(from) || "inicio"} a ${formatDay(to) || "fim"}`;
}

type Ctx = {
  pdf: PDFDocument;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
};

function makePage(ctx: Ctx, title: string, subtitle: string, generatedAt: Date) {
  const page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: PAGE_H - 58, width: PAGE_W, height: 58, color: BRAND });
  page.drawText("ROTTA", {
    x: MARGIN,
    y: PAGE_H - 30,
    size: 15,
    font: ctx.bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(safe("Financeiro Inteligente"), {
    x: MARGIN,
    y: PAGE_H - 45,
    size: 8,
    font: ctx.font,
    color: rgb(1, 1, 1),
  });
  page.drawText(safe(title), {
    x: MARGIN + 130,
    y: PAGE_H - 30,
    size: 13,
    font: ctx.bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(safe(subtitle), {
    x: MARGIN + 130,
    y: PAGE_H - 45,
    size: 8,
    font: ctx.font,
    color: rgb(1, 1, 1),
  });
  page.drawText(
    safe(generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })),
    { x: PAGE_W - MARGIN - 110, y: PAGE_H - 38, size: 8, font: ctx.font, color: rgb(1, 1, 1) },
  );
  return page;
}

type Page = ReturnType<typeof makePage>;

function truncate(
  text: string,
  font: Ctx["font"],
  size: number,
  max: number,
) {
  let value = safe(text);
  while (value.length > 0 && font.widthOfTextAtSize(value, size) > max) value = value.slice(0, -1);
  return value;
}

function drawRow(
  page: Page,
  ctx: Ctx,
  y: number,
  cells: { text: string; x: number; width: number; right?: boolean; bold?: boolean }[],
  size = 8,
) {
  for (const cell of cells) {
    const font = cell.bold ? ctx.bold : ctx.font;
    const text = truncate(cell.text, font, size, cell.width);
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: cell.right ? cell.x + cell.width - width : cell.x,
      y,
      size,
      font,
      color: INK,
    });
  }
}

/* --------------------------- Razão contábil analítico --------------------------- */

const LEDGER_COLS = [
  { key: "doc", label: "CODIGO", width: 62 },
  { key: "data", label: "DATA", width: 62 },
  { key: "contra", label: "CONTRA-PART.", width: 90 },
  { key: "hist", label: "HISTORICO", width: 322 },
  { key: "debito", label: "DEBITO", width: 82, right: true },
  { key: "credito", label: "CREDITO", width: 82, right: true },
  { key: "saldo", label: "SALDO ATUAL", width: 74, right: true },
];

function colX(index: number) {
  let x = MARGIN;
  for (let i = 0; i < index; i += 1) x += LEDGER_COLS[i]!.width + 4;
  return x;
}

export async function buildLedgerReportPdf(options: {
  periodLabel: string;
  report: LedgerReport;
  multiPage: boolean;
  generatedAt: Date;
}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatorio Razao Contabil Analitico - ${options.periodLabel}`);
  pdf.setAuthor("Rotta Financeiro");
  const ctx: Ctx = {
    pdf,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const subtitle = `${options.periodLabel} - Data mov.: ${periodText(options.report.from, options.report.to)}`;

  let page = makePage(ctx, "RELATORIO RAZAO CONTABIL ANALITICO", subtitle, options.generatedAt);
  let y = PAGE_H - 84;

  const drawHeader = () => {
    LEDGER_COLS.forEach((col, index) => {
      drawRow(page, ctx, y, [
        { text: col.label, x: colX(index), width: col.width, right: Boolean(col.right), bold: true },
      ]);
    });
    y -= 5;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.8,
      color: BRAND,
    });
    y -= 12;
  };

  const newPage = () => {
    page = makePage(ctx, "RELATORIO RAZAO CONTABIL ANALITICO", subtitle, options.generatedAt);
    y = PAGE_H - 84;
    drawHeader();
  };

  drawHeader();

  options.report.accounts.forEach((account, accountIndex) => {
    if (options.multiPage && accountIndex > 0) newPage();
    if (y < 90) newPage();

    drawRow(
      page,
      ctx,
      y,
      [
        {
          text: `CONTA: ${account.code} - ${account.name}`,
          x: MARGIN,
          width: 560,
          bold: true,
        },
        {
          text: `SALDO ANTERIOR: ${balanceLabel(account.opening_balance)}`,
          x: colX(4),
          width: LEDGER_COLS[4]!.width + LEDGER_COLS[5]!.width + LEDGER_COLS[6]!.width + 8,
          right: true,
          bold: true,
        },
      ],
      9,
    );
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.78, 0.76, 0.76),
    });
    y -= 12;

    for (const line of account.lines) {
      if (y < 60) newPage();
      drawRow(page, ctx, y, [
        { text: line.doc_number ?? "", x: colX(0), width: LEDGER_COLS[0]!.width },
        { text: formatDay(line.entry_date), x: colX(1), width: LEDGER_COLS[1]!.width },
        { text: line.counterpart_reduced_code ?? "", x: colX(2), width: LEDGER_COLS[2]!.width },
        { text: line.historico ?? "", x: colX(3), width: LEDGER_COLS[3]!.width },
        {
          text: line.debit ? amount(line.debit) : "",
          x: colX(4),
          width: LEDGER_COLS[4]!.width,
          right: true,
        },
        {
          text: line.credit ? amount(line.credit) : "",
          x: colX(5),
          width: LEDGER_COLS[5]!.width,
          right: true,
        },
        {
          text: balanceLabel(line.running_balance),
          x: colX(6),
          width: LEDGER_COLS[6]!.width,
          right: true,
        },
      ]);
      y -= 11;
    }

    if (y < 60) newPage();
    y -= 2;
    page.drawLine({
      start: { x: MARGIN, y: y + 8 },
      end: { x: PAGE_W - MARGIN, y: y + 8 },
      thickness: 0.5,
      color: rgb(0.78, 0.76, 0.76),
    });
    drawRow(page, ctx, y, [
      {
        text: `Total de itens: ${account.line_count}`,
        x: MARGIN,
        width: 200,
        bold: true,
      },
      {
        text: amount(account.total_debit),
        x: colX(4),
        width: LEDGER_COLS[4]!.width,
        right: true,
        bold: true,
      },
      {
        text: amount(account.total_credit),
        x: colX(5),
        width: LEDGER_COLS[5]!.width,
        right: true,
        bold: true,
      },
      {
        text: balanceLabel(account.closing_balance),
        x: colX(6),
        width: LEDGER_COLS[6]!.width,
        right: true,
        bold: true,
      },
    ]);
    y -= 22;
  });

  for (const p of pdf.getPages()) {
    p.drawText(safe("Rotta Financeiro - relatorio gerado automaticamente. Valores em R$."), {
      x: MARGIN,
      y: 20,
      size: 7,
      font: ctx.font,
      color: MUTED,
    });
  }

  return await pdf.save();
}

/* ------------------------------ Balancete analítico ------------------------------ */

const TB_COLS = [
  { key: "code", label: "CODIGO", width: 70 },
  { key: "hier", label: "PLANO DE CONTAS", width: 140 },
  { key: "name", label: "DESCRICAO", width: 250 },
  { key: "ant", label: "SALDO ANTERIOR", width: 96, right: true },
  { key: "deb", label: "DEBITO", width: 86, right: true },
  { key: "cred", label: "CREDITO", width: 86, right: true },
  { key: "atual", label: "SALDO ATUAL", width: 96, right: true },
];

function tbColX(index: number) {
  let x = MARGIN;
  for (let i = 0; i < index; i += 1) x += TB_COLS[i]!.width + 4;
  return x;
}

export async function buildTrialBalanceReportPdf(options: {
  periodLabel: string;
  report: TrialBalanceReport;
  generatedAt: Date;
}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Balancete Analitico - ${options.periodLabel}`);
  pdf.setAuthor("Rotta Financeiro");
  const ctx: Ctx = {
    pdf,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const subtitle = `${options.periodLabel} - Data mov.: ${periodText(options.report.from, options.report.to)}`;

  let page = makePage(ctx, "BALANCETE ANALITICO", subtitle, options.generatedAt);
  let y = PAGE_H - 84;

  const drawHeader = () => {
    TB_COLS.forEach((col, index) => {
      drawRow(page, ctx, y, [
        { text: col.label, x: tbColX(index), width: col.width, right: Boolean(col.right), bold: true },
      ]);
    });
    y -= 5;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.8,
      color: BRAND,
    });
    y -= 12;
  };

  drawHeader();

  for (const row of options.report.rows) {
    if (y < 56) {
      page = makePage(ctx, "BALANCETE ANALITICO", subtitle, options.generatedAt);
      y = PAGE_H - 84;
      drawHeader();
    }
    drawRow(page, ctx, y, [
      { text: row.code, x: tbColX(0), width: TB_COLS[0]!.width },
      { text: row.hierarchical_code ?? "", x: tbColX(1), width: TB_COLS[1]!.width },
      { text: row.name, x: tbColX(2), width: TB_COLS[2]!.width },
      {
        text: balanceLabel(row.saldo_anterior),
        x: tbColX(3),
        width: TB_COLS[3]!.width,
        right: true,
      },
      { text: amount(row.debito), x: tbColX(4), width: TB_COLS[4]!.width, right: true },
      { text: amount(row.credito), x: tbColX(5), width: TB_COLS[5]!.width, right: true },
      {
        text: balanceLabel(row.saldo_atual),
        x: tbColX(6),
        width: TB_COLS[6]!.width,
        right: true,
      },
    ]);
    y -= 11;
  }

  if (y < 56) {
    page = makePage(ctx, "BALANCETE ANALITICO", subtitle, options.generatedAt);
    y = PAGE_H - 84;
    drawHeader();
  }
  page.drawLine({
    start: { x: MARGIN, y: y + 8 },
    end: { x: PAGE_W - MARGIN, y: y + 8 },
    thickness: 0.6,
    color: rgb(0.78, 0.76, 0.76),
  });
  drawRow(page, ctx, y, [
    { text: `Total de contas: ${options.report.rows.length}`, x: MARGIN, width: 240, bold: true },
    {
      text: amount(options.report.totals.debito),
      x: tbColX(4),
      width: TB_COLS[4]!.width,
      right: true,
      bold: true,
    },
    {
      text: amount(options.report.totals.credito),
      x: tbColX(5),
      width: TB_COLS[5]!.width,
      right: true,
      bold: true,
    },
  ]);

  for (const p of pdf.getPages()) {
    p.drawText(safe("Rotta Financeiro - relatorio gerado automaticamente. Valores em R$."), {
      x: MARGIN,
      y: 20,
      size: 7,
      font: ctx.font,
      color: MUTED,
    });
  }

  return await pdf.save();
}

/* ---------------------------------- Excel ---------------------------------- */

function sheetName(base: string, used: Set<string>) {
  let name = base.replace(/[\\/?*[\]:]/g, "-").slice(0, 28) || "Conta";
  let suffix = 1;
  while (used.has(name)) {
    name = `${name.slice(0, 25)}_${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

export function buildLedgerReportXlsx(options: {
  periodLabel: string;
  report: LedgerReport;
  multiPage: boolean;
  generatedAt: Date;
}) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const resumo: (string | number)[][] = [
    ["Rotta Financeiro — Razão Contábil Analítico"],
    ["Período", options.periodLabel],
    ["Data mov.", periodText(options.report.from, options.report.to)],
    ["Gerado em", options.generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
    [],
    ["Código", "Conta", "Saldo anterior", "Débito", "Crédito", "Saldo atual", "Itens"],
    ...options.report.accounts.map((a) => [
      a.code,
      a.name,
      a.opening_balance,
      a.total_debit,
      a.total_credit,
      a.closing_balance,
      a.line_count,
    ]),
  ];
  const resumoSheet = XLSX.utils.aoa_to_sheet(resumo);
  resumoSheet["!cols"] = [
    { wch: 14 },
    { wch: 46 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(wb, resumoSheet, sheetName("Resumo", used));

  const headers = [
    "Conta",
    "Nome da conta",
    "Código",
    "Data",
    "Contra-partida",
    "Contrapartida (nome)",
    "Histórico",
    "Débito",
    "Crédito",
    "Saldo atual",
  ];

  if (options.multiPage) {
    for (const account of options.report.accounts) {
      const rows: (string | number)[][] = [
        [`CONTA: ${account.code} - ${account.name}`],
        ["Saldo anterior", account.opening_balance],
        [],
        headers,
        ...account.lines.map((line) => [
          account.code,
          account.name,
          line.doc_number ?? "",
          formatDay(line.entry_date),
          line.counterpart_reduced_code ?? "",
          line.counterpart_name ?? "",
          line.historico ?? "",
          line.debit,
          line.credit,
          line.running_balance,
        ]),
        [],
        ["Totais", "", "", "", "", "", "", account.total_debit, account.total_credit, account.closing_balance],
      ];
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet["!cols"] = [
        { wch: 12 },
        { wch: 34 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 30 },
        { wch: 60 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, sheet, sheetName(account.code, used));
    }
  } else {
    const rows: (string | number)[][] = [headers];
    for (const account of options.report.accounts) {
      rows.push([`CONTA: ${account.code} - ${account.name}`, "", "", "", "", "", "Saldo anterior", "", "", account.opening_balance]);
      for (const line of account.lines) {
        rows.push([
          account.code,
          account.name,
          line.doc_number ?? "",
          formatDay(line.entry_date),
          line.counterpart_reduced_code ?? "",
          line.counterpart_name ?? "",
          line.historico ?? "",
          line.debit,
          line.credit,
          line.running_balance,
        ]);
      }
      rows.push([
        "Totais",
        account.name,
        "",
        "",
        "",
        "",
        `Itens: ${account.line_count}`,
        account.total_debit,
        account.total_credit,
        account.closing_balance,
      ]);
      rows.push([]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 12 },
      { wch: 34 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 30 },
      { wch: 60 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, sheet, sheetName("Razão", used));
  }

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function buildTrialBalanceReportXlsx(options: {
  periodLabel: string;
  report: TrialBalanceReport;
  generatedAt: Date;
}) {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [
    ["Rotta Financeiro — Balancete Analítico"],
    ["Período", options.periodLabel],
    ["Data mov.", periodText(options.report.from, options.report.to)],
    ["Gerado em", options.generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
    [],
    [
      "Código",
      "Plano de contas",
      "Descrição",
      "Natureza",
      "Saldo anterior",
      "Débito",
      "Crédito",
      "Saldo atual",
    ],
    ...options.report.rows.map((row) => [
      row.code,
      row.hierarchical_code ?? "",
      row.name,
      row.nature ?? "",
      row.saldo_anterior,
      row.debito,
      row.credito,
      row.saldo_atual,
    ]),
    [],
    ["Totais", "", "", "", "", options.report.totals.debito, options.report.totals.credito, ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 48 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, sheet, "Balancete");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
