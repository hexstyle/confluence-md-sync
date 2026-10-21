import { decodeEntities, elements, textContent, type XElement, type XNode } from '../export/xhtml.js';

/** Only the known synthetic Page Properties heading may be repaired automatically. */
export function isPropertiesHeading(row: XElement): boolean {
  const cells = elements(row.children);
  const plain = (nodes: XNode[]): boolean => nodes.every(n => n.kind === 'text' || n.kind === 'el'
    && ['p', 'span', 'strong', 'b'].includes(n.name) && plain(n.children));
  return cells.length === 2 && cells.every(c => ['td', 'th'].includes(c.name) && plain(c.children))
    && cells.map(c => decodeEntities(textContent(c.children)).trim()).join('\t') === 'Поле\tЗначение';
}

/** Remove consecutive duplicate headings at the start, never matching rows after data. */
export function normalizePropertiesTable(table: XElement): { table: XElement; removed: number } {
  const rows = elements(table.children).flatMap(n => ['thead', 'tbody'].includes(n.name) ? elements(n.children) : [n]);
  if (!rows.length || rows[0].name !== 'tr' || !isPropertiesHeading(rows[0])) return { table, removed: 0 };
  const duplicates = new Set<XElement>();
  for (const row of rows.slice(1)) {
    if (row.name !== 'tr' || !isPropertiesHeading(row)) break;
    duplicates.add(row);
  }
  const clean = (nodes: XNode[]): XNode[] => {
    const result: XNode[] = [];
    for (const node of nodes) {
      if (node.kind === 'el' && duplicates.has(node)) {
        const previous = result.at(-1);
        if (previous?.kind === 'text' && !previous.raw.trim()) result.pop();
        continue;
      }
      result.push(node.kind === 'el' && ['thead', 'tbody'].includes(node.name) ? { ...node, children: clean(node.children) } : node);
    }
    return result;
  };
  return { table: { ...table, children: clean(table.children) }, removed: duplicates.size };
}
