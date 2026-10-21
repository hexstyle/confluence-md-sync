import { getAttr, parseStorage, serializeStorage, type XNode } from '../export/xhtml.js';

const isNote = (n: XNode) => n.kind === 'el' && n.name === 'ac:structured-macro' && getAttr(n, 'ac:name') === 'note';
/** Split inline wrappers as well, so a Note never becomes a block inside <p>/<strong>. */
function split(nodes: XNode[]): XNode[][] {
  const result: XNode[][] = [[]];
  for (const n of nodes) {
    if (isNote(n)) { result.push([n], []); continue; }
    if (n.kind !== 'el') { result[result.length - 1].push(n); continue; }
    const inner = split(n.children);
    for (const chunk of inner) {
      if (chunk.length === 1 && isNote(chunk[0])) result.push(chunk, []);
      else if (chunk.length) result[result.length - 1].push({ ...n, children: chunk });
    }
    if (!n.children.length) result[result.length - 1].push(n);
  }
  return result.filter(chunk => chunk.length);
}
export function liftInlineNotes(html: string): string {
  const walk = (nodes: XNode[]): XNode[] => nodes.flatMap(n => {
    if (n.kind !== 'el') return [n];
    const children = walk(n.children);
    if (['td', 'th'].includes(n.name) && children.some(isNote)) {
      const blocks = split(children).flatMap(chunk => chunk.every(n => isNote(n) || (n.kind === 'el' && n.name === 'p')) ? chunk : [{ kind: 'el' as const, name: 'p', attrs: [], children: chunk, selfClosing: false }]);
      return [{ ...n, children: blocks }];
    }
    if (n.name !== 'p') return [{ ...n, children }];
    return split(children).map(chunk => chunk.length === 1 && isNote(chunk[0]) ? chunk[0] : { ...n, children: chunk });
  });
  return serializeStorage(walk(parseStorage(html)));
}
