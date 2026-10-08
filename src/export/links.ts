import { escapeXmlAttr } from '../macros/xml.js';
import { elements, getAttr, parseStorage, serializeStorage, textContent, type XElement, type XNode } from './xhtml.js';

export interface StorageLink { href?: string; pageId?: string; title?: string; space?: string; anchor?: string }
export type StorageLinkResolver = (link: StorageLink) => string | null | undefined;

function visit(nodes: XNode[], fn: (el: XElement, link: StorageLink) => void) {
  for (const el of nodes) {
    if (el.kind !== 'el' || ['code', 'pre', 'ac:parameter', 'ac:plain-text-body'].includes(el.name)) continue;
    if (el.name === 'a' && getAttr(el, 'href')) fn(el, { href: getAttr(el, 'href') });
    else if (el.name === 'ac:link') {
      const page = elements(el.children).find(c => c.name === 'ri:page');
      if (page) fn(el, { pageId: getAttr(page, 'ri:content-id'), title: getAttr(page, 'ri:content-title'), space: getAttr(page, 'ri:space-key'), anchor: getAttr(el, 'ac:anchor') });
    }
    visit(el.children, fn);
  }
}

/** Collect targets before a batch determines their final file paths. */
export function storageLinks(storage: string): StorageLink[] {
  const result: StorageLink[] = [];
  visit(parseStorage(storage), (_el, link) => result.push(link));
  return result;
}

/** Rewrite links only after the caller has prepared every destination. */
export function rewriteStorageLinks(storage: string, resolver: StorageLinkResolver): string {
  const nodes = parseStorage(storage);
  let changed = false;
  visit(nodes, (el, link) => {
    const href = resolver(link);
    if (!href || href === link.href) return;
    if (el.name === 'ac:link') {
      const body = elements(el.children).find(c => c.name === 'ac:link-body' || c.name === 'ac:plain-text-link-body');
      el.children = body?.name === 'ac:link-body' ? body.children : [{ kind: 'text', raw: escapeXmlAttr(body ? textContent(body.children) : link.title ?? href) }];
      el.name = 'a'; el.attrs = []; el.selfClosing = false;
    }
    el.attrs = [...el.attrs.filter(([key]) => key !== 'href'), ['href', escapeXmlAttr(href)]];
    changed = true;
  });
  return changed ? serializeStorage(nodes) : storage;
}
