export interface InlineSyntax { id: string; body: string; raw: string; from: number; to: number }

/** Balanced braces, quoted parameters and escaped delimiters. */
export function readInlineSyntax(source: string, from: number): InlineSyntax | null {
  const head = /^\{\{([a-z][a-z0-9-]*)(:|\}\})/.exec(source.slice(from));
  if (!head) return null;
  if (head[2] === '}}') return { id: head[1], body: '', raw: head[0], from, to: from + head[0].length };
  const start = from + head[0].length;
  let depth = 1, quoted = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (source.slice(i, i + 2) === '{{') { depth++; i++; }
    else if (source.slice(i, i + 2) === '}}') {
      if (--depth === 0) return { id: head[1], body: source.slice(start, i), raw: source.slice(from, i + 2), from, to: i + 2 };
      i++;
    }
  }
  return null;
}

/** Visit authored macros, excluding fenced and inline code. */
export function replaceInlineSyntax(source: string, replace: (macro: InlineSyntax) => string | undefined): string {
  let out = '', pos = 0;
  while (pos < source.length) {
    if (pos === 0 || source[pos - 1] === '\n') {
      const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(pos));
      if (fence) {
        const end = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*(?:\\n|$)`, 'm');
        const rest = source.slice(pos + fence[0].length), close = end.exec(rest);
        const to = close ? pos + fence[0].length + close.index + close[0].length : source.length;
        out += source.slice(pos, to); pos = to; continue;
      }
    }
    if (source[pos] === '\\') { out += source.slice(pos, pos + 2); pos += 2; continue; }
    if (source[pos] === '`') {
      const run = /^`+/.exec(source.slice(pos))![0], end = source.indexOf(run, pos + run.length);
      if (end >= 0) { out += source.slice(pos, end + run.length); pos = end + run.length; continue; }
    }
    const macro = source.slice(pos, pos + 2) === '{{' ? readInlineSyntax(source, pos) : null;
    if (macro) {
      out += replace(macro) ?? macro.raw; pos = macro.to; continue;
    }
    out += source[pos++];
  }
  return out;
}

/** Remove the one GFM escaping layer; keep JSON-encoded backslashes intact. */
export const unescapeTablePipes = (raw: string) => raw.replace(/(\\+)\|/g, (_match, slash: string) => (slash.length % 2 ? slash.slice(1) : slash) + '|');
