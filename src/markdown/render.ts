import MarkdownIt from 'markdown-it';
import { nativeToMarkers, NATIVE_PLACEHOLDERS } from './native.js';
import { parsePlaceholder, placeholder } from './placeholder.js';
import { attachmentImage } from './image.js';
import { replaceInlineSyntax, unescapeTablePipes } from './inline-syntax.js';
import { parseInlineNote } from './note.js';
import { renderInlineNote } from '../macros/plugins/note.js';
import { liftInlineNotes } from './note-layout.js';
export { PLACEHOLDER_RE, parsePlaceholder, type PlaceholderRef } from './placeholder.js';

// xhtmlOut: true — Confluence storage format = XHTML, void-элементы
// (<hr/>, <br/>, <img/>) обязаны быть самозакрывающимися.
// html: true — разрешить HTML (нужно для <!-- MACRO:... --> комментариев)
const mdOptions = {
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
  xhtmlOut: true,
};
const md = new MarkdownIt(mdOptions);
// Вариант без linkify: голые URL в тексте остаются текстом. Используется
// для страниц из exportPage — иначе round-trip превращал бы нессылочные
// упоминания URL в <a>.
const mdNoLinkify = new MarkdownIt({ ...mdOptions, linkify: false });

/**
 * Плейсхолдеры: `{{img:name}}`, `{{file:name}}`, `{{page:Title}}`.
 * После имени допустимы `|key=value`-атрибуты:
 *   {{img:chart.png|thumbnail=true|height=250}}
 *   {{page:Другая страница|space=DOCS|text=якорный текст}}
 */
export interface ExtractedPlaceholders {
  images: string[];
  files: string[];
  pages: string[];
}

export function extractPlaceholders(markdown: string): ExtractedPlaceholders {
  const images = new Set<string>();
  const files = new Set<string>();
  const pages = new Set<string>();
  const collect = (source: string) => replaceInlineSyntax(source, ref => {
    if (ref.id === 'note') collect(parseInlineNote(ref.body).text);
    else if (['img', 'file', 'page'].includes(ref.id)) {
      const { name } = parsePlaceholder(ref.body);
      (ref.id === 'img' ? images : ref.id === 'file' ? files : pages).add(name);
    }
    return undefined;
  });
  collect(markdown);
  return { images: [...images], files: [...files], pages: [...pages] };
}

function escapeXmlAttr(s: string): string {
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

/**
 * Переименовывает `{{img:...}}`-плейсхолдеры по карте старое→новое имя.
 * Используется BPMN-конвейером: автор пишет `{{img:p1.bpmn}}`, публикация
 * подменяет на `{{img:p1.png}}` после конвертации диаграммы.
 */
export function renameImagePlaceholders(markdown: string, renames: Map<string, string>): string {
  if (renames.size === 0) return markdown;
  return replaceInlineSyntax(markdown, ref => {
    if (ref.id !== 'img') return;
    const full = ref.raw;
    const { name, attrs } = parsePlaceholder(ref.body);
    const renamed = renames.get(name);
    if (!renamed) return full;
    return placeholder('img', renamed, attrs);
  });
}

export interface AttachmentUrls {
  /** filename → абсолютный URL аттача, полученный из Confluence после аплоада. */
  images: Map<string, string>;
  files: Map<string, string>;
}

export interface RenderStorageOptions {
  /**
   * Как рендерить `{{img:...}}` / `{{file:...}}`:
   *  - 'url' (default) — `<img src=…>` / `<a href=…>` с download-URL аттача;
   *  - 'attachment' — нативные `<ac:image><ri:attachment/>` /
   *    `<ac:link><ri:attachment/>` (ссылка по имени файла, URL не нужен).
   *    Используется exportPage/round-trip: форма совпадает с тем, что
   *    пишет сам Confluence.
   */
  imageStyle?: 'url' | 'attachment';
  fileStyle?: 'url' | 'attachment';
  /** Автопревращение голых URL в ссылки (default: true). */
  linkify?: boolean;
  /**
   * Резолвер относительных ссылок на другие md-файлы набора. Для каждой
   * markdown-ссылки `[text](href)` вызывается с исходным href; если вернул
   * цель — ссылка публикуется как Confluence page-link (`<ac:link><ri:page>`)
   * на страницу связанного md (карту file→page строит вызывающий, напр.
   * docs-studio из манифеста). `null`/`undefined` — ссылка остаётся как есть
   * (обычная `<a href>`), пригодна для внешних URL и якорей.
   */
  linkResolver?: (href: string) => { title: string; space?: string } | { url: string } | null;
  /** Local Markdown assets: attachment on this page, or a canonical repository URL. */
  resourceResolver?: (href: string) => { attachment: string } | { url: string } | null;
}

export class MissingAttachmentUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingAttachmentUrlError';
  }
}

