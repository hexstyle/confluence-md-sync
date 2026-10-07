import MarkdownIt from 'markdown-it';
import { parsePlaceholder } from './render.js';

export interface DrawioReference { name: string; preview: string; format: 'macro' | 'image'; revision?: string; pageId?: string }

export function drawioAttachmentNames(attachments: { title: string; extensions?: { mediaType?: string } }[]): string[] {
  return attachments.filter(a => a.extensions?.mediaType === 'application/vnd.jgraph.mxfile' || /\.drawio$/i.test(a.title)).map(a => a.title);
}

/** Skip code examples; ordinary and table-cell references remain attachments. */
export function drawioReferences(markdown: string): DrawioReference[] {
  const refs: DrawioReference[] = [];
  const tokens = new MarkdownIt().parse(markdown, {});
  for (const token of tokens) for (const child of token.children ?? []) {
    if (child.type !== 'text') continue;
    for (const match of child.content.matchAll(/\{\{drawio:([^}]+)\}\}/g)) {
      const { name, attrs } = parsePlaceholder(match[1]);
      const opts = Object.fromEntries(attrs);
      if (!name || /[/\\]/.test(name) || name === '.' || name === '..') throw new Error('drawio: invalid attachment filename');
      if (opts.format && !['macro', 'image'].includes(opts.format)) throw new Error('drawio: format must be macro or image');
      const preview = opts.preview || `${name}.png`;
      if (/[/\\]/.test(preview) || preview === '.' || preview === '..') throw new Error('drawio: invalid preview filename');
      refs.push({ name, preview, format: opts.format === 'image' ? 'image' : 'macro', revision: opts.revision, pageId: opts.pageId });
    }
  }
  return refs;
}
