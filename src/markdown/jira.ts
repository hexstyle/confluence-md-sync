import { getAttr, parseStorage, serializeStorage, type XNode } from '../export/xhtml.js';

/** Application Link IDs belong to the target Confluence, not to authored Markdown. */
export function portableJiraStorage(storage: string): string {
  let changed = false;
  const walk = (nodes: XNode[]): XNode[] => nodes.map(node => {
    if (node.kind !== 'el') return node;
    let children = node.children;
    if (node.name === 'ac:structured-macro' && getAttr(node, 'ac:name') === 'jira') {
      children = children.filter(child => {
        const runtime = child.kind === 'el' && child.name === 'ac:parameter' && ['server', 'serverId'].includes(getAttr(child, 'ac:name') ?? '');
        if (runtime) changed = true;
        return !runtime;
      });
    }
    return { ...node, children: walk(children) };
  });
  const nodes = walk(parseStorage(storage));
  return changed ? serializeStorage(nodes) : storage;
}
