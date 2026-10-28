/** Fences are the source of truth; the layout annotation stays inside the source. */
export function mermaidFence(source: string, info = 'mermaid'): string {
  const runs = source.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}${info}\n${source.replace(/\n$/, '')}\n${fence}`;
}

export interface MermaidSource { source: string; info: string }
export const MERMAID_PROPERTY_KEY = 'confluence-md-sync-mermaid';

export function mermaidImageAttrs(info: string): Array<[string, string]> {
  const attrs = new Map<string, string>([['alt', 'Mermaid'], ['style', 'max-width:100%;height:auto']]);
  for (const match of info.replace(/^mermaid\b/i, '').matchAll(/([\w-]+)=("(?:\\.|[^"\\])*"|\S+)/g)) {
    let value = match[2];
    if (value.startsWith('"')) value = JSON.parse(value) as string;
    attrs.set(match[1], value);
  }
  return [...attrs];
}
