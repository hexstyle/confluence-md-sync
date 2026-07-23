/**
 * Конвертация Confluence storage → Markdown. Два режима:
 *
 * FAITHFUL (default) — гарантия round-trip. Трёхуровневая политика:
 *  1. чистый Markdown — заголовки, абзацы, списки, простые таблицы,
 *     ссылки, картинки-аттачи ({{img:...}}), page-ссылки ({{page:...}});
 *  2. маркеры макросов <!-- MACRO:start/end --> — для макросов, чей
 *     рендер восстанавливает исходный XHTML (проверяется на месте:
 *     маркер прогоняется через render-конвейер и сравнивается канонически);
 *  3. дословный XHTML — «как есть»: без ac:/ri:-тегов — сырым HTML,
 *     с ними — fenced-блоком ```confluence-storage.
 *  Потери исключены по построению; но (3) даёт сырой HTML, который многие
 *  md-редакторы показывают уродливо.
 *
 * READABLE — чистый Markdown ценой оформления. Round-trip НЕ гарантируется:
 *  теряются цвета/стили спанов, div-обёртки, точная геометрия объединённых
 *  ячеек; сохраняется смысловая нагрузка (текст, структура). Сложные
 *  таблицы разворачиваются в GFM (colspan/rowspan → сетка с заполнением,
 *  блочное содержимое ячеек — во flatten через <br>). Сырой HTML-блок не
 *  выдаётся никогда.
 */

import { macro } from '../macros/builder.js';
import { escapeXmlAttr } from '../macros/xml.js';
import { processMacros, type MacroRegistry } from '../macros/registry.js';
import { defaultMacroRegistry } from '../macros/index.js';
import type { MacroParam } from '../macros/types.js';
import { renderToStorage } from '../markdown/render.js';
import { compareStorage } from './canonical.js';
import {
  decodeEntities,
  elements,
  getAttr,
  hasNamespacedElements,
  parseStorage,
  serializeStorage,
  textContent,
  type XElement,
  type XNode,
} from './xhtml.js';

export interface StorageToMarkdownOptions {
  /** Реестр для проверки маркеров макросов (default: встроенный). */
  registry?: MacroRegistry;
  /**
   * 'faithful' (default) — round-trippable, но с сырым HTML в fallback;
   * 'readable' — чистый Markdown ценой оформления, без round-trip.
   */
  mode?: 'faithful' | 'readable';
  /**
   * Как ссылаться на аттачи:
   *  - 'placeholder' (default) — {{img:name}} / {{file:name}} (для publish);
   *  - 'local' — картинки как HTML `<img src="attachments/name">` (с
   *    сохранением размеров), файлы как md-ссылки `[name](attachments/name)`.
   *    Годится для самодостаточного просмотра рядом со скачанными файлами.
   * Включение 'local' подразумевает readable-обработку текста.
   */
  attachments?: 'placeholder' | 'local';
  /**
   * Как выводить таблицы:
   *  - 'auto' (default) — GFM (readable) / round-trip (faithful);
   *  - 'records' — каждую строку разворачивать в запись
   *    «**Заголовок:** значение», записи через `---`. Подразумевает readable.
   */
  tables?: 'auto' | 'records';
  /** Префикс пути к локальным аттачам для attachments:'local'. Default: 'attachments/'. */
  localPrefix?: string;
}

export interface StorageToMarkdownResult {
  markdown: string;
  /** Имена аттачей, на которые ссылаются {{img:...}}. */
  images: string[];
  /** Имена аттачей, на которые ссылаются {{file:...}}. */
  files: string[];
  /** Все имена аттачей, упомянутые где-либо (включая fenced-блоки). */
  attachmentRefs: string[];
  stats: {
    markers: number;
    fenced: number;
    rawHtml: number;
    /** readable-режим: сколько узлов конвертировано с потерей оформления. */
    lossy: number;
  };
}

/** Конвертирует storage-фрагмент страницы в Markdown. */
export function storageToMarkdown(
  storage: string,
  opts: StorageToMarkdownOptions = {},
): StorageToMarkdownResult {
  const local = opts.attachments === 'local';
  const records = opts.tables === 'records';
  // 'local' и 'records' — заведомо не round-trip, поэтому включают readable-
  // обработку текста (сущности, спаны, переносы), даже без mode:'readable'.
  const readable = opts.mode === 'readable' || local || records;
  const conv = new Converter(opts.registry ?? defaultMacroRegistry, {
    readable,
    localFiles: local,
    tablesAsRecords: records,
    localPrefix: opts.localPrefix ?? 'attachments/',
  });
  const markdown = conv.blocksToMd(parseStorage(storage));
  const attachmentRefs = new Set<string>([...conv.images, ...conv.files]);
  for (const m of storage.matchAll(/ri:filename="([^"]*)"/g)) attachmentRefs.add(m[1]);
  return {
    markdown,
    images: [...conv.images],
    files: [...conv.files],
    attachmentRefs: [...attachmentRefs],
    stats: conv.stats,
  };
}

/** Сигнал «в Markdown не выражается» — узел уходит в fallback уровнем выше. */
class Unrepresentable extends Error {}

// Теги, с которых начинается HTML-блок CommonMark (type 6) — абзац,
// начинающийся с такого тега, нельзя отдавать как markdown-строку.
const CM_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'blockquote', 'body', 'br', 'caption',
  'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr',
  'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav',
  'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section', 'summary',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
  'pre', 'script', 'style', 'textarea',
]);

const INLINE_RAW_WRAP = new Set(['span', 'u', 'sub', 'sup', 'small', 'big', 'font', 'del', 'ins', 'abbr', 'cite', 'q', 'mark', 'time']);

// Блочные контейнеры-обёртки: в readable-режиме разворачиваются (их дети
// обрабатываются как блоки), сам тег и его атрибуты отбрасываются.
const UNWRAP_BLOCK = new Set([
  'div', 'section', 'article', 'aside', 'figure', 'figcaption', 'header',
  'footer', 'main', 'nav', 'center', 'details', 'summary',
  'ac:layout', 'ac:layout-section', 'ac:layout-cell',
]);

