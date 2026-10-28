import { createHash } from 'node:crypto';
import { attachmentImage } from '../../markdown/image.js';
import { mermaidImageAttrs } from '../../markdown/mermaid.js';

export function mermaidFilename(source: string): string {
  return `mermaid-${createHash('sha256').update(source).digest('hex').slice(0, 24)}.png`;
}

/** Publication uses the native Confluence image tools and needs no Mermaid add-on. */
export function renderMermaidImage(source: string, info = 'mermaid'): string {
  return attachmentImage(mermaidFilename(source), mermaidImageAttrs(info));
}
