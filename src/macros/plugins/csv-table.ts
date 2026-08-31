/**
 * Plugin for the "CSV Table" Confluence macro (csv-table): renders a table
 * from a CSV — most usefully from a page attachment (`source=attachment`),
 * so the page body stays tiny while the data lives in the attached CSV.
 * Large datasets that would blow the Confluence storage-size limit as an
 * inline table are published as a CSV attachment and rendered by this macro
 * (optionally wrapped in table-filter for in-header filtering/pagination).
 */

import { Markdown } from '../../markdown/markdown.js';
import { macro } from '../builder.js';
import { paramMap, type MacroPlugin } from '../types.js';
import { structuredMacro } from '../xml.js';

// Дефолты csv-table, какие сохраняет редактор Confluence. Пустые-присутствие
// (password/header/login) — чтобы редактор не «терял» контролы при следующем
// открытии и сохранении страницы. source=attachment — данные из вложения.
export const CSV_TABLE_DEFAULTS: Record<string, string> = {
  isFirstTimeEnter: 'true',
  password: '',
  header: '',
  source: 'attachment',
  login: '',
};

// Порядок параметров как у редактора (стабильный вывод, дружелюбно к hash-diff).
const CSV_TABLE_PARAM_ORDER = ['isFirstTimeEnter', 'password', 'attachment', 'header', 'source', 'login'];

export const csvTablePlugin: MacroPlugin = {
  name: 'csv-table',
  macros: [
    {
      // Макрос «CSV Table». Рендерит таблицу из CSV. Обычный режим —
      // source=attachment + attachment=<имя.csv>: CSV берётся из вложения
      // страницы, тело страницы не пухнет от данных. Все переданные параметры
      // накладываются поверх дефолтов; вывод — в каноничном порядке редактора.
      name: 'csv-table',
      render: (ctx) => {
        const merged: Record<string, string> = { ...CSV_TABLE_DEFAULTS, ...paramMap(ctx.params) };
        const keys = [...CSV_TABLE_PARAM_ORDER, ...Object.keys(merged).filter((k) => !CSV_TABLE_PARAM_ORDER.includes(k))];
        const params = keys.filter((k) => merged[k] !== undefined).map((k) => ({ name: k, value: merged[k] }));
        return structuredMacro('csv-table', ctx.macroId, { params });
      },
    },
  ],
};

// ── Convenience builder ─────────────────────────────────────────────────

/**
 * Строит макрос "CSV Table" из вложения. По умолчанию `source=attachment`.
 * Опции перекрывают дефолты (например `header`, `source`).
 *
 * @example
 *   csvTable('worklogs_summary.csv')
 *   macros.tableFilter(csvTable('worklogs_summary.csv'), { totalrow: ',,,,,,,,Sum' })
 */
export function csvTable(attachment: string, opts: Record<string, string | undefined> = {}): Markdown {
  return macro('csv-table').param('attachment', attachment).withParams(opts).toMarkdown();
}