const SAFE_URL_RE = /^[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+$/;

/** Контекст инлайн-конвертации. */
type InlineCtx = { cell?: boolean; multiline?: boolean };

interface ConverterOpts {
  readable: boolean;
  localFiles: boolean;
  tablesAsRecords: boolean;
  localPrefix: string;
}

class Converter {
  images = new Set<string>();
  files = new Set<string>();
  stats = { markers: 0, fenced: 0, rawHtml: 0, lossy: 0 };

  private readable: boolean;
  private localFiles: boolean;
  private tablesAsRecords: boolean;
  private localPrefix: string;

  constructor(private registry: MacroRegistry, opts: ConverterOpts) {
    this.readable = opts.readable;
    this.localFiles = opts.localFiles;
    this.tablesAsRecords = opts.tablesAsRecords;
    this.localPrefix = opts.localPrefix;
  }

  // ── Блочный уровень ──────────────────────────────────────────────────

  blocksToMd(nodes: XNode[]): string {
    const parts: string[] = [];
    for (const n of nodes) {
      const md = this.blockToMd(n);
      if (md !== '') parts.push(md);
    }
    return parts.join('\n\n') + (parts.length > 0 ? '\n' : '');
  }

  private blockToMd(node: XNode): string {
    if (node.kind === 'text') {
      if (/^[ \t\r\n]*$/.test(node.raw)) return '';
      return this.paragraphMd([node]);
    }
    if (node.kind === 'comment') {
      // Дословный комментарий; MACRO-подобные — через fence, чтобы не
      // конфликтовали с маркерами макросов.
      if (node.text.includes('MACRO:')) return this.fence(`<!--${node.text}-->`);
      return `<!--${node.text}-->`;
    }
    if (node.kind === 'cdata') return this.fence(serializeStorage([node]));

    const el = node;
    const h = /^h([1-6])$/.exec(el.name);
    try {
      if (h && el.attrs.length === 0) {
        // Заголовок однострочен по определению — в readable схлопываем
        // возможные переводы строк (из <br>) в пробел.
        let inline = this.inlineToMd(el.children);
        if (this.readable) inline = inline.replace(/\s*\n\s*/g, ' ');
        if (inline.includes('\n') || inline.trim() === '') throw new Unrepresentable();
        return '#'.repeat(Number(h[1])) + ' ' + guardLineStart(inline.trim());
      }
      if (el.name === 'p' && el.attrs.length === 0) {
        // Редактор оборачивает блочные макросы в <p> — разворачиваем:
        // маркер и так блочный, канонизация считает формы эквивалентными.
        const meaningful = el.children.filter(
          (n) => !(n.kind === 'text' && /^[ \t\r\n]*$/.test(n.raw)),
        );
        if (meaningful.length === 1 && meaningful[0].kind === 'el' && meaningful[0].name === 'ac:structured-macro') {
          return this.macroToMd(meaningful[0]);
        }
        return this.paragraphMd(el.children);
      }
      if (el.name === 'hr') return '---';
      if (el.name === 'ul' || el.name === 'ol') return this.listToMd(el);
      if (el.name === 'table') {
        // tables:'records' — любую таблицу разворачиваем в записи.
        if (this.tablesAsRecords) return this.recordsTable(el);
        // Простую таблицу — в чистый GFM (оба режима). Сложную tableToMd
        // отклоняет: faithful → сырой HTML, readable → readableFallback
        // (lossy++ и разворот в GFM через readableTable).
        return this.tableToMd(el);
      }
      if (el.name === 'ac:structured-macro') return this.macroToMd(el);
      if (el.name === 'ac:image' || el.name === 'ac:link') {
        // Блочная картинка/ссылка — оформляем как отдельный абзац.
        return this.paragraphMd([el]);
      }
    } catch (e) {
      if (!(e instanceof Unrepresentable)) throw e;
      return this.fallbackBlock(el);
    }
    return this.fallbackBlock(el);
  }

  /** Абзац: инлайн-конвертация; не легло — дословный <p>. */
  private paragraphMd(children: XNode[]): string {
    const el: XElement = { kind: 'el', name: 'p', attrs: [], children, selfClosing: false };
    if (children.length === 0) return this.fallbackBlock(el);
    try {
      // multiline: в readable-абзаце <br> становится настоящим переводом
      // строки (см. case 'br'). guardLineStart применяем к КАЖДОЙ строке —
      // после переноса тоже нельзя случайно начать список/заголовок.
      const inline = this.inlineToMd(children, { multiline: true }).trim();
      if (inline === '') return this.fallbackBlock(el);
      // Абзац, начинающийся с блочного HTML-тега, markdown-it превратит в
      // html-блок без <p>-обёртки — такой отдаём дословно.
      const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(inline);
      if (m && CM_BLOCK_TAGS.has(m[1].toLowerCase())) return this.fallbackBlock(el);
      return inline.split('\n').map((line) => guardLineStart(line)).join('\n');
    } catch (e) {
      if (!(e instanceof Unrepresentable)) throw e;
      return this.fallbackBlock(el);
    }
  }

  /**
   * Дословный фрагмент: raw HTML если можно, иначе fence. Перед fence
   * пробуем «поднять» вложенные ac:image/ac:link в плейсхолдеры — тогда
   * блок (обычно сложная таблица с картинками) остаётся читаемым HTML,
   * а рендер вернёт плейсхолдерам исходную ac:-форму.
   */
  private fallbackBlock(el: XElement): string {
    if (this.readable) return this.readableFallback(el);

    const direct = this.tryRawHtml(el);
    if (direct !== null) return direct;

    if (!el.name.includes(':') && CM_BLOCK_TAGS.has(el.name.toLowerCase())) {
      const images = new Set(this.images);
      const files = new Set(this.files);
      try {
        const lifted = this.liftNode(el) as XElement;
        const raw = this.tryRawHtml(lifted);
        if (raw !== null) return raw;
      } catch (e) {
        if (!(e instanceof Unrepresentable)) throw e;
      }
      this.images = images;
      this.files = files;
    }
    return this.fence(serializeStorage([el]));
  }

  private tryRawHtml(el: XElement): string | null {
    const serialized = serializeStorage([el]);
    if (
      !hasNamespacedElements([el]) &&
      !el.name.includes(':') &&
      CM_BLOCK_TAGS.has(el.name.toLowerCase()) &&
      !/\n[ \t]*\n/.test(serialized) &&
      !serialized.includes('MACRO:')
    ) {
      this.stats.rawHtml++;
      return serialized;
    }
    return null;
  }

  /** Заменяет в поддереве ac:image/ac:link на текст-плейсхолдеры. */
  private liftNode(n: XNode): XNode {
    if (n.kind !== 'el') return n;
    if (n.name === 'ac:image') return { kind: 'text', raw: this.acImageToMd(n) };
    if (n.name === 'ac:link') return { kind: 'text', raw: this.acLinkToMd(n) };
    if (n.name.includes(':')) throw new Unrepresentable();
    return { ...n, children: n.children.map((c) => this.liftNode(c)) };
  }

  private fence(content: string): string {
    this.stats.fenced++;
    const runs = content.match(/`+/g) ?? [];
    const ticks = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
    return `${ticks}confluence-storage\n${content}\n${ticks}`;
  }

  // ── Readable-режим: lossy-конвертация в чистый Markdown ────────────────

  /**
   * Fallback readable-режима: НИКОГДА не выдаёт сырой HTML-блок. Таблицы
   * разворачивает в GFM, контейнеры-обёртки — в блоки, blockquote — в `>`,
   * остальное — в инлайн/текст. Content сохраняется, оформление теряется.
   */
  private readableFallback(el: XElement): string {
    this.stats.lossy++;
    const name = el.name.toLowerCase();

    if (el.name === 'table') {
      try {
        return this.readableTable(el);
      } catch (e) {
        if (!(e instanceof Unrepresentable)) throw e;
      }
    }
    if (UNWRAP_BLOCK.has(name)) {
      const inner = this.blocksToMd(el.children).trimEnd();
      if (inner !== '') return inner;
      return '';
    }
    if (name === 'blockquote') {
      const inner = this.blocksToMd(el.children).trimEnd();
      return inner
        .split('\n')
        .map((line) => (line === '' ? '>' : `> ${line}`))
        .join('\n');
    }
    // p / td / th / li / caption и прочие «инлайн-контейнеры» → инлайн.
    // multiline: это свободный поток (не ячейка) — <br> станет переносом.
    const inline = this.inlineToMd(el.children, { multiline: true }).trim();
    if (inline !== '') return inline.split('\n').map((l) => guardLineStart(l)).join('\n');
    // Совсем ничего не вышло — голый текст (может быть пустым).
    return escapeMdText(textContent(el.children), {}, this.readable).trim();
  }

  // ── Макросы ──────────────────────────────────────────────────────────

  private macroToMd(el: XElement): string {
    const name = getAttr(el, 'ac:name') ?? '';
    const markerMd = this.tryMacroMarker(el, name);
    if (markerMd !== null) {
      this.stats.markers++;
      return markerMd;
    }
    if (this.readable) return this.readableMacro(el);
    return this.fence(serializeStorage([el]));
  }

  /**
   * Readable-режим для макроса, который не лёг в маркер: сохраняем
   * содержимое, теряем «обёртку» макроса. rich-text-body → блоки;
   * plain-text-body → код-fence (обычный ``` — чистый Markdown);
   * иначе — заголовок-подпись, чтобы место макроса не исчезло бесследно.
   */
  private readableMacro(el: XElement): string {
    this.stats.lossy++;
    const name = getAttr(el, 'ac:name') ?? 'macro';
    for (const child of elements(el.children)) {
      if (child.name === 'ac:rich-text-body') {
        const inner = this.blocksToMd(child.children).trimEnd();
        if (inner !== '') return inner;
      }
      if (child.name === 'ac:plain-text-body') {
        const text = textContent(child.children);
        if (text.trim() !== '') {
          const ticks = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((r) => r.length + 1)));
          return `${ticks}\n${text}\n${ticks}`;
        }
      }
    }
    // Bodyless-макрос (toc, children, …) — оставляем видимый след.
    return `_[macro: ${name}]_`;
  }

  /**
   * Пытается выразить макрос маркером. Возвращает null, если параметры
   * не однострочны, тело не rich-text или локальная проверка (маркер →
   * рендер → каноническое сравнение с исходником) не сошлась.
   */
  private tryMacroMarker(el: XElement, name: string): string | null {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
    // Вложенный одноимённый макрос ломает парность маркеров.
    if (this.containsMacroNamed(el.children, name)) return null;

    const paramEls: XElement[] = [];
    let richBody: XElement | null = null;
    let plainBody: XElement | null = null;
    for (const child of elements(el.children)) {
      if (child.name === 'ac:parameter') paramEls.push(child);
      else if (child.name === 'ac:rich-text-body') richBody = child;
      else if (child.name === 'ac:plain-text-body') plainBody = child;
      else return null;
    }

    const extract = MACRO_EXTRACTORS[name] ?? genericExtractor;
    const extracted = extract({ el, paramEls, richBody, plainBody });
    if (extracted === null) return null;
    if (extracted.params.some((p) => badParam(p))) return null;

    let bodyMd = extracted.bodyMarkdown;
    if (bodyMd === undefined && richBody !== null) {
      const before = { images: new Set(this.images), files: new Set(this.files) };
      try {
        bodyMd = this.blocksToMd(richBody.children).trimEnd();
      } catch (e) {
        if (!(e instanceof Unrepresentable)) throw e;
        this.images = before.images;
        this.files = before.files;
        return null;
      }
    }

    const builder = macro(name);
    for (const p of extracted.params) builder.param(p.name, p.value);
    builder.body(bodyMd ?? '');
    const markerMd = builder.toMarkdown().toString();

    return this.verifyMacroMarker(el, markerMd) ? markerMd : null;
  }

  /** Маркер → render-конвейер → канонически равен исходному макросу? */
  private verifyMacroMarker(el: XElement, markerMd: string): boolean {
    try {
      let storage = renderToStorage(
        markerMd,
        { images: new Map(), files: new Map() },
        { imageStyle: 'attachment', fileStyle: 'attachment', linkify: false },
      );
      storage = processMacros(storage, this.registry).toString();
      return compareStorage(serializeStorage([el]), storage).equal;
    } catch {
      return false;
    }
  }

  private containsMacroNamed(nodes: XNode[], name: string): boolean {
    for (const n of nodes) {
      if (n.kind !== 'el') continue;
      if (n.name === 'ac:structured-macro' && getAttr(n, 'ac:name') === name) return true;
      if (this.containsMacroNamed(n.children, name)) return true;
    }
    return false;
  }

  // ── Списки ───────────────────────────────────────────────────────────

  private listToMd(list: XElement): string {
    if (list.attrs.some(([k]) => !(list.name === 'ol' && k === 'start'))) {
      throw new Unrepresentable();
    }
    const items = list.children.filter((n) => !(n.kind === 'text' && /^[ \t\r\n]*$/.test(n.raw)));
    if (!items.every((n): n is XElement => n.kind === 'el' && n.name === 'li' && n.attrs.length === 0)) {
      throw new Unrepresentable();
    }
    const lis = items as XElement[];
    if (lis.length === 0) throw new Unrepresentable();

    // tight: содержимое li — инлайн (+ вложенные списки);
    // loose: каждый абзац li обёрнут в <p>. Смешение в md не выражается.
    const shapes = lis.map((li) => liShape(li));
    if (shapes.some((s) => s === 'other')) throw new Unrepresentable();
    if (shapes.some((s) => s !== shapes[0])) throw new Unrepresentable();
    const loose = shapes[0] === 'loose';

    const start = list.name === 'ol' ? Number(getAttr(list, 'start') ?? '1') : 0;
    const lines: string[] = [];
    lis.forEach((li, idx) => {
      const marker = list.name === 'ol' ? `${start + idx}. ` : '- ';
      const indent = ' '.repeat(marker.length);
      const itemLines = this.listItemLines(li, loose);
      lines.push(marker + itemLines[0]);
      for (const line of itemLines.slice(1)) {
        lines.push(line === '' ? '' : indent + line);
      }
      if (loose && idx < lis.length - 1) lines.push('');
    });
    return lines.join('\n');
  }

  private listItemLines(li: XElement, loose: boolean): string[] {
    const lines: string[] = [];
    const parts = li.children.filter((n) => !(n.kind === 'text' && /^[ \t\r\n]*$/.test(n.raw)));
    let inlineRun: XNode[] = [];
    const flushInline = (): void => {
      if (inlineRun.length === 0) return;
      const md = guardLineStart(this.inlineToMd(inlineRun).trim());
      if (md === '') throw new Unrepresentable();
      if (lines.length > 0 && loose) lines.push('');
      lines.push(md);
      inlineRun = [];
    };
    for (const part of parts) {
      if (part.kind === 'el' && (part.name === 'ul' || part.name === 'ol')) {
        flushInline();
        lines.push(...this.listToMd(part).split('\n'));
      } else if (part.kind === 'el' && part.name === 'p' && part.attrs.length === 0) {
        if (!loose) throw new Unrepresentable();
        if (lines.length > 0) lines.push('');
        const md = guardLineStart(this.inlineToMd(part.children).trim());
        if (md === '') throw new Unrepresentable();
        lines.push(md);
      } else if (part.kind === 'el' && CM_BLOCK_TAGS.has(part.name)) {
        throw new Unrepresentable();
      } else {
        if (loose) throw new Unrepresentable();
        inlineRun.push(part);
      }
    }
    flushInline();
    if (lines.length === 0) throw new Unrepresentable();
    return lines;
  }

  // ── Таблицы ──────────────────────────────────────────────────────────

  private tableToMd(table: XElement): string {
    if (table.attrs.length > 0) throw new Unrepresentable();
    const groups = elements(table.children);
    if (table.children.some((n) => n.kind === 'text' && !/^[ \t\r\n]*$/.test(n.raw))) {
      throw new Unrepresentable();
    }
    if (groups.length !== 2 || groups[0].name !== 'thead' || groups[1].name !== 'tbody') {
      throw new Unrepresentable();
    }
    if (groups.some((g) => g.attrs.length > 0)) throw new Unrepresentable();

    const headRows = elements(groups[0].children);
    if (headRows.length !== 1 || headRows[0].name !== 'tr') throw new Unrepresentable();
    const headerCells = elements(headRows[0].children);
    if (!headerCells.every((c) => c.name === 'th')) throw new Unrepresentable();

    const aligns = headerCells.map((c) => cellAlign(c));
    const header = headerCells.map((c) => this.cellMd(c));

    const bodyRows: string[][] = [];
    for (const tr of elements(groups[1].children)) {
      if (tr.name !== 'tr' || tr.attrs.length > 0) throw new Unrepresentable();
      const cells = elements(tr.children);
      if (cells.length !== headerCells.length) throw new Unrepresentable();
      cells.forEach((c, i) => {
        if (c.name !== 'td' || cellAlign(c) !== aligns[i]) throw new Unrepresentable();
      });
      bodyRows.push(cells.map((c) => this.cellMd(c)));
    }

    const sep = aligns.map((a) =>
      a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':---:' : '---',
    );
    const row = (cells: string[]): string => `| ${cells.join(' | ')} |`;
    return [row(header), row(sep), ...bodyRows.map(row)].join('\n');
  }

  private cellMd(cell: XElement): string {
    // Единственный <p> внутри ячейки — разворачиваем (типичная форма).
    let content = cell.children;
    const els = elements(content);
    if (els.length === 1 && els[0].name === 'p' && els[0].attrs.length === 0 &&
        content.every((n) => n.kind !== 'text' || /^[ \t\r\n]*$/.test(n.raw))) {
      content = els[0].children;
    }
    const md = this.inlineToMd(content, { cell: true }).trim();
    if (md.includes('\n')) throw new Unrepresentable();
    // Пайпы экранируем один раз над всей ячейкой — покрывает и текст, и
    // плейсхолдеры {{img:…|…}} (которые минуют инлайн-экранирование).
    return md.replace(/\|/g, '\\|');
  }

  // ── Readable-таблицы: любая таблица → GFM ─────────────────────────────

  /**
   * Строит плотную сетку из произвольной таблицы (colspan/rowspan, блочные
   * ячейки, несколько header-строк). Объединения раскрываются: содержимое —
   * в верхней-левой клетке диапазона, остальные клетки пустые. Содержимое
   * ячейки — flatten-строка БЕЗ экранирования пайпов (его делает вызывающий).
   */
  private buildTableGrid(table: XElement): {
    grid: string[][];
    aligns: Array<'left' | 'right' | 'center' | 'none'>;
    caption: string;
    /** Для каждой строки сетки: были ли все её ячейки <th> (строка-заголовок). */
    headerFlags: boolean[];
  } {
    const trs: XElement[] = [];
    let caption = '';
    for (const child of elements(table.children)) {
      if (child.name === 'caption') caption = this.inlineToMd(child.children).trim();
      else if (['thead', 'tbody', 'tfoot'].includes(child.name)) {
        for (const tr of elements(child.children)) if (tr.name === 'tr') trs.push(tr);
      } else if (child.name === 'tr') trs.push(child);
    }
    if (trs.length === 0) throw new Unrepresentable();

    const grid: string[][] = [];
    const aligns: Array<'left' | 'right' | 'center' | 'none'> = [];
    const headerFlags: boolean[] = [];
    trs.forEach((tr, rowIdx) => {
      if (!grid[rowIdx]) grid[rowIdx] = [];
      const rowCells = elements(tr.children).filter((c) => c.name === 'td' || c.name === 'th');
      headerFlags[rowIdx] = rowCells.length > 0 && rowCells.every((c) => c.name === 'th');
      let col = 0;
      for (const cell of elements(tr.children)) {
        if (cell.name !== 'td' && cell.name !== 'th') continue;
        while (grid[rowIdx][col] !== undefined) col++;
        const colspan = Math.max(1, Number(getAttr(cell, 'colspan') ?? '1') || 1);
        const rowspan = Math.max(1, Number(getAttr(cell, 'rowspan') ?? '1') || 1);
        const content = tidyCell(this.cellFlatten(cell.children));
        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            const rr = rowIdx + r;
            const cc = col + c;
            if (!grid[rr]) grid[rr] = [];
            grid[rr][cc] = r === 0 && c === 0 ? content : '';
          }
        }
        if (rowIdx === 0) {
          const a = readableAlign(cell);
          for (let c = 0; c < colspan; c++) aligns[col + c] = a;
        }
        col += colspan;
      }
    });

    const width = Math.max(...grid.map((r) => r.length));
    if (width === 0) throw new Unrepresentable();
    for (const r of grid) {
      for (let c = 0; c < width; c++) if (r[c] === undefined) r[c] = '';
    }
    while (aligns.length < width) aligns.push('none');
    while (headerFlags.length < grid.length) headerFlags.push(false);
    return { grid, aligns, caption, headerFlags };
  }

  /** Разворачивает любую таблицу в GFM (сетка с заполнением объединений). */
  private readableTable(table: XElement): string {
    const { grid, aligns, caption } = this.buildTableGrid(table);
    const esc = (s: string): string => s.replace(/\|/g, '\\|');
    const sep = aligns.map((a) =>
      a === 'left' ? ':---' : a === 'right' ? '---:' : a === 'center' ? ':---:' : '---',
    );
    const rowMd = (cells: string[]): string => `| ${cells.map(esc).join(' | ')} |`;
    const lines = [rowMd(grid[0]), `| ${sep.join(' | ')} |`, ...grid.slice(1).map(rowMd)];
    const table_ = lines.join('\n');
    return caption !== '' ? `**${caption}**\n\n${table_}` : table_;
  }

  /**
   * tables:'records' — каждую строку тела таблицы разворачивает в запись
   * «**Заголовок:** значение» (пустые ячейки и колонки-филлеры пропускаются),
   * записи разделяются `---`.
   *
   * Заголовок — ПОСЛЕДНЯЯ из ведущих строк, целиком состоящих из <th>
   * (строки-титулы над ней, например «Детали» с colspan, уходят в подпись).
   * Многострочное значение ячейки разворачивается под заголовком: <br> →
   * перенос строки, буллеты «• » → элементы md-списка.
   */
  private recordsTable(table: XElement): string {
    this.stats.lossy++;
    const { grid, caption, headerFlags } = this.buildTableGrid(table);

    // Ведущие строки-заголовки: последняя из них — ключи, предыдущие — титулы.
    let headerCount = 0;
    while (headerCount < grid.length && headerFlags[headerCount]) headerCount++;
    if (headerCount === 0) headerCount = 1; // нет <th>-шапки → первая строка как ключи
    if (headerCount >= grid.length) headerCount = 1; // не съедать всю таблицу
    const header = grid[headerCount - 1];
    const titleCells = grid
      .slice(0, headerCount - 1)
      .flat()
      .map((c) => c.trim())
      .filter((c) => c !== '');
    const title = [caption, ...titleCells].filter((c) => c !== '').join(' — ');

    const records: string[] = [];
    for (const row of grid.slice(headerCount)) {
      const fields: string[] = [];
      row.forEach((val, i) => {
        const key = (header[i] ?? '').trim();
        if (key === '') return;
        // Значение записи — свободный Markdown (не GFM-ячейка): <br> →
        // настоящий перенос, «• » → элементы списка; многострочное значение
        // выносим под заголовок.
        const value = val
          .replace(/<br>/g, '\n')
          .replace(/(^|\n)• /g, '$1- ')
          .trim();
        if (value === '') return;
        fields.push(value.includes('\n') ? `**${key}:**\n${value}` : `**${key}:** ${value}`);
      });
      // Одиночные значения — поля подряд (одна строка на поле); если есть
      // многострочные (списки), разделяем пустой строкой, чтобы md-список не
      // «склеивался» со следующим заголовком.
      if (fields.length > 0) {
        const sep = fields.some((f) => f.includes('\n')) ? '\n\n' : '\n';
        records.push(fields.join(sep));
      }
    }
    if (records.length === 0) throw new Unrepresentable();
    const body = records.join('\n\n---\n\n');
    return title !== '' ? `**${title}**\n\n${body}` : body;
  }

  /**
   * Сплющивает содержимое ячейки в одну строку: абзацы и пункты списков
   * разделяются `<br>` (единственный HTML, идиоматичный для GFM-ячеек),
   * пункты помечаются `• `. Инлайн-разметка (жирный, ссылки, плейсхолдеры)
   * сохраняется.
   */
  private cellFlatten(nodes: XNode[]): string {
    const blocks: string[] = [];
    let inlineRun: XNode[] = [];
    const flush = (): void => {
      if (inlineRun.length === 0) return;
      const s = this.inlineToMd(inlineRun, { cell: true }).replace(/\s+/g, ' ').trim();
      if (s !== '') blocks.push(s);
      inlineRun = [];
    };
    for (const n of nodes) {
      if (n.kind === 'el' && (n.name === 'ul' || n.name === 'ol')) {
        flush();
        blocks.push(this.flattenList(n));
      } else if (n.kind === 'el' && n.name === 'p') {
        flush();
        const s = this.inlineToMd(n.children, { cell: true }).replace(/\s+/g, ' ').trim();
        if (s !== '') blocks.push(s);
      } else if (n.kind === 'el' && (UNWRAP_BLOCK.has(n.name.toLowerCase()) || n.name === 'blockquote')) {
        flush();
        const s = this.cellFlatten(n.children);
        if (s !== '') blocks.push(s);
      } else if (n.kind === 'el' && n.name === 'table') {
        flush();
        const s = this.cellFlatten(collectCellText(n));
        if (s !== '') blocks.push(s);
      } else {
        inlineRun.push(n);
      }
    }
    flush();
    return blocks.filter((b) => b !== '').join('<br>');
  }

  private flattenList(list: XElement): string {
    const items = elements(list.children).filter((li) => li.name === 'li');
    return items
      .map((li) => '• ' + this.cellFlatten(li.children))
      .filter((s) => s !== '• ')
      .join('<br>');
  }

  // ── Инлайн ───────────────────────────────────────────────────────────

  /**
   * Нормализация инлайн-последовательности перед конвертацией:
   * краевые обычные пробелы выносятся из strong/em/s наружу, а смежные
   * одноимённые элементы сливаются — `<strong>a</strong><strong>b</strong>`
   * дало бы `**a****b**`, который markdown уже не распарсит.
   */
  private normalizeInline(nodes: XNode[]): XNode[] {
    const MERGEABLE = new Set(['strong', 'em', 's']);
    const out: XNode[] = [];
    for (const n of nodes) {
      if (!(n.kind === 'el' && MERGEABLE.has(n.name) && n.attrs.length === 0)) {
        out.push(n);
        continue;
      }
      const kids = [...n.children];
      let lead = false;
      let trail = false;
      const first = kids[0];
      if (first !== undefined && first.kind === 'text') {
        const m = /^[ \t]+/.exec(first.raw);
        if (m) {
          lead = true;
          kids[0] = { kind: 'text', raw: first.raw.slice(m[0].length) };
        }
      }
      const last = kids[kids.length - 1];
      if (last !== undefined && last.kind === 'text') {
        const m = /[ \t]+$/.exec(last.raw);
        if (m) {
          trail = true;
          kids[kids.length - 1] = { kind: 'text', raw: last.raw.slice(0, -m[0].length) };
        }
      }
      const cleaned = kids.filter((k) => !(k.kind === 'text' && k.raw === ''));
      if (lead) out.push({ kind: 'text', raw: ' ' });
      if (cleaned.length > 0) {
        const prev = out[out.length - 1];
        if (prev !== undefined && prev.kind === 'el' && prev.name === n.name && prev.attrs.length === 0) {
          prev.children.push(...cleaned);
        } else {
          out.push({ kind: 'el', name: n.name, attrs: [], children: cleaned, selfClosing: false });
        }
      }
      if (trail) out.push({ kind: 'text', raw: ' ' });
    }
    return out;
  }

  private inlineToMd(nodes: XNode[], ctx: InlineCtx = {}): string {
    let out = '';
    for (const n of this.normalizeInline(nodes)) {
      if (n.kind === 'text') {
        out += escapeMdText(n.raw, ctx, this.readable);
        continue;
      }
      if (n.kind === 'cdata') {
        if (this.readable) { out += escapeMdText(n.text, ctx, true); continue; }
        throw new Unrepresentable();
      }
      if (n.kind === 'comment') {
        if (this.readable) continue; // невидимый комментарий — отбрасываем
        if (n.text.includes('MACRO:') || n.text.includes('-->')) throw new Unrepresentable();
        out += `<!--${n.text}-->`;
        continue;
      }
      out += this.inlineElementToMd(n, ctx);
    }
    return out;
  }

  private inlineElementToMd(el: XElement, ctx: InlineCtx): string {
    switch (el.name) {
      case 'strong':
        return this.wrapInline(el, '**', ctx);
      case 'em':
        return this.wrapInline(el, '*', ctx);
      // <b>/<i>: faithful — сырой HTML (** рендерится в <strong>, а не <b>);
      // readable — маппим в **/* (потеря точного тега приемлема).
      case 'b':
        return this.readable ? this.wrapInline(el, '**', ctx) : this.rawInline(el, ctx);
      case 'i':
        return this.readable ? this.wrapInline(el, '*', ctx) : this.rawInline(el, ctx);
      case 's':
        return this.wrapInline(el, '~~', ctx);
      case 'code': {
        if (el.attrs.length > 0 && !this.readable) throw new Unrepresentable();
        const text = textContent(el.children).replace(/\s*\n\s*/g, ' ');
        if (text.trim() === '') return this.readable ? '' : (() => { throw new Unrepresentable(); })();
        const runs = text.match(/`+/g) ?? [];
        const ticks = '`'.repeat(Math.max(1, ...runs.map((r) => r.length + 1)));
        const pad = text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') || text.endsWith(' ') ? ' ' : '';
        return `${ticks}${pad}${text}${pad}${ticks}`;
      }
      case 'br':
        // readable: в свободном потоке (абзац/цитата) — настоящий перенос
        // строки; в ячейке GFM-таблицы перенос невозможен (сломал бы строку
        // таблицы) — там остаётся <br>. faithful — всегда <br/> (round-trip).
        if (this.readable) return ctx.multiline ? '\n' : ctx.cell ? '<br>' : '<br/>';
        return '<br/>';
      case 'a':
        return this.linkAnchorToMd(el, ctx);
      case 'img': {
        const src = getAttr(el, 'src') ?? '';
        const alt = getAttr(el, 'alt') ?? '';
        const other = el.attrs.filter(([k]) => k !== 'src' && k !== 'alt');
        if ((other.length === 0 || this.readable) && SAFE_URL_RE.test(src) && !/[[\]()]/.test(alt)) {
          return `![${alt}](${src})`; // readable: лишние атрибуты (class…) отбрасываются
        }
        return this.readable ? escapeMdText(alt, ctx, true) : this.rawInline(el, ctx);
      }
      case 'ac:image':
        return this.acImageToMd(el);
      case 'ac:link':
        return this.acLinkToMd(el);
      default:
        // readable: любой не-ac инлайн-контейнер (span, u, sub, font, …)
        // разворачиваем — тег и стили теряем, содержимое оставляем.
        if (this.readable && !el.name.includes(':')) return this.inlineToMd(el.children, ctx);
        if (this.readable) return escapeMdText(textContent(el.children), ctx, true);
        if (INLINE_RAW_WRAP.has(el.name)) return this.rawInline(el, ctx);
        throw new Unrepresentable();
    }
  }

  private wrapInline(el: XElement, marker: string, ctx: InlineCtx): string {
    if (el.attrs.length > 0 && !this.readable) return this.rawInline(el, ctx);
    const inner = this.inlineToMd(el.children, ctx);
    // Краевые ПРОСТЫЕ пробелы выносим наружу — `**текст **` маркдауном не
    // является. Юникодные пробелы (&nbsp; и т.п.) выносить нельзя (изменит
    // содержимое), а внутри маркеров они ломают flanking-правила — такой
    // элемент отдаём сырым HTML (faithful) либо просто оставляем как есть
    // без обёртки (readable).
    const m = /^([ \t]*)([\s\S]*?)([ \t]*)$/.exec(inner);
    if (!m || m[2] === '') return inner;
    const decodedEdges = decodeEntities(m[2]);
    if (/^\s|\s$/u.test(decodedEdges)) return this.readable ? inner : this.rawInline(el, ctx);
    return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
  }

  /** Инлайн-элемент дословно: открывающий тег + инлайн-дети + закрывающий. */
  private rawInline(el: XElement, ctx: InlineCtx): string {
    if (hasNamespacedElements([el])) throw new Unrepresentable();
    const attrs = el.attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
    if (attrs.includes('\n')) throw new Unrepresentable();
    if (el.selfClosing) return `<${el.name}${attrs} />`;
    return `<${el.name}${attrs}>${this.inlineToMd(el.children, ctx)}</${el.name}>`;
  }

  private linkAnchorToMd(el: XElement, ctx: InlineCtx): string {
    const href = getAttr(el, 'href') ?? '';
    const inner = this.inlineToMd(el.children, ctx);
    const onlyHref = el.attrs.length === 1 && el.attrs[0][0] === 'href';
    if ((onlyHref || this.readable) && SAFE_URL_RE.test(href) && !/[[\]]/.test(inner)) {
      return `[${inner}](${href})`; // readable: доп. атрибуты ссылки отбрасываются
    }
    if (this.readable) return inner; // ссылку не выразить в MD — оставляем текст
    return this.rawInline(el, ctx);
  }

  private acImageToMd(el: XElement): string {
    const kids = elements(el.children);
    if (kids.length !== 1) throw new Unrepresentable();
    const ref = kids[0];

    // attachments:'local' — картинка как HTML <img> (сохраняет размеры).
    // ri:attachment → локальный путь; ri:url → внешний URL как есть.
    if (this.localFiles && (ref.name === 'ri:attachment' || ref.name === 'ri:url')) {
      let src: string;
      let alt = '';
      if (ref.name === 'ri:attachment') {
        const filename = getAttr(ref, 'ri:filename') ?? '';
        this.images.add(filename);
        src = this.localPrefix + filename;
        alt = filename;
      } else {
        src = getAttr(ref, 'ri:value') ?? '';
      }
      const attrs: Array<[string, string]> = [['src', escapeXmlAttr(src)]];
      for (const [k] of el.attrs) {
        const plain = k.startsWith('ac:') ? k.slice(3) : k;
        if (plain === 'height' || plain === 'width') {
          attrs.push([plain, escapeXmlAttr(getAttr(el, k) ?? '')]);
        }
      }
      attrs.push(['alt', escapeXmlAttr(alt)]);
      return serializeStorage([{ kind: 'el', name: 'img', attrs, children: [], selfClosing: true }]);
    }

    if (ref.name === 'ri:url') {
      if (ref.attrs.some(([k]) => k !== 'ri:value')) throw new Unrepresentable();
      const url = getAttr(ref, 'ri:value') ?? '';
      if (el.attrs.length === 0 && SAFE_URL_RE.test(url)) return `![](${url})`;
      // С атрибутами или сложным URL — сырой <img>: канонизация считает
      // <img src=… class=…> ≡ <ac:image ac:class=…><ri:url ri:value=…/>.
      const attrs: Array<[string, string]> = [['src', escapeXmlAttr(url)]];
      for (const [k] of el.attrs) {
        if (!k.startsWith('ac:')) throw new Unrepresentable();
        const plain = k.slice(3);
        if (plain.includes(':') || plain === 'src') throw new Unrepresentable();
        attrs.push([plain, escapeXmlAttr(getAttr(el, k) ?? '')]);
      }
      return serializeStorage([{ kind: 'el', name: 'img', attrs, children: [], selfClosing: true }]);
    }
    if (ref.name !== 'ri:attachment') throw new Unrepresentable();
    if (!ref.attrs.every(([k]) => k === 'ri:filename' || k === 'ri:version-at-save')) {
      throw new Unrepresentable();
    }
    const filename = getAttr(ref, 'ri:filename') ?? '';
    const attrs: Array<[string, string]> = [];
    for (const [k] of el.attrs) {
      if (!k.startsWith('ac:')) throw new Unrepresentable();
      attrs.push([k.slice(3), getAttr(el, k) ?? '']);
    }
    for (const [, v] of attrs) badPlaceholderPart(v);
    badPlaceholderPart(filename);
    this.images.add(filename);
    const attrStr = attrs.map(([k, v]) => `|${k}=${v}`).join('');
    return `{{img:${filename}${attrStr}}}`;
  }

  private acLinkToMd(el: XElement): string {
    if (el.attrs.length > 0) throw new Unrepresentable();
    const kids = elements(el.children);
    const ref = kids[0];
    if (ref === undefined) throw new Unrepresentable();
    let text: string | undefined;
    if (kids.length === 2) {
      const body = kids[1];
      if (body.name !== 'ac:plain-text-link-body') throw new Unrepresentable();
      text = textContent(body.children);
      badPlaceholderPart(text);
    } else if (kids.length > 2) {
      throw new Unrepresentable();
    }
    const textAttr = text !== undefined ? `|text=${text}` : '';

    if (ref.name === 'ri:page') {
      if (!ref.attrs.every(([k]) => ['ri:content-title', 'ri:space-key', 'ri:version-at-save'].includes(k))) {
        throw new Unrepresentable();
      }
      const title = getAttr(ref, 'ri:content-title') ?? '';
      const space = getAttr(ref, 'ri:space-key');
      badPlaceholderPart(title);
      if (space !== undefined) badPlaceholderPart(space);
      const spaceAttr = space !== undefined ? `|space=${space}` : '';
      return `{{page:${title}${spaceAttr}${textAttr}}}`;
    }
    if (ref.name === 'ri:attachment') {
      if (!ref.attrs.every(([k]) => k === 'ri:filename' || k === 'ri:version-at-save')) {
        throw new Unrepresentable();
      }
      const filename = getAttr(ref, 'ri:filename') ?? '';
      this.files.add(filename);
      // attachments:'local' — md-ссылка на локальный файл вместо {{file:}}.
      if (this.localFiles) {
        const label = (text ?? filename).replace(/[[\]]/g, '\\$&');
        const path = this.localPrefix + filename;
        const target = /[()\s]/.test(path) ? `<${path}>` : path;
        return `[${label}](${target})`;
      }
      badPlaceholderPart(filename);
      return `{{file:${filename}${textAttr}}}`;
    }
    throw new Unrepresentable();
  }
}

