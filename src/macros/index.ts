export {
  paramMap,
  type MacroDefinition,
  type MacroParam,
  type MacroPlugin,
  type MacroRenderer,
  type RendererContext,
} from './types.js';
export { MacroBuilder, macro, escapeParamValue, unescapeParamValue } from './builder.js';
export { MacroRegistry, processMacros } from './registry.js';
export {
  escapeXmlAttr,
  generateMacroId,
  structuredMacro,
  pageLinkValue,
  type StructuredMacroOptions,
} from './xml.js';
export { coreMacrosPlugin, extractPlainText } from './plugins/core.js';
export { tableFilterPlugin, TABLE_FILTER_DEFAULTS } from './plugins/table-filter.js';

import { MacroRegistry } from './registry.js';
import { coreMacrosPlugin } from './plugins/core.js';
import { tableFilterPlugin } from './plugins/table-filter.js';
import {
  anchor,
  children,
  codeBlock,
  excerpt,
  excerptInclude,
  expand,
  includePage,
  info,
  jiraIssue,
  note,
  panel,
  status,
  tip,
  toc,
  warning,
} from './plugins/core.js';
import { tableExcerpt, tableExcerptInclude, tableFilter } from './plugins/table-filter.js';

/** Creates a registry pre-loaded with all built-in plugins. */
export function createDefaultRegistry(): MacroRegistry {
  return new MacroRegistry().use(coreMacrosPlugin).use(tableFilterPlugin);
}

/**
 * Глобальный реестр по умолчанию (core + table-filter). Используется,
 * если в publishPage/processMacros не передан свой registry.
 */
export const defaultMacroRegistry = createDefaultRegistry();

/** Возвращает глобальный реестр макросов. */
export function getMacroRegistry(): MacroRegistry {
  return defaultMacroRegistry;
}

/**
 * Namespace с построителями макросов — генерируют маркеры в Markdown.
 *
 * @example
 *   macros.tableFilter(macros.tableExcerpt(tableMd, 'jira_fact'), { totalrow: ',,Sum' })
 */
export const macros = {
  expand,
  note,
  info,
  warning,
  tip,
  panel,
  codeBlock,
  status,
  toc,
  jiraIssue,
  anchor,
  children,
  includePage,
  excerpt,
  excerptInclude,
  tableExcerpt,
  tableFilter,
  tableExcerptInclude,
};
