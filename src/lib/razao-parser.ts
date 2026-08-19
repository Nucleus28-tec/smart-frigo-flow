/**
 * Leitura determinística (sem IA) dos PDFs do G2:
 *  - Razão contábil analítico  -> pernas de lançamento
 *  - Balancete analítico       -> árvore oficial de contas
 *
 * Roda no navegador com pdfjs-dist, usando a posição X de cada item de texto
 * para identificar as colunas (débito, crédito, saldo).
 */

export type RazaoLeg = {
  account_reduced_code: string;
  account_name: string;
  opening_balance?: number;
  doc_number: string | null;
  entry_date: string | null;
  counterpart_reduced_code: string | null;
  historico: string | null;
  debit: number;
  credit: number;
  running_balance: number | null;
  line_no: number;
};

export type TrialBalanceLine = {
  code: string;
  name: string;
  level: number;
  is_analytic: boolean;
  saldo_anterior: number;
  debito: number;
  credito: number;
  saldo_atual: number;
};

type Item = { s: string; x: number; y: number; w: number };
type Line = { y: number; items: Item[]; text: string };
export type PdfPage = { lines: Line[]; items: Item[] };

const NUM = /^-?[\d.]{1,20},\d{2}$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function parseNumber(raw: string): number {
  const clean = raw.replace(/\s+/g, "").replace(/[^\d.,-]/g, "");
  const n = Number(clean.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function signed(raw: string): number {
  const value = parseNumber(raw);
  return /C\s*$/.test(raw.trim()) ? -value : value;
}

function toIso(raw: string): string | null {
  const m = DATE.exec(raw);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Extrai as páginas do PDF já agrupadas em linhas (por coordenada Y). */
export async function extractPdfPages(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const buffer = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: PdfPage[] = [];

  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      const it = raw as { str?: string; width?: number; transform?: number[] };
      const text = (it.str ?? "").trim();
      if (!text) continue;
      items.push({
        s: text,
        x: Math.round(it.transform?.[4] ?? 0),
        y: Math.round(it.transform?.[5] ?? 0),
        w: Math.round(it.width ?? 0),
      });
    }
    pages.push({ items, lines: groupLines(items) });
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  await doc.cleanup();
  return pages;
}

function groupLines(items: Item[]): Line[] {
  const buckets: Item[][] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const last = buckets[buckets.length - 1];
    if (last && Math.abs((last[0]?.y ?? 0) - item.y) <= 2) last.push(item);
    else buckets.push([item]);
  }
  return buckets.map((bucket) => {
    const line = [...bucket].sort((a, b) => a.x - b.x);
    return {
      y: line[0]?.y ?? 0,
      items: line,
      text: line
        .map((i) => i.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    };
  });
}

type Columns = { debito: number; credito: number; saldo: number; anterior?: number | undefined };

function headerColumns(page: PdfPage, withAnterior: boolean): Columns | null {
  const right = (needle: string) => {
    const it = page.items.find((i) => i.s.toUpperCase().startsWith(needle));
    return it ? it.x + it.w : null;
  };
  const debito = right("DÉBITO") ?? right("DEBITO");
  const credito = right("CRÉDITO") ?? right("CREDITO");
  const saldo = right("SALDO ATUAL");
  if (debito == null || credito == null || saldo == null) return null;
  const anterior = withAnterior ? (right("SALDO ANTERIOR") ?? undefined) : undefined;
  return { debito, credito, saldo, anterior };
}

function nearestColumn(rightEdge: number, cols: Columns): keyof Columns {
  const options: [keyof Columns, number][] = [
    ["debito", cols.debito],
    ["credito", cols.credito],
    ["saldo", cols.saldo],
  ];
  if (cols.anterior != null) options.push(["anterior", cols.anterior]);
  let best = options[0]!;
  for (const opt of options) {
    if (Math.abs(rightEdge - opt[1]) < Math.abs(rightEdge - best[1])) best = opt;
  }
  return best[0];
}

/** Une itens numéricos adjacentes (ex.: "1.234,56" + "D"). */
function numericTokens(line: Line, cols: Columns) {
  const out: { value: string; right: number }[] = [];
  for (let i = 0; i < line.items.length; i += 1) {
    const item = line.items[i]!;
    if (!NUM.test(item.s.replace(/\s*[DC]$/, "").trim())) continue;
    let value = item.s;
    let right = item.x + item.w;
    const next = line.items[i + 1];
    if (next && /^[DC]$/.test(next.s) && next.x - right < 12) {
      value = `${value} ${next.s}`;
      right = next.x + next.w;
      i += 1;
    }
    // ignora números que claramente estão no meio do histórico
    if (right < Math.min(cols.debito, cols.anterior ?? cols.debito) - 60) continue;
    out.push({ value, right });
  }
  return out;
}

// ============================ RAZÃO ============================

const CONTA_RE = /^CONTA:\s*([0-9]{3,10})\s*-\s*(.+?)\s*(?:SALDO ANTERIOR:\s*([\d.,]+\s*[DC]?))?$/i;

export function parseRazao(pages: PdfPage[]): { legs: RazaoLeg[]; accounts: number } {
  const legs: RazaoLeg[] = [];
  let cols: Columns | null = null;
  let account: { code: string; name: string } | null = null;
  const openingEmitted = new Set<string>();
  let lineNo = 0;

  for (const page of pages) {
    cols = headerColumns(page, false) ?? cols;
    if (!cols) continue;

    for (const line of page.lines) {
      const text = line.text;
      if (!text || /^PAG\.:|^RELATÓRIO|^DATA MOV\.|^CÓDIGO\s/i.test(text)) continue;

      if (/^CONTA:/i.test(text)) {
        const m = CONTA_RE.exec(text.replace(/\s+/g, " "));
        if (m) {
          account = { code: m[1]!, name: (m[2] ?? "").trim() };
          const opening = m[3] ? signed(m[3]) : 0;
          if (!openingEmitted.has(account.code)) {
            openingEmitted.add(account.code);
            legs.push({
              account_reduced_code: account.code,
              account_name: account.name,
              opening_balance: opening,
              doc_number: null,
              entry_date: null,
              counterpart_reduced_code: null,
              historico: null,
              debit: 0,
              credit: 0,
              running_balance: null,
              line_no: 0,
            });
          }
        }
        continue;
      }

      if (!account) continue;

      const tokens = line.items;
      const first = tokens[0];
      const second = tokens[1];
      const hasDoc = Boolean(first && /^\d{3,10}$/.test(first.s));
      const date = second && DATE.test(second.s) ? toIso(second.s) : null;
      if (!hasDoc || !date) {
        // linha de continuação do histórico
        const prev = legs[legs.length - 1];
        if (prev && prev.doc_number && !NUM.test(tokens[0]?.s ?? "")) {
          prev.historico = `${prev.historico ?? ""} ${text}`.trim().slice(0, 400);
        }
        continue;
      }

      const nums = numericTokens(line, cols);
      let debit = 0;
      let credit = 0;
      let saldo: number | null = null;
      for (const n of nums) {
        const col = nearestColumn(n.right, cols);
        if (col === "debito") debit = parseNumber(n.value);
        else if (col === "credito") credit = parseNumber(n.value);
        else if (col === "saldo") saldo = signed(n.value);
      }
      if (debit === 0 && credit === 0) continue;

      const counterpartItem = tokens[2];
      const counterpart =
        counterpartItem &&
        /^\d{3,10}$/.test(counterpartItem.s) &&
        counterpartItem.x < cols.debito - 100
          ? counterpartItem.s
          : null;

      const historico = tokens
        .slice(counterpart ? 3 : 2)
        .filter((i) => !NUM.test(i.s.replace(/\s*[DC]$/, "")) && !/^[DC]$/.test(i.s))
        .map((i) => i.s)
        .join(" ")
        .trim();

      lineNo += 1;
      legs.push({
        account_reduced_code: account.code,
        account_name: account.name,
        doc_number: first!.s,
        entry_date: date,
        counterpart_reduced_code: counterpart,
        historico: historico ? historico.slice(0, 400) : null,
        debit,
        credit,
        running_balance: saldo,
        line_no: lineNo,
      });
    }
  }

  return { legs, accounts: openingEmitted.size };
}

// ================== RAZÃO EM PLANILHA (relatório G2) ==================
//
// O G2 exporta o "Razão Contábil Analítico" em XLS como um relatório
// paginado convertido em grade — não uma tabela plana. Cada conta aparece em
// um bloco: uma linha "CONTA: <código> - <nome>" com "SALDO ANTERIOR:" ao
// lado, seguida das linhas de lançamento, e cabeçalhos de coluna/página se
// repetem a cada página impressa. O código da conta reduzida NÃO aparece por
// linha de lançamento — só uma vez por bloco — por isso a planilha genérica
// de mapeamento de colunas (razao-mapeamento.ts) não resolve esse layout: é
// preciso reconhecer a estrutura de blocos, igual ao parser de PDF acima.
//
// Reconciliado contra o "Total de Itens" do rodapé do relatório G2 (débito e
// crédito) com margem de poucos centavos em milhares de lançamentos.

const RAZAO_CONTA_RE = /^CONTA:$/i;
const RAZAO_ACCOUNT_RE = /^(\d{3,10})\s*-\s*(.+)$/;
const RAZAO_SALDO_LABEL_RE = /^SALDO ANTERIOR:$/i;
const RAZAO_PLAIN_NUM_RE = /^-?\d+(\.\d+)?$/;
const RAZAO_INT_RE = /^\d{3,10}$/;
const RAZAO_TIMESTAMP_RE = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/;

function razaoCellStr(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function razaoSignedMoney(raw: string): number {
  const clean = raw.trim();
  const isCredit = /C\s*$/i.test(clean);
  const numPart = clean.replace(/[DC]\s*$/i, "").trim();
  const n = Number(numPart.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return isCredit ? -n : n;
}

function razaoDateFromCell(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = DATE.exec(razaoCellStr(v));
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Lê a matriz bruta (linha x coluna) do relatório "Razão Contábil Analítico"
 * do G2 exportado em XLS e devolve as pernas do razão, no mesmo formato de
 * `parseRazao` (PDF). Use `looksLikeG2RazaoReport` (planilha.ts) para decidir
 * quando chamar este parser em vez do mapeamento manual de colunas.
 */
export function parseRazaoSheetMatrix(matrix: unknown[][]): { legs: RazaoLeg[]; accounts: number } {
  const legs: RazaoLeg[] = [];
  let account: { code: string; name: string } | null = null;
  const openingEmitted = new Set<string>();
  let lineNo = 0;
  // Posições de coluna aprendidas do cabeçalho da página (repetem por página).
  let debCol: number | null = null;
  let credCol: number | null = null;

  for (const row of matrix) {
    const cells = row.map(razaoCellStr);
    if (cells.every((c) => c === "")) continue;
    if (cells.some((c) => /^PAG\.:/i.test(c) || /^RELAT[ÓO]RIO/i.test(c) || /^DATA MOV\./i.test(c)))
      continue;
    if (cells.some((c) => RAZAO_TIMESTAMP_RE.test(c))) continue;

    const debHeaderIdx = cells.findIndex((c) => /^D[ÉE]BITO$/i.test(c));
    if (debHeaderIdx >= 0) {
      // offset empírico: o valor da linha cai uma coluna à direita do rótulo do cabeçalho.
      debCol = debHeaderIdx + 1;
      const credHeaderIdx = cells.findIndex((c) => /^CR[ÉE]DITO$/i.test(c));
      credCol = credHeaderIdx >= 0 ? credHeaderIdx : debCol + 1;
      continue;
    }

    const contaIdx = cells.findIndex((c) => RAZAO_CONTA_RE.test(c));
    if (contaIdx >= 0) {
      const raw = cells.slice(contaIdx + 1).find((c) => c !== "") ?? "";
      const m = RAZAO_ACCOUNT_RE.exec(raw);
      if (m) {
        account = { code: m[1]!, name: (m[2] ?? "").trim() };
        const saldoIdx = cells.findIndex((c) => RAZAO_SALDO_LABEL_RE.test(c));
        let opening = 0;
        if (saldoIdx >= 0) {
          const openingRaw = cells.slice(saldoIdx + 1).find((c) => c !== "") ?? "0";
          opening = /,\d{2}\s*[DC]?$/i.test(openingRaw)
            ? razaoSignedMoney(openingRaw)
            : Number(openingRaw.replace(",", ".")) || 0;
        }
        if (!openingEmitted.has(account.code)) {
          openingEmitted.add(account.code);
          legs.push({
            account_reduced_code: account.code,
            account_name: account.name,
            opening_balance: opening,
            doc_number: null,
            entry_date: null,
            counterpart_reduced_code: null,
            historico: null,
            debit: 0,
            credit: 0,
            running_balance: opening,
            line_no: 0,
          });
        }
      }
      continue;
    }

    if (!account || debCol == null) continue;

    const docCandidateIdx = cells.findIndex((c) => RAZAO_INT_RE.test(c));
    const dateIdx = row.findIndex((v) => razaoDateFromCell(v) != null);
    if (docCandidateIdx < 0 || dateIdx < 0) {
      // linha de continuação (complemento de histórico ou subtotal do bloco)
      const prev = legs[legs.length - 1];
      const text = cells
        .filter(
          (c) => c !== "" && !RAZAO_PLAIN_NUM_RE.test(c) && !NUM.test(c.replace(/\s*[DC]$/, "")),
        )
        .join(" ")
        .trim();
      if (prev && prev.doc_number && text) {
        prev.historico = `${prev.historico ?? ""} ${text}`.trim().slice(0, 400);
      }
      continue;
    }

    const docNumber = cells[docCandidateIdx]!;
    const entryDate = razaoDateFromCell(row[dateIdx]);
    const counterpartIdx = cells.findIndex((c, i) => i > dateIdx && RAZAO_INT_RE.test(c));
    const counterpart = counterpartIdx >= 0 ? cells[counterpartIdx]! : null;

    let saldoAtualStr: string | null = null;
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      if (NUM.test(cells[i]!.replace(/\s*[DC]$/, ""))) {
        saldoAtualStr = cells[i]!;
        break;
      }
    }
    const saldoAtual = saldoAtualStr ? razaoSignedMoney(saldoAtualStr) : null;

    // Leitura posicional: o valor "cru" (sem formatação BR) mais próximo da
    // coluna de débito ou crédito aprendida no cabeçalho da página.
    let debit = 0;
    let credit = 0;
    const start = Math.max(dateIdx, counterpartIdx) + 1;
    for (let i = start; i < cells.length; i += 1) {
      const c = cells[i]!;
      if (!RAZAO_PLAIN_NUM_RE.test(c)) continue;
      const distDeb = Math.abs(i - debCol);
      const distCred = Math.abs(i - (credCol ?? debCol + 1));
      if (distDeb <= distCred) debit += Number(c);
      else credit += Number(c);
    }

    const historico = cells
      .slice(start)
      .filter(
        (c) => c !== "" && !RAZAO_PLAIN_NUM_RE.test(c) && !NUM.test(c.replace(/\s*[DC]$/, "")),
      )
      .join(" ")
      .trim()
      .slice(0, 400);

    lineNo += 1;
    legs.push({
      account_reduced_code: account.code,
      account_name: account.name,
      doc_number: docNumber,
      entry_date: entryDate,
      counterpart_reduced_code: counterpart,
      historico: historico || null,
      debit,
      credit,
      running_balance: saldoAtual,
      line_no: lineNo,
    });
  }

  return { legs, accounts: openingEmitted.size };
}

// ========================== BALANCETE ==========================

const CODE_RE = /^\d(?:\.\d{2,5})*$/;

export function parseBalancete(pages: PdfPage[]): TrialBalanceLine[] {
  const rows: TrialBalanceLine[] = [];
  let cols: Columns | null = null;

  for (const page of pages) {
    cols = headerColumns(page, true) ?? cols;
    if (!cols) continue;

    for (const line of page.lines) {
      const first = line.items[0];
      if (!first || !CODE_RE.test(first.s)) continue;
      if (/^PAG\.:/i.test(line.text)) continue;

      const nums = numericTokens(line, cols);
      if (nums.length < 3) continue;

      let anterior = 0;
      let debito = 0;
      let credito = 0;
      let atual = 0;
      for (const n of nums) {
        const col = nearestColumn(n.right, cols);
        if (col === "anterior") anterior = signed(n.value);
        else if (col === "debito") debito = parseNumber(n.value);
        else if (col === "credito") credito = parseNumber(n.value);
        else atual = signed(n.value);
      }

      const name = line.items
        .slice(1)
        .filter((i) => !NUM.test(i.s.replace(/\s*[DC]$/, "")) && !/^[DC]$/.test(i.s))
        .map((i) => i.s)
        .join(" ")
        .trim();
      if (!name) continue;

      rows.push({
        code: first.s,
        name,
        level: first.s.split(".").length,
        is_analytic: false,
        saldo_anterior: anterior,
        debito,
        credito,
        saldo_atual: atual,
      });
    }
  }

  // analítica = nenhuma outra conta pendura abaixo dela
  const codes = rows.map((r) => r.code);
  for (const row of rows) {
    row.is_analytic = !codes.some((c) => c !== row.code && c.startsWith(`${row.code}.`));
  }
  return rows;
}
