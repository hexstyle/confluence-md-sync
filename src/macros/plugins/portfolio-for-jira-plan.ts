/**
 * Plugin for the "Portfolio for Jira — Plan" macro (portfolio-for-jira-plan):
 * embeds an Advanced Roadmaps / Portfolio plan roadmap on a Confluence page.
 * Bodyless macro; the plan is addressed by `url`, height by `planHeight`.
 *
 * Native md syntax (see native.ts + README): `{{portfolio-for-jira-plan:url=…|planHeight=900}}`.
 */

import { Markdown } from '../../markdown/markdown.js';
import { macro } from '../builder.js';
import { paramMap, type MacroPlugin } from '../types.js';
import { structuredMacro } from '../xml.js';

// Порядок параметров как у редактора Confluence (стабильный вывод под hash-diff).
const PORTFOLIO_PARAM_ORDER = ['planHeight', 'url'];

export const portfolioForJiraPlanPlugin: MacroPlugin = {
  name: 'portfolio-for-jira-plan',
  macros: [
    {
      // Макрос «Portfolio for Jira — Plan». Bodyless; параметры пробрасываются
      // как есть, в каноничном порядке редактора. url — ссылка на план-роадмап,
      // planHeight — высота встраивания в пикселях.
      name: 'portfolio-for-jira-plan',
      render: (ctx) => {
        const m = paramMap(ctx.params);
        const keys = [...PORTFOLIO_PARAM_ORDER.filter((k) => m[k] !== undefined),
          ...Object.keys(m).filter((k) => !PORTFOLIO_PARAM_ORDER.includes(k))];
        const params = keys.map((k) => ({ name: k, value: m[k] }));
        return structuredMacro('portfolio-for-jira-plan', ctx.macroId, { params });
      },
    },
  ],
};

// ── Convenience builder ─────────────────────────────────────────────────

/**
 * Строит макрос «Portfolio for Jira — Plan».
 *
 * @example
 *   portfolioForJiraPlan('https://jira/secure/PortfolioRoadmapConfluence.jspa?r=abc', { planHeight: '900' })
 */
export function portfolioForJiraPlan(url: string, opts: Record<string, string | undefined> = {}): Markdown {
  return macro('portfolio-for-jira-plan').param('url', url).withParams(opts).toMarkdown();
}
