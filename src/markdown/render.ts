import MarkdownIt from 'markdown-it';

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
export const PLACEHOLDER_RE = /\{\{(img|file|page):([^}]+)\}\}/g;

export interface PlaceholderRef {
  /** Имя файла (img/file) или title страницы (page). */
  name: string;
  /** `|key=value`-атрибуты в порядке записи. */
  attrs: Array<[string, string]>;
}

/** Разбирает содержимое плейсхолдера: `name|k=v|k2=v2`. */
export function parsePlaceholder(body: string): PlaceholderRef {
  const parts = body.split('|');
  const name = parts[0].trim();
  const attrs: Array<[string, string]> = [];
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) attrs.push([part.trim(), '']);
    else attrs.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()]);
  }
  return { name, attrs };
}

export interface ExtractedPlaceholders {
  images: string[];
  files: string[];
  pages: string[];
}

export function extractPlaceholders(markdown: string): ExtractedPlaceholders {
  const images = new Set<string>();
  const files = new Set<string>();
  const pages = new Set<string>();
  for (const m of markdown.matchAll(PLACEHOLDER_RE)) {
    const { name } = parsePlaceholder(m[2]);
    if (m[1] === 'img') images.add(name);
    else if (m[1] === 'file') files.add(name);
    else pages.add(name);
  }
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
  return markdown.replace(/\{\{img:([^}]+)\}\}/g, (full, rawBody: string) => {
    const { name, attrs } = parsePlaceholder(rawBody);
    const renamed = renames.get(name);
    if (!renamed) return full;
    const attrStr = attrs.map(([k, v]) => `|${k}=${v}`).join('');
    return `{{img:${renamed}${attrStr}}}`;
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
}

export class MissingAttachmentUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingAttachmentUrlError';
  }
}

/**
 * Превращает Markdown в Confluence storage format.
 *
 * Логика двушаговая:
 *   1) markdown-it рендерит сам Markdown (без знания про плейсхолдеры).
 *      `{{img:foo}}` и `{{file:foo}}` для markdown-it — обычный текст
 *      без спецсимволов, доходят до выхода нетронутыми (могут быть
 *      обёрнуты в <p>...</p>, что нас устраивает).
 *   2) В готовом HTML регуляркой подставляем `<img src=URL/>` и
 *      `<a href=URL>filename</a>` на места плейсхолдеров. URL обязан
 *      существовать для каждого плейсхолдера — иначе
 *      MissingAttachmentUrlError.
 *
 * Раньше использовалась схема через sentinel-токены (` CFLIMG_0 `):
 * markdown-it трогал окружающие пробелы при упаковке в <p>, sentinel
 * терял пробелы, итоговый .split() не находил совпадения и в Confluence
 * вместо картинки попадал кусок «CFLIMG_0». Прямая регекс-замена по
 * HTML этой проблемы лишена — `{{img:foo}}` мимо markdown-it проходит
 * посимвольно.
 */
export function renderToStorage(
  markdown: string,
  urls: AttachmentUrls,
  opts: RenderStorageOptions = {},
): string {
  const renderer = opts.linkify === false ? mdNoLinkify : md;
  let html = renderer.render(markdown);

  // ```confluence-storage — транспорт для дословного XHTML (ac:/ri:-теги
  // markdown-it сквозь себя не пропускает). Fence рендерится в экранированный
  // <pre><code>; здесь разэкранируем содержимое обратно в живую разметку.
  html = html.replace(
    /<pre><code class="language-confluence-storage">([\s\S]*?)<\/code><\/pre>\n?/g,
    (_full, escaped: string) => unescapeHtml(escaped.replace(/\n$/, '')) + '\n',
  );

  return html.replace(PLACEHOLDER_RE, (_full, kind, rawBody) => {
    const { name, attrs } = parsePlaceholder(String(rawBody));
    if (kind === 'page') {
      return renderPageLink(name, attrs);
    }
    if (kind === 'img') {
      if (opts.imageStyle === 'attachment') {
        const acAttrs = attrs
          .map(([k, v]) => ` ac:${k}="${escapeXmlAttr(v)}"`)
          .join('');
        return `<ac:image${acAttrs}><ri:attachment ri:filename="${escapeXmlAttr(name)}" /></ac:image>`;
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
  });
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
