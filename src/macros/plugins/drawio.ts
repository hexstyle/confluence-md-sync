import { macro } from '../builder.js';
import { paramMap, type MacroPlugin } from '../types.js';
import { escapeXmlAttr, structuredMacro } from '../xml.js';

/** XML keeps its attachment name, including extensionless Confluence diagrams. */
export const drawioPlugin: MacroPlugin = {
  name: 'drawio',
  macros: [{ name: 'drawio', render(ctx) {
    const params = paramMap(ctx.params);
    const name = params.diagramName;
    if (!name) throw new Error('drawio: diagramName is required');
    if (params.format === 'image') {
      return `<ac:image><ri:attachment ri:filename="${escapeXmlAttr(params.preview || `${name}.png`)}" /></ac:image>`;
    }
    if (params.format && params.format !== 'macro') throw new Error('drawio: format must be macro or image');
    return structuredMacro('drawio', ctx.macroId, { params: ctx.params.filter(p => p.name !== 'format' && p.name !== 'preview').sort((a, b) => a.name.localeCompare(b.name)) });
  } }],
};

export const drawio = (name: string, opts: Record<string, string | undefined> = {}) =>
  macro('drawio').param('diagramName', name).withParams(opts).toMarkdown();

/** Published attachments belong to the target page and use its latest version. */
export function unpinDrawioStorage(storage: string): string {
  return storage.replace(/<ac:structured-macro\b[^>]*ac:name="drawio"[^>]*>[\s\S]*?<\/ac:structured-macro>/g,
    block => block.replace(/<ac:parameter ac:name="(?:revision|pageId)">[\s\S]*?<\/ac:parameter>/g, ''));
}
