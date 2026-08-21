/**
 * «Баннер управляемой страницы»: примечание о том, что страница ведётся во
 * внешнем источнике (docs-studio), а правки в самой Confluence будут
 * перезаписаны. Вставляется в storage при публикации, но НЕ в markdown-
 * источник — round-trip/экспорт его не увидят, git остаётся чистым.
 */

import { structuredMacro } from '../macros/xml.js';
import { escapeXmlAttr } from '../macros/xml.js';

export interface ManagedNoticeOptions {
  /**
   * URL источника (docs-studio / репозиторий постановки), куда ведёт ссылка.
   * Обязателен — без него примечание не имеет смысла.
   */
  linkUrl: string;
  /** Текст ссылки. Default: {@link DEFAULT_MANAGED_NOTICE_LINK_TEXT}. */
  linkText?: string;
  /**
   * Текст примечания. Плейсхолдер `{link}` заменяется ссылкой; если его в
   * тексте нет, ссылка добавляется в конец. Default:
   * {@link DEFAULT_MANAGED_NOTICE_TEXT}.
   */
  text?: string;
  /** Куда вставлять баннер: 'top' (шапка) или 'bottom' (низ). Default: 'top'. */
  position?: 'top' | 'bottom';
  /**
   * Тип панели Confluence (влияет на цвет/иконку). Default: 'info'.
   * 'warning' — красная, самый заметный вариант для «не редактировать».
   */
  panel?: 'info' | 'note' | 'warning' | 'tip';
}

export const DEFAULT_MANAGED_NOTICE_TEXT =
  'Страница синхронизируется автоматически. Вносите правки в источнике ({link}) — ' +
  'ручные изменения на этой странице будут перезаписаны при следующей публикации.';

export const DEFAULT_MANAGED_NOTICE_LINK_TEXT = 'docs-studio';

// Фиксированный ac:macro-id: баннер обязан давать БАЙТ-В-БАЙТ одинаковый
// storage при каждой публикации. Со случайным id (generateMacroId) content-
// hash менялся бы каждый раз → страница вечно считалась бы изменённой.
export const NOTICE_MACRO_ID = '0f0e0d0c-0b0a-4009-8008-000000000001';

/** Собирает `<a href>`-ссылку на источник. */
function noticeLink(opts: ManagedNoticeOptions): string {
  const text = opts.linkText ?? DEFAULT_MANAGED_NOTICE_LINK_TEXT;
  return `<a href="${escapeXmlAttr(opts.linkUrl)}">${escapeXmlAttr(text)}</a>`;
}

/** Строит storage-разметку баннера (одиночный `<ac:structured-macro>`). */
export function buildManagedNotice(opts: ManagedNoticeOptions): string {
  if (!opts.linkUrl) throw new Error('managedNotice: linkUrl is required');
  const panel = opts.panel ?? 'info';
  const link = noticeLink(opts);
  const text = opts.text ?? DEFAULT_MANAGED_NOTICE_TEXT;
  const inner = text.includes('{link}')
    ? text.split('{link}').map(escapeXmlAttr).join(link)
    : `${escapeXmlAttr(text)} ${link}`;
  return structuredMacro(panel, NOTICE_MACRO_ID, { richBody: `<p>${inner}</p>` });
}

/** Дописывает баннер в начало (top) или конец (bottom) storage-контента. */
export function applyManagedNotice(storage: string, opts: ManagedNoticeOptions): string {
  const notice = buildManagedNotice(opts);
  return (opts.position ?? 'top') === 'bottom' ? `${storage}${notice}` : `${notice}${storage}`;
}
