/** XML helpers shared by macro renderers. */

import type { MacroParam } from './types.js';

/** Экранирует строку для XML-атрибутов и текстовых узлов. */
export function escapeXmlAttr(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

/** Генерирует UUID для ac:macro-id. */
export function generateMacroId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface StructuredMacroOptions {
  /**
   * Macro parameters. `undefined` values are skipped. A key rendered as
   * empty string (`''`) produces `<ac:parameter ac:name="">` — some
   * built-in macros (anchor, include) use the unnamed parameter.
   * Values are escaped unless wrapped in {@link rawValue}.
   */
  params?: Array<MacroParam & { raw?: boolean }>;
  /** Rich text body (already-rendered XHTML). */
  richBody?: string;
  /** Plain text body — wrapped in CDATA (for `code`, `noformat`, etc.). */
  plainBody?: string;
}

/**
 * Assembles an `<ac:structured-macro>` element. Takes care of parameter
 * escaping, rich vs plain bodies and CDATA safety.
 */
export function structuredMacro(
  name: string,
  macroId: string,
  opts: StructuredMacroOptions = {},
): string {
  const params = (opts.params ?? [])
    .map((p) => {
      const value = p.raw ? p.value : escapeXmlAttr(p.value);
      return `<ac:parameter ac:name="${escapeXmlAttr(p.name)}">${value}</ac:parameter>`;
    })
    .join('');
  let body = '';
  if (opts.plainBody !== undefined) {
    // `]]>` внутри CDATA недопустим — разрезаем на соседние CDATA-секции.
    const safe = opts.plainBody.replace(/\]\]>/g, ']]]]><![CDATA[>');
    body = `<ac:plain-text-body><![CDATA[${safe}]]></ac:plain-text-body>`;
  } else if (opts.richBody !== undefined) {
    body = `<ac:rich-text-body>${opts.richBody}</ac:rich-text-body>`;
  }
  return (
    `<ac:structured-macro ac:name="${escapeXmlAttr(name)}" ac:schema-version="1" ac:macro-id="${escapeXmlAttr(macroId)}">` +
    params +
    body +
    `</ac:structured-macro>`
  );
}

/** Builds an `<ac:link><ri:page .../></ac:link>` value for page-reference params. */
export function pageLinkValue(title: string, spaceKey?: string): string {
  const space = spaceKey ? ` ri:space-key="${escapeXmlAttr(spaceKey)}"` : '';
  return `<ac:link><ri:page ri:content-title="${escapeXmlAttr(title)}"${space}/></ac:link>`;
}
