import { ConfluenceClient } from '../client/client.js';
import type { ConfluenceConfig } from '../client/config.js';
import { getAttr, parseStorage, serializeStorage, type XNode, type XElement } from '../export/xhtml.js';
import { portableJiraStorage } from '../markdown/jira.js';

/** Use the same selected Jira connection as the target Confluence macro dialog. */
export async function resolveJiraMacros(storage: string, cfg: ConfluenceConfig): Promise<string> {
  const nodes = parseStorage(portableJiraStorage(storage)), macros: XElement[] = [];
  const walk = (items: XNode[]) => { for (const node of items) if (node.kind === 'el') {
    if (node.name === 'ac:structured-macro' && getAttr(node, 'ac:name') === 'jira') macros.push(node);
    walk(node.children);
  } };
  walk(nodes);
  if (!macros.length) return storage;
  const servers = await new ConfluenceClient(cfg).getJiraServers();
  const selected = servers.filter(server => server.selected === true);
  const server = selected.length === 1 ? selected[0] : !selected.length && servers.length === 1 ? servers[0] : undefined;
  if (!server) throw new Error('Confluence: no unambiguous default Jira connection. Configure the primary Jira Application Link.');
  for (const macro of macros) for (const [name, value] of [['server', server.name], ['serverId', server.id]]) {
    macro.children.push({ kind: 'el', name: 'ac:parameter', attrs: [['ac:name', name]], selfClosing: false,
      children: [{ kind: 'text', raw: value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }] });
  }
  return serializeStorage(nodes);
}
