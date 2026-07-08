/**
 * Core plugin: built-in Confluence macros available out of the box.
 *
 * Rich-body macros (expand, note, panel, …) wrap already-rendered XHTML.
 * Bodyless macros (toc, status, jira, …) pass their params through.
 */

import { Markdown } from '../../markdown/markdown.js';
import { macro } from '../builder.js';
import { paramMap, type MacroDefinition, type MacroPlugin } from '../types.js';
import { pageLinkValue, structuredMacro } from '../xml.js';

/** Rich-body macro that forwards the listed params (if present). */
function richBodyMacro(name: string, allowedParams?: string[]): MacroDefinition {
  return {
    name,
    render: (ctx) => {
      const params = ctx.params
        .filter((p) => !allowedParams || allowedParams.includes(p.name))
        .map((p) => ({ name: p.name, value: p.value }));
      return structuredMacro(name, ctx.macroId, { params, richBody: ctx.body });
    },
  };
}

/** Bodyless macro: params pass through, body (if any) is discarded. */
function bodylessMacro(name: string): MacroDefinition {
  return {
    name,
    render: (ctx) => structuredMacro(name, ctx.macroId, { params: ctx.params }),
  };
}

/**
 * `code` macro: the body must be plain text inside CDATA. By the time
 * processMacros runs, markdown-it has already rendered the body — a fenced
 * code block becomes `<pre><code>…</code></pre>` with escaped entities.
 * We unwrap that and decode entities back to raw source text.
 */
const codeMacro: MacroDefinition = {
  name: 'code',
  render: (ctx) => {
    const map = paramMap(ctx.params);
    const params = ctx.params.filter((p) =>
      ['language', 'title', 'linenumbers', 'collapse', 'firstline', 'theme'].includes(p.name),
    );
    void map;
    return structuredMacro('code', ctx.macroId, {
      params,
      plainBody: extractPlainText(ctx.body),
    });
  },
};

