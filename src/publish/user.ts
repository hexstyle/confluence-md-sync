import { authHeader, type ConfluenceConfig } from '../client/config.js';
import { escapeXmlAttr } from '../macros/xml.js';
import { decodeEntities, getAttr, parseStorage, serializeStorage, type XElement, type XNode } from '../export/xhtml.js';

/** Confluence stores mentions by key/account ID, even when authored with a login. */
export async function resolveUserMentions(storage: string, cfg: ConfluenceConfig): Promise<string> {
  const nodes = parseStorage(storage), users = new Map<string, XElement[]>();
  const walk = (items: XNode[]) => { for (const node of items) if (node.kind === 'el') {
    const username = node.name === 'ri:user' ? getAttr(node, 'ri:username') : undefined;
    if (username !== undefined) {
      const name = decodeEntities(username), refs = users.get(name) ?? [];
      refs.push(node); users.set(name, refs);
    }
    walk(node.children);
  } };
  walk(nodes);
  if (!users.size) return storage;
  for (const [username, refs] of users) {
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/rest/api/user?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, { headers: { Authorization: authHeader(cfg), Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Confluence user lookup failed (HTTP ${response.status})`);
    const user = await response.json() as { userKey?: string; accountId?: string };
    const type = user.userKey ? 'userkey' : 'account-id', identity = user.userKey || user.accountId;
    if (typeof identity !== 'string' || !identity) throw new Error('Confluence user lookup returned no user key or account ID');
    for (const ref of refs) ref.attrs = ref.attrs.map(([name, value]) => name === 'ri:username' ? [`ri:${type}`, escapeXmlAttr(identity)] : [name, value]);
  }
  return serializeStorage(nodes);
}