// ── Извлечение параметров макросов для маркеров ───────────────────────

interface ExtractContext {
  el: XElement;
  paramEls: XElement[];
  richBody: XElement | null;
  plainBody: XElement | null;
}

interface ExtractedMacro {
  params: MacroParam[];
  /** Готовое markdown-тело (для plain-text-body); rich-тело конвертируется снаружи. */
  bodyMarkdown?: string;
}

type MacroExtractor = (ctx: ExtractContext) => ExtractedMacro | null;

/** Параметр текстовый (без вложенных элементов)? Тогда name/value как есть. */
function textParams(paramEls: XElement[]): MacroParam[] | null {
  const params: MacroParam[] = [];
  for (const p of paramEls) {
    if (elements(p.children).length > 0) return null;
    params.push({ name: getAttr(p, 'ac:name') ?? '', value: textContent(p.children) });
  }
  return params;
}

/** Параметр-`<ac:link><ri:page/></ac:link>` → {page, space}. */
function pageRefParam(p: XElement): { page: string; space?: string } | null {
  const link = elements(p.children);
  if (link.length !== 1 || link[0].name !== 'ac:link' || link[0].attrs.length > 0) return null;
  const refs = elements(link[0].children);
  if (refs.length !== 1 || refs[0].name !== 'ri:page') return null;
  if (!refs[0].attrs.every(([k]) => ['ri:content-title', 'ri:space-key', 'ri:version-at-save'].includes(k))) return null;
  const page = getAttr(refs[0], 'ri:content-title') ?? '';
  const space = getAttr(refs[0], 'ri:space-key');
  return space !== undefined ? { page, space } : { page };
}

