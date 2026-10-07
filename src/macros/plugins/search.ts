import { macro } from '../builder.js';
import { escapeXmlAttr, structuredMacro } from '../xml.js';
import type { MacroPlugin } from '../types.js';

/** Search Results uses a space reference, not a text parameter, in storage. */
export const searchPlugin: MacroPlugin = {
  name: 'search',
  macros: [{ name: 'search', render: ctx => structuredMacro('search', ctx.macroId, {
    params: [...ctx.params].sort((a, b) => a.name.localeCompare(b.name)).map(p => p.name === 'spacekey' && p.value
      ? { ...p, value: `<ri:space ri:space-key="${escapeXmlAttr(p.value)}" />`, raw: true }
      : p),
  }) }],
};

export const search = (query: string, options: Record<string, string | undefined> = {}) =>
  macro('search').param('query', query).withParams(options).toMarkdown();
