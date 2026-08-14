/** Utilitários de interpretação tolerante de JSON retornado por modelos de IA. */

/** Remove cercas de markdown e extrai o primeiro objeto/array JSON do texto. */
export function extractJsonText(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  // Remove cercas ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();

  if (!text) return null;

  // Já é JSON válido?
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continua com a extração
  }

  // Extrai o primeiro bloco balanceado começando em { ou [
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Interpreta o retorno da IA, tolerando markdown e texto ao redor do JSON. */
export function parseAiJson<T>(raw: string, context: string): T {
  const candidate = extractJsonText(raw);
  if (candidate === null) {
    throw new Error(
      `${context}: não foi possível interpretar o JSON retornado. Trecho: ${raw
        .trim()
        .slice(0, 200)}`,
    );
  }
  return JSON.parse(candidate) as T;
}