/** Render Markdown after shielding authored macros from GFM table/inline parsing. */
export function renderToStorage(
  markdown: string,
  urls: AttachmentUrls,
  opts: RenderStorageOptions = {},
): string {
  // Нативный md-синтаксис макросов (панели, ::: properties, {{toc}} …) —
  // сахар над маркерами: переписываем до markdown-it (см. native.ts).
  const placeholders: Array<{ id: string; body: string; raw: string }> = [];
  let prefix = 'CFLATTACHTOKEN'; while (markdown.includes(prefix)) prefix += 'X';
  markdown = replaceInlineSyntax(markdown, ref => {
    if (!['img', 'file', 'page', 'user', 'note'].includes(ref.id) && !(ref.id in NATIVE_PLACEHOLDERS)) return;
    const line = markdown.slice(markdown.lastIndexOf('\n', ref.from - 1) + 1, ref.from);
    const cell = line.trimStart().startsWith('|');
    placeholders.push(cell ? { ...ref, raw: unescapeTablePipes(ref.raw), body: unescapeTablePipes(ref.body) } : ref);
    return `${prefix}${placeholders.length - 1}TOKEN`;
  });
  markdown = nativeToMarkers(markdown);
  const renderer = opts.linkify === false ? mdNoLinkify : md;
  let html = renderer.render(markdown);

  const renderPlaceholder = (kind: string, body: string): string => {
    const { name, attrs } = parsePlaceholder(body);
    if (kind === 'user') {
      const map = Object.fromEntries(attrs), type = map.type || 'userkey';
      if (!['userkey', 'username', 'account-id'].includes(type)) throw new Error('Unknown Confluence user identity type');
      const body = map.text === undefined ? '' : `<ac:plain-text-link-body><![CDATA[${map.text.replace(/]]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-link-body>`;
      return `<ac:link><ri:user ri:${type}="${escapeXmlAttr(name)}" />${body}</ac:link>`;
    }
    if (kind === 'page') {
      return renderPageLink(name, attrs);
    }
    if (kind === 'img') {
      if (opts.imageStyle === 'attachment') {
        return attachmentImage(name, attrs);
      }
      const url = urls.images.get(name);
      if (!url) {
        throw new MissingAttachmentUrlError(
          `No uploaded URL for image '${name}' — was it included in publishPage().images and successfully uploaded?`,
        );
      }
      return `<img src="${escapeXmlAttr(url)}" alt="${escapeXmlAttr(name)}" />`;
    }
    if (opts.fileStyle === 'attachment') {
      const text = attrs.find(([k]) => k === 'text')?.[1];
      const body = text !== undefined ? plainTextLinkBody(text) : '';
      return `<ac:link><ri:attachment ri:filename="${escapeXmlAttr(name)}" />${body}</ac:link>`;
    }
    const url = urls.files.get(name);
    if (!url) {
      throw new MissingAttachmentUrlError(
        `No uploaded URL for file '${name}' — was it included in publishPage().files and successfully uploaded?`,
      );
    }
    return `<a href="${escapeXmlAttr(url)}">${escapeXmlAttr(name)}</a>`;
  };
  html = html.replace(new RegExp(prefix + '(\\d+)TOKEN', 'g'), (_full, index: string) => {
    const ref = placeholders[Number(index)];
    if (ref.id === 'note') {
      const note = parseInlineNote(ref.body);
      const body = renderToStorage(note.text.replace(/\r?\n/g, '\n\n'), urls, opts);
      return renderInlineNote(body.trim(), note.attrs);
    }
    return ['img', 'file', 'page', 'user'].includes(ref.id) ? renderPlaceholder(ref.id, ref.body) : nativeToMarkers(ref.raw);
  });

  html = html.replace(/<p>((?:\s*<!-- MACRO:start:[^>]* -->\s*<!-- MACRO:end:[^>]* -->\s*)+)<\/p>/g, '$1');

  // ```confluence-storage — транспорт для дословного XHTML (ac:/ri:-теги
  // markdown-it сквозь себя не пропускает). Fence рендерится в экранированный
  // <pre><code>; здесь разэкранируем содержимое обратно в живую разметку.
  html = html.replace(
    /<pre><code class="language-confluence-storage">([\s\S]*?)<\/code><\/pre>\n?/g,
    (_full, escaped: string) => unescapeHtml(escaped.replace(/\n$/, '')) + '\n',
  );

  // Ссылки на связанные md → Confluence page-link по резолверу (карта из
  // манифеста). Только markdown-ссылки (`<a href>` из markdown-it); плейсхолдеры
  // {{file:}}/{{img:}} рендерятся ниже и сюда ещё не попали. Внешние URL/якоря
  // резолвер отсекает (возвращает null) — они остаются как есть.
  if (opts.resourceResolver) {
    html = html.replace(/<img\b[^>]*\bsrc="([^"]*)"[^>]*\/?>/g, (full, href: string) => {
      const decoded = unescapeHtml(href);
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(decoded)) return full;
      const target = opts.resourceResolver!(decoded);
      if (!target) return full;
      if ('url' in target) return full.replace(`src="${href}"`, `src="${escapeXmlAttr(target.url)}"`);
      const alt = /\balt="([^"]*)"/.exec(full)?.[1];
      return `<ac:image${alt ? ` ac:alt="${escapeXmlAttr(unescapeHtml(alt))}"` : ''}><ri:attachment ri:filename="${escapeXmlAttr(target.attachment)}" /></ac:image>`;
    });
  }
  if (opts.linkResolver || opts.resourceResolver) {
    html = html.replace(/<a href="([^"]*)"(?:\s+title="[^"]*")?>([\s\S]*?)<\/a>/g, (full, href: string, inner: string) => {
      const decoded = unescapeHtml(href);
      if (/^(?:#|(?:mailto|tel|javascript|data):)/i.test(decoded)) return full;
      const target = opts.linkResolver?.(decoded);
      if (target && 'url' in target) return `<a href="${escapeXmlAttr(target.url)}">${inner}</a>`;
      const body = /<[^>]+>/.test(inner)
        ? `<ac:link-body>${inner}</ac:link-body>`
        : plainTextLinkBody(unescapeHtml(inner));
      if (target) {
        const space = target.space ? ` ri:space-key="${escapeXmlAttr(target.space)}"` : '';
        const anchor = decoded.includes('#') ? ` ac:anchor="${escapeXmlAttr(decoded.slice(decoded.indexOf('#') + 1))}"` : '';
        return `<ac:link${anchor}><ri:page ri:content-title="${escapeXmlAttr(target.title)}"${space} />${body}</ac:link>`;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decoded)) return full;
      const resource = opts.resourceResolver?.(decoded);
      if (!resource) return full;
      if ('url' in resource) return `<a href="${escapeXmlAttr(resource.url)}">${inner}</a>`;
      return `<ac:link><ri:attachment ri:filename="${escapeXmlAttr(resource.attachment)}" />${body}</ac:link>`;
    });
  }

  return placeholders.some(ref => ref.id === 'note') ? liftInlineNotes(html) : html;
}

function renderPageLink(title: string, attrs: Array<[string, string]>): string {
  const space = attrs.find(([k]) => k === 'space')?.[1];
  const text = attrs.find(([k]) => k === 'text')?.[1];
  const spaceAttr = space !== undefined ? ` ri:space-key="${escapeXmlAttr(space)}"` : '';
  const body = text !== undefined ? plainTextLinkBody(text) : '';
  return `<ac:link><ri:page ri:content-title="${escapeXmlAttr(title)}"${spaceAttr} />${body}</ac:link>`;
}

function plainTextLinkBody(text: string): string {
  const safe = text.replace(/\]\]>/g, ']]]]><![CDATA[>');
  return `<ac:plain-text-link-body><![CDATA[${safe}]]></ac:plain-text-link-body>`;
}

/** Обратное к markdown-it escapeHtml (& < > "). */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
