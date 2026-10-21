export interface PlaceholderRef { name: string; attrs: Array<[string, string]> }
export const PLACEHOLDER_RE = /\{\{(img|file|page):((?:"(?:\\.|[^"\\])*"|[^{}"]|\{[^{])*?)\}\}/g;
const unquote = (value: string) => {
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { /* Legacy values remain literal. */ }
  }
  return value;
};
export const quotePlaceholder = (value: string) => /[|{}"\\\r\n]/.test(value) ? JSON.stringify(value) : value;
export function parsePlaceholder(body: string): PlaceholderRef {
  const parts = body.match(/(?:"(?:\\.|[^"\\])*"|[^|"])+/g) ?? [];
  const name = unquote((parts.shift() ?? '').trim());
  const attrs: Array<[string, string]> = parts.map(part => {
    const eq = part.indexOf('=');
    return eq < 0 ? [part.trim(), ''] : [part.slice(0, eq).trim(), unquote(part.slice(eq + 1).trim())];
  });
  return { name, attrs };
}
export function placeholder(kind: string, name: string, attrs: Array<[string, string]> = []) {
  return `{{${kind}:${quotePlaceholder(name)}${attrs.map(([key, value]) => `|${key}=${quotePlaceholder(value)}`).join('')}}}`;
}
