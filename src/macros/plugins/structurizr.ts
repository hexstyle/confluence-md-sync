import { macro } from '../builder.js';
import { paramMap, type MacroPlugin } from '../types.js';
import { escapeXmlAttr } from '../xml.js';

export function structurizrPreview(name: string, view: string): string {
  if (typeof name !== 'string' || !/\.dsl$/i.test(name) || /[/\\{}|]/.test(name) || !view || view.length > 120 || /[{}|\n\r]/.test(view)) throw new Error('structurizr: a .dsl attachment and view key are required');
  return `${name}.${Array.from(new TextEncoder().encode(view), b => b.toString(16).padStart(2, '0')).join('')}.png`;
}

/** Confluence needs no third-party plugin: the view is a PNG, sources remain attachments. */
export const structurizrPlugin: MacroPlugin = {
  name: 'structurizr',
  macros: [{ name: 'structurizr', render(ctx) {
    const { name, view } = paramMap(ctx.params);
    return `<ac:image ac:alt="${escapeXmlAttr(`Structurizr · ${view}`)}"><ri:attachment ri:filename="${escapeXmlAttr(structurizrPreview(name, view))}" /></ac:image>`;
  } }],
};
export const structurizr = (name: string, view: string) => macro('structurizr').param('name', name).param('view', view).toMarkdown();
