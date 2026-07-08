import { basename, join } from 'node:path';
import { publishPage, type PublishPageOptions, type PublishPageResult } from './publish.js';
import { loadConfigFromEnv, type ConfluenceConfig, type LoadConfigOptions } from '../client/config.js';

export type Here = (relativePath: string) => string;
export type Build = (relativePath: string) => string;

export type PublishPlan =
  | PublishPageOptions[]
  | ((here: Here, build: Build) => PublishPageOptions[] | Promise<PublishPageOptions[]>);

export interface RunPublishOptions {
  /** Готовый конфиг вместо загрузки из env. */
  config?: ConfluenceConfig;
  /** Опции загрузки конфига из env (кастомные имена переменных токена). */
  env?: LoadConfigOptions;
  /**
   * Каталог для сгенерированных артефактов (PNG и т.п.), доступный через
   * `build(rel)`. Default: `<baseDir>/../../build/<basename(baseDir)>` —
   * соответствует компоновке репо `<repo>/docs/<set>` + `<repo>/build/<set>`.
   */
  buildDir?: string;
}

/**
 * Минимальная точка входа для публикующего скрипта (`docs/<set>/publish.ts`).
 *
 *   await runPublish(import.meta.dirname, (here, build) => [
 *     {
 *       pageId: '...',
 *       markdownPath: here('overview.md'),
 *       images: [build('p1.png')], // сгенерировано отдельным шагом в build-каталоге
 *     },
 *   ]);
 *
 * - `here(rel)`  — пути относительно папки запускающего модуля.
 * - `build(rel)` — пути относительно build-каталога (см. RunPublishOptions.buildDir).
 *
 * Конфиг Confluence загружается из env (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN,
 * CONFLUENCE_USERNAME, CONFLUENCE_AUTH_TYPE). При любой ошибке пишет одну
 * строку в stderr и завершает процесс с кодом 1 — Confluence не трогается.
 */
export async function runPublish(
  baseDir: string,
  plan: PublishPlan,
  opts: RunPublishOptions = {},
): Promise<PublishPageResult[]> {
  const here: Here = (p) => join(baseDir, p);
  const folderName = basename(baseDir);
  const buildBase = opts.buildDir ?? join(baseDir, '..', '..', 'build', folderName);
  const build: Build = (p) => join(buildBase, p);

  try {
    const cfg = opts.config ?? loadConfigFromEnv(opts.env);
    const pages = typeof plan === 'function' ? await plan(here, build) : plan;
    const results: PublishPageResult[] = [];
    for (const page of pages) {
      results.push(await publishPage(page, cfg));
    }
    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[publish] failed: ${msg}`);
    process.exit(1);
  }
}
