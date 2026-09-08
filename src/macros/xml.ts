/** XML helpers shared by macro renderers. */

import { createHash } from 'node:crypto';
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

/** Генерирует случайный UUID для ac:macro-id (когда стабильность не нужна). */
export function generateMacroId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Детерминированный macro-id (UUID-формы) от seed — как правило, от исходного
 * содержимого маркера (имя+параметры+тело). ВАЖНО для идемпотентности
 * content-hash: если id генерировать случайно на каждый рендер (см.
 * {@link generateMacroId}), storage у страницы с любым макросом отличается
 * при каждой публикации, даже когда исходный markdown не менялся — hash
 * никогда не совпадает, и publish принудительно обновляет страницу заново
 * при каждом прогоне (замечено на проде: 1 изменённый файл → 250+ страниц
 * «обновились», потому что ~250 из них содержат макрос details/properties).
 * Стабильный id по содержимому убирает этот псевдо-дрейф: одинаковый маркер
 * даёт одинаковый storage → hash совпадает → UNCHANGED.
 */
export function stableMacroId(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf-8').digest('hex');
  const bytes = hex.slice(0, 32);
  return (
    `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-` +
    `${'89ab'[parseInt(bytes[16], 16) % 4]}${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`
  );
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