const genericExtractor: MacroExtractor = (ctx) => {
  if (ctx.plainBody !== null) return null;
  const params = textParams(ctx.paramEls);
  if (params === null) return null;
  return { params };
};

const MACRO_EXTRACTORS: Record<string, MacroExtractor> = {
  code: (ctx) => {
    if (ctx.richBody !== null || ctx.plainBody === null) return null;
    const params = textParams(ctx.paramEls);
    if (params === null) return null;
    const source = textContent(ctx.plainBody.children);
    const runs = source.match(/`+/g) ?? [];
    const ticks = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
    return { params, bodyMarkdown: `${ticks}\n${source}\n${ticks}` };
  },
  anchor: (ctx) => {
    if (ctx.richBody !== null || ctx.plainBody !== null || ctx.paramEls.length !== 1) return null;
    const p = ctx.paramEls[0];
    if (getAttr(p, 'ac:name') !== '' || elements(p.children).length > 0) return null;
    return { params: [{ name: 'name', value: textContent(p.children) }] };
  },
  include: (ctx) => {
    if (ctx.richBody !== null || ctx.plainBody !== null || ctx.paramEls.length !== 1) return null;
    const p = ctx.paramEls[0];
    if (getAttr(p, 'ac:name') !== '') return null;
    const ref = pageRefParam(p);
    if (ref === null) return null;
    const params: MacroParam[] = [{ name: 'page', value: ref.page }];
    if (ref.space !== undefined) params.push({ name: 'space', value: ref.space });
    return { params };
  },
  'excerpt-include': (ctx) => {
    if (ctx.richBody !== null || ctx.plainBody !== null) return null;
    const params: MacroParam[] = [];
    for (const p of ctx.paramEls) {
      const name = getAttr(p, 'ac:name') ?? '';
      if (name === '') {
        const ref = pageRefParam(p);
        if (ref === null) return null;
        params.push({ name: 'page', value: ref.page });
        if (ref.space !== undefined) params.push({ name: 'space', value: ref.space });
      } else if (elements(p.children).length === 0) {
        params.push({ name, value: textContent(p.children) });
      } else {
        return null;
      }
    }
    return { params };
  },
  'table-excerpt-include': (ctx) => {
    if (ctx.richBody !== null || ctx.plainBody !== null) return null;
    const params: MacroParam[] = [];
    for (const p of ctx.paramEls) {
      const name = getAttr(p, 'ac:name') ?? '';
      if (name === 'page') {
        const ref = pageRefParam(p);
        if (ref === null) return null;
        params.push({ name: 'page', value: ref.page });
        if (ref.space !== undefined) params.push({ name: 'space', value: ref.space });
      } else if (elements(p.children).length === 0) {
        params.push({ name, value: textContent(p.children) });
      } else {
        return null;
      }
    }
    return { params };
  },
};

/** Форма пункта списка: инлайн-содержимое (tight) или <p>-абзацы (loose). */
function liShape(li: XElement): 'tight' | 'loose' | 'other' {
  let hasP = false;
  let hasInline = false;
  for (const n of li.children) {
    if (n.kind === 'text') {
      if (!/^[ \t\r\n]*$/.test(n.raw)) hasInline = true;
      continue;
    }
    if (n.kind === 'el' && n.name === 'p') hasP = true;
    else if (n.kind === 'el' && (n.name === 'ul' || n.name === 'ol')) continue;
    else hasInline = true;
  }
  if (hasP && hasInline) return 'other';
  return hasP ? 'loose' : 'tight';
}

function badParam(p: MacroParam): boolean {
  // %-последовательности исходника декодер маркера исказил бы.
  return /%(3D|3A|3C|3E|0A|0D|25)/i.test(p.name + p.value);
}

function badPlaceholderPart(value: string): void {
  if (/[|{}\n\r]/.test(value)) throw new Unrepresentable();
}

// ── Экранирование текста ──────────────────────────────────────────────

const ENTITY_RE = /&(?:#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Экранирует markdown-активные символы, сохраняя сущности (&nbsp; и т.п.)
 * как есть — markdown-it декодирует их при рендере.
 */
function escapeMdText(raw: string, ctx: InlineCtx, readable = false): string {
  const collapsed = raw.replace(/[\r\n]+/g, ' ');
  let out = '';
  let last = 0;
  for (const m of collapsed.matchAll(ENTITY_RE)) {
    out += escapePlain(collapsed.slice(last, m.index), ctx, readable);
    if (readable) {
      // readable: декодируем сущность в символ (&quot;→", &mdash;→—, nbsp→
      // пробел). `<`, `>`, `&` оставляем сущностями — их «живой» символ
      // мог бы создать случайный HTML/сущность. Нераспознанное — как есть.
      const dec = decodeEntities(m[0]);
      out += dec === m[0] || dec === '<' || dec === '>' || dec === '&'
        ? m[0]
        : escapePlain(dec, ctx, readable);
    } else {
      out += m[0];
    }
    last = m.index + m[0].length;
  }
  out += escapePlain(collapsed.slice(last), ctx, readable);
  return out;
}

function escapePlain(s: string, _ctx: InlineCtx, readable = false): string {
  const esc = s.replace(/[\\`*_[\]{}~]/g, (c) => '\\' + c);
  // Пайпы здесь НЕ трогаем — они экранируются один раз на границе ячейки
  // (cellMd / readableTable), иначе плейсхолдеры {{img:…|…}} двоились бы.
  // readable: неразрывный пробел → обычный; faithful: → entity (переживает
  // trim() markdown-it на краю абзаца).
  return esc.replace(/\u00A0/g, readable ? ' ' : '&nbsp;');
}