/** Unwraps `<pre><code>…</code></pre>` / `<p>…</p>` and decodes HTML entities. */
export function extractPlainText(body: string): string {
  let text = body.trim();
  const pre = text.match(/^<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>$/);
  if (pre) {
    text = pre[1].replace(/\n$/, '');
  } else {
    const p = text.match(/^<p[^>]*>([\s\S]*?)<\/p>$/);
    if (p) text = p[1];
  }
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** `anchor`: the anchor name goes into the unnamed (`""`) parameter. */
const anchorMacro: MacroDefinition = {
  name: 'anchor',
  render: (ctx) => {
    const map = paramMap(ctx.params);
    return structuredMacro('anchor', ctx.macroId, {
      params: [{ name: '', value: map.name ?? '' }],
    });
  },
};

/** `include`: includes another page; page reference goes into the unnamed param as ac:link. */
const includeMacro: MacroDefinition = {
  name: 'include',
  render: (ctx) => {
    const map = paramMap(ctx.params);
    return structuredMacro('include', ctx.macroId, {
      params: [{ name: '', value: pageLinkValue(map.page ?? '', map.space), raw: true }],
    });
  },
};

/** `excerpt-include`: transcludes a named excerpt from another page. */
const excerptIncludeMacro: MacroDefinition = {
  name: 'excerpt-include',
  render: (ctx) => {
    const map = paramMap(ctx.params);
    const params: Array<{ name: string; value: string; raw?: boolean }> = [
      { name: '', value: pageLinkValue(map.page ?? '', map.space), raw: true },
    ];
    if (map.nopanel) params.push({ name: 'nopanel', value: map.nopanel });
    return structuredMacro('excerpt-include', ctx.macroId, { params });
  },
};

export const coreMacrosPlugin: MacroPlugin = {
  name: 'core',
  macros: [
    // Rich-body containers
    richBodyMacro('expand', ['title']),
    richBodyMacro('note', ['title', 'icon']),
    richBodyMacro('info', ['title', 'icon']),
    richBodyMacro('warning', ['title', 'icon']),
    richBodyMacro('tip', ['title', 'icon']),
    richBodyMacro('panel'),
    richBodyMacro('excerpt', ['hidden', 'atlassian-macro-output-type']),
    // Plain-text body
    codeMacro,
    // Bodyless
    bodylessMacro('toc'),
    bodylessMacro('status'),
    bodylessMacro('jira'),
    bodylessMacro('children'),
    bodylessMacro('pagetree'),
    bodylessMacro('recently-updated'),
    anchorMacro,
    includeMacro,
    excerptIncludeMacro,
  ],
};

// ── Convenience builders (produce macro markers in Markdown) ────────────

/** Обёртывает markdown в макрос "развернуть". */
export function expand(body: Markdown | string, title?: string): Markdown {
  const builder = macro('expand').body(body);
  if (title) builder.param('title', title);
  return builder.toMarkdown();
}

function admonition(name: string) {
  return (body: Markdown | string, title?: string): Markdown => {
    const builder = macro(name).body(body);
    if (title) builder.param('title', title);
    return builder.toMarkdown();
  };
}

/** Обёртывает markdown в макрос "примечание". */
export const note = admonition('note');
/** Обёртывает markdown в макрос "информация". */
export const info = admonition('info');
/** Обёртывает markdown в макрос "предупреждение". */
export const warning = admonition('warning');
/** Обёртывает markdown в макрос "совет". */
export const tip = admonition('tip');

/** Обёртывает markdown в панель с произвольными параметрами (title, borderColor, bgColor, …). */
export function panel(body: Markdown | string, opts: Record<string, string | undefined> = {}): Markdown {
  return macro('panel').withParams(opts).body(body).toMarkdown();
}

/** Блок кода с подсветкой. Тело — сырой текст программы. */
export function codeBlock(
  source: string,
  opts: { language?: string; title?: string; linenumbers?: boolean; collapse?: boolean } = {},
): Markdown {
  const builder = macro('code');
  if (opts.language) builder.param('language', opts.language);
  if (opts.title) builder.param('title', opts.title);
  if (opts.linenumbers) builder.param('linenumbers', 'true');
  if (opts.collapse) builder.param('collapse', 'true');
  // Тело оборачиваем в fenced block, чтобы markdown-it не тронул содержимое
  // и code-renderer смог вытащить plain text из <pre><code>.
  return builder.body('```\n' + source + '\n```').toMarkdown();
}

/** Статус-лейбл: status('Green', 'ON TRACK'). */
export function status(colour: string, title: string, subtle = false): Markdown {
  const builder = macro('status').param('colour', colour).param('title', title);
  if (subtle) builder.param('subtle', 'true');
  return builder.toMarkdown();
}

/** Оглавление страницы. Параметры — как у Confluence toc (maxLevel, minLevel, style, …). */
export function toc(opts: Record<string, string | undefined> = {}): Markdown {
  return macro('toc').withParams(opts).toMarkdown();
}

/** Ссылка-карточка на задачу Jira по ключу. */
export function jiraIssue(key: string, opts: Record<string, string | undefined> = {}): Markdown {
  return macro('jira').param('key', key).withParams(opts).toMarkdown();
}

/** Якорь для внутристраничных ссылок. */
export function anchor(name: string): Markdown {
  return macro('anchor').param('name', name).toMarkdown();
}

/** Список дочерних страниц. */
export function children(opts: Record<string, string | undefined> = {}): Markdown {
  return macro('children').withParams(opts).toMarkdown();
}

/** Включение другой страницы целиком. */
export function includePage(page: string, space?: string): Markdown {
  const builder = macro('include').param('page', page);
  if (space) builder.param('space', space);
  return builder.toMarkdown();
}

/** Именованный excerpt (переиспользуемый фрагмент страницы). */
export function excerpt(body: Markdown | string, hidden = false): Markdown {
  const builder = macro('excerpt').body(body);
  if (hidden) builder.param('hidden', 'true');
  return builder.toMarkdown();
}

/** Включение excerpt с другой страницы. */
export function excerptInclude(page: string, opts: { space?: string; nopanel?: boolean } = {}): Markdown {
  const builder = macro('excerpt-include').param('page', page);
  if (opts.space) builder.param('space', opts.space);
  if (opts.nopanel) builder.param('nopanel', 'true');
  return builder.toMarkdown();
}
