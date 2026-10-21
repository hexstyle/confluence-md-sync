import { parsePlaceholder, quotePlaceholder } from './placeholder.js';

/** Plain body is Markdown; quoted body permits parameters and a single-line table cell. */
export function parseInlineNote(body: string): { text: string; attrs: [string, string][] } {
  if (body.startsWith('"')) {
    const ref = parsePlaceholder(body);
    return { text: ref.name, attrs: ref.attrs };
  }
  let text = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === 'n') { text += '\n'; i++; }
    else if (body[i] === '\\' && body[i + 1] === '\\') { text += '\\\\'; i++; }
    else text += body[i];
  }
  return { text, attrs: [] };
}
export function inlineNote(text: string, attrs: [string, string][] = []): string {
  // JSON quotes avoid confusing nested macro pipes with Note parameters.
  return `{{note:${JSON.stringify(text)}${attrs.map(([key, value]) => `|${key}=${quotePlaceholder(value)}`).join('')}}}`;
}