/** Экранирует конструкции, значимые в начале строки (#, >, -, 1. …). */
function guardLineStart(md: string): string {
  return md.replace(/^(\s*)([#>+-]|\d+[.)])(\s|$)/, (_m, ws: string, ch: string, sp: string) => {
    if (ch.length === 1) return `${ws}\\${ch}${sp}`;
    return `${ws}${ch.slice(0, -1)}\\${ch.slice(-1)}${sp}`;
  });
}

function cellAlign(cell: XElement): 'left' | 'right' | 'center' | 'none' {
  if (cell.attrs.length === 0) return 'none';
  if (cell.attrs.length > 1) throw new Unrepresentable();
  const [k, v] = cell.attrs[0];
  if (k !== 'style') throw new Unrepresentable();
  const m = /^text-align:\s*(left|right|center);?\s*$/.exec(v);
  if (!m) throw new Unrepresentable();
  return m[1] as 'left' | 'right' | 'center';
}

/** Как cellAlign, но не бросает: любой нераспознанный стиль → 'none'. */
function readableAlign(cell: XElement): 'left' | 'right' | 'center' | 'none' {
  const style = getAttr(cell, 'style');
  const m = style ? /text-align:\s*(left|right|center)/.exec(style) : null;
  return m ? (m[1] as 'left' | 'right' | 'center') : 'none';
}

/**
 * Причёсывает содержимое GFM-ячейки: нормализует `<br/>`→`<br>`, схлопывает
 * подряд идущие переводы строк и срезает их по краям — чтобы «пустая»
 * ячейка (в исходнике `<p><br/></p>`) стала действительно пустой.
 */
function tidyCell(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/(?:\s*<br>\s*)+/g, '<br>')
    .replace(/^<br>|<br>$/g, '')
    .trim();
}

/** Разворачивает вложенную в ячейку таблицу в плоский список её ячеек. */
function collectCellText(table: XElement): XNode[] {
  const out: XNode[] = [];
  const walk = (nodes: XNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'el' && (n.name === 'td' || n.name === 'th')) {
        out.push({ kind: 'el', name: 'p', attrs: [], children: n.children, selfClosing: false });
      } else if (n.kind === 'el') {
        walk(n.children);
      }
    }
  };
  walk(table.children);
  return out;
}
