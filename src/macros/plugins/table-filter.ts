/**
 * Plugin for the "Table Filter and Charts for Confluence" app macros:
 * table-excerpt, table-filter, table-excerpt-include.
 */

import { Markdown } from '../../markdown/markdown.js';
import { macro } from '../builder.js';
import { paramMap, type MacroPlugin } from '../types.js';
import { pageLinkValue, structuredMacro } from '../xml.js';

// Дефолты table-filter из Confluence-редактора (нашли реверсом).
// Особенно важен hidePane=Table header — без него фильтры рендерятся
// отдельной панелью НАД таблицей; с ним — встают в шапку колонок.
// Пустые-присутствие нужны, чтобы редактор не «потерял» эти контролы
// при следующем открытии и сохранении страницы.
export const TABLE_FILTER_DEFAULTS: Record<string, string> = {
  hidelabels: 'false',
  sparkName: 'Sparkline',
  hidePane: 'Table header',
  sparkline: 'false',
  isFirstTimeEnter: 'true',
  hideColumns: 'false',
  customNoTableMsg: 'false',
  disabled: 'false',
  enabledInEditor: 'false',
  globalFilter: 'false',
  hideControls: 'false',
  numbering: 'Dynamic Ascending',
  disableSave: 'false',
  separator: 'Point (.)',
  datepattern: "d M yy 'г'.",
  updateSelectOptions: 'false',
  worklog: '365|5|8|y w d h m|y w d h m',
  isOR: 'AND',
  fixedCols: '',
  ddSeparator: '',
  customNoTableMsgText: '',
  limitHeight: '',
  default: '',
  'cell-width': '',
  totalRowName: '',
  totalColName: '',
  iconfilter: '',
  order: '',
  inverse: '',
  datefilter: '',
  column: '',
  sort: '',
  totalcol: '',
  rowsPerPage: '',
  labels: '',
  thousandSeparator: '',
  ignoreFirstNrows: '',
  ddOperator: '',
  userfilter: '',
  numberfilter: '',
  heightValue: '',
  hideFilters: '',
  showNRowsifNotFiltered: '',
};

export const tableFilterPlugin: MacroPlugin = {
  name: 'table-filter',
  macros: [
    {
      // Макрос "Выборка таблицы" (table-excerpt).
      // Параметры: name — название выборки; hide — скрывать ли содержимое.
      name: 'table-excerpt',
      render: (ctx) => {
        const map = paramMap(ctx.params);
        const params: Array<{ name: string; value: string }> = [];
        if (map.hide === 'true') params.push({ name: 'hide', value: 'true' });
        if (map.name) params.push({ name: 'name', value: map.name });
        return structuredMacro('table-excerpt', ctx.macroId, { params, richBody: ctx.body });
      },
    },
    {
      // Макрос "Фильтрация таблицы" (table-filter). Оборачивает контент
      // (обычно table-excerpt с готовой таблицей) в Confluence-фильтр.
      // Все ключи параметров пробрасываются как есть — Confluence для
      // не указанных применяет дефолты. Часто используемые:
      //   - totalrow: ",,,Sum,Sum,…" — операции по колонкам (пустое — пропуск).
      //   - numbering: "Dynamic Ascending" — нумерация строк.
      //   - separator: "Point (.)" / "Comma (,)" — десятичный разделитель.
      //   - hideControls / hidelabels / globalFilter: "true" / "false".
      //   - totalRowName: подпись строки итогов.
      name: 'table-filter',
      render: (ctx) =>
        structuredMacro('table-filter', ctx.macroId, {
          params: ctx.params,
          richBody: ctx.body,
        }),
    },
    {
      // Макрос "Объединение таблиц" (table-joiner): SQL-запрос по таблицам
      // из тела макроса (обычно table-excerpt-include). Параметры — как есть;
      // многострочный sql в маркере кодируется %0A (см. escapeParamValue).
      name: 'table-joiner',
      render: (ctx) =>
        structuredMacro('table-joiner', ctx.macroId, {
          params: ctx.params,
          richBody: ctx.body,
        }),
    },
    {
      // Включение table-excerpt с другой страницы. page/space собираются в
      // ac:link-параметр; остальные параметры (v, merge-tables, …)
      // пробрасываются как есть.
      name: 'table-excerpt-include',
      render: (ctx) => {
        const map = paramMap(ctx.params);
        const params: Array<{ name: string; value: string; raw?: boolean }> = [
          { name: 'name', value: map.name ?? '' },
        ];
        // Без page макрос ссылается на текущую страницу — параметр не пишем.
        if (map.page !== undefined) {
          params.push({ name: 'page', value: pageLinkValue(map.page, map.space), raw: true });
          params.push({ name: 'type', value: map.type ?? 'page' });
        } else if (map.type !== undefined) {
          params.push({ name: 'type', value: map.type });
        }
        for (const p of ctx.params) {
          if (!['name', 'page', 'space', 'type'].includes(p.name)) params.push(p);
        }
        return structuredMacro('table-excerpt-include', ctx.macroId, { params });
      },
    },
  ],
};

// ── Convenience builders ────────────────────────────────────────────────

/**
 * Обёртывает markdown в макрос "выборка таблицы".
 *
 * @example
 *   tableExcerpt(tableMarkdown, 'jira_fact', true)
 */
export function tableExcerpt(body: Markdown | string, name?: string, hide?: boolean): Markdown {
  const builder = macro('table-excerpt').body(body);
  if (name) builder.param('name', name);
  if (hide) builder.param('hide', 'true');
  return builder.toMarkdown();
}

/**
 * Обёртывает markdown в макрос "фильтрация таблицы".
 *
 * Применяет полный набор дефолтов, какой Confluence-редактор сохраняет
 * при создании макроса — в том числе пустые-присутствие параметры
 * (`fixedCols`, `column`, etc). Без них макрос рендерит контролы как
 * отдельную панель НАД таблицей; с дефолтом `hidePane=Table header`
 * фильтры встают в шапку колонок. Caller перекрывает что нужно через
 * `opts` (например `totalrow`); пустая строка в opts означает «оставить
 * как пустое-присутствие», не удаление.
 *
 * @example
 *   tableFilter(tableExcerptMd, { totalrow: ',,,Sum,Sum,Sum' })
 */
export function tableFilter(
  body: Markdown | string,
  opts: Record<string, string | undefined> = {},
): Markdown {
  const merged: Record<string, string> = { ...TABLE_FILTER_DEFAULTS };
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) merged[k] = v;
  }
  const builder = macro('table-filter').body(body);
  for (const [k, v] of Object.entries(merged)) {
    builder.param(k, v);
  }
  return builder.toMarkdown();
}

/**
 * Обёртывает markdown (обычно table-excerpt-include'ы) в макрос
 * "объединение таблиц" с SQL-запросом. Многострочный SQL допустим.
 *
 * @example
 *   tableJoiner(includesMd, "SELECT * FROM T1 LEFT JOIN T2 ON T1.'Код' = T2.'Код'")
 */
export function tableJoiner(
  body: Markdown | string,
  sql: string,
  opts: Record<string, string | undefined> = {},
): Markdown {
  return macro('table-joiner').param('sql', sql).withParams(opts).body(body).toMarkdown();
}

/** Включение table-excerpt с другой страницы по имени выборки. */
export function tableExcerptInclude(
  name: string,
  page: string,
  opts: { space?: string; type?: string } = {},
): Markdown {
  const builder = macro('table-excerpt-include').param('name', name).param('page', page);
  if (opts.space) builder.param('space', opts.space);
  if (opts.type) builder.param('type', opts.type);
  return builder.toMarkdown();
}
