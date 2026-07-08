import MarkdownIt from 'markdown-it';

// xhtmlOut: true — Confluence storage format = XHTML, void-элементы
// (<hr/>, <br/>, <img/>) обязаны быть самозакрывающимися.
// html: true — разрешить HTML (нужно для <!-- MACRO:... --> комментариев)
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
  xhtmlOut: true,
});

export const PLACEHOLDER_RE = /\{\{(img|file):([^}]+)\}\}/g;

export interface ExtractedPlaceholders {
  images: string[];
  files: string[];
}

export function extractPlaceholders(markdown: string): ExtractedPlaceholders {
  const images = new Set<string>();
  const files = new Set<string>();
  for (const m of markdown.matchAll(PLACEHOLDER_RE)) {
    const name = m[2].trim();
    if (m[1] === 'img') images.add(name);
    else files.add(name);
  }
  return { images: [...images], files: [...files] };
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
  return markdown.replace(/\{\{img:([^}]+)\}\}/g, (full, rawName: string) => {
    const renamed = renames.get(rawName.trim());
    return renamed ? `{{img:${renamed}}}` : full;
  });
}

export interface AttachmentUrls {
  /** filename → абсолютный URL аттача, полученный из Confluence после аплоада. */
  images: Map<string, string>;
  files: Map<string, string>;
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
export function renderToStorage(markdown: string, urls: AttachmentUrls): string {
  const html = md.render(markdown);

  return html.replace(PLACEHOLDER_RE, (_full, kind, rawName) => {
    const name = String(rawName).trim();
    if (kind === 'img') {
      const url = urls.images.get(name);
      if (!url) {
        throw new MissingAttachmentUrlError(
          `No uploaded URL for image '${name}' — was it included in publishPage().images and successfully uploaded?`,
        );
      }
      return `<img src="${escapeXmlAttr(url)}" alt="${escapeXmlAttr(name)}" />`;
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
