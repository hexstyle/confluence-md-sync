#!/usr/bin/env node
/**
 * Минимальный CLI:
 *
 *   confluence-md-sync publish page.md --page-id 12345 \
 *     --image build/p1.png --file data.csv --label docs --dry-run
 *
 *   confluence-md-sync publish page.md --space DOCS --title "My Page" --parent-id 777
 *
 * Конфиг — из env: CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN (или CONFLUENCE_PAT),
 * CONFLUENCE_USERNAME, CONFLUENCE_AUTH_TYPE (bearer|basic).
 */

import { parseArgs } from 'node:util';
import { loadConfigFromEnv } from './client/config.js';
import { publishPage } from './publish/publish.js';

const HELP = `confluence-md-sync — publish Markdown to Confluence

Usage:
  confluence-md-sync publish <markdown-file> [options]

Options:
  --page-id <id>        Target page ID
  --space <key>         Space key (with --title, when page ID is unknown)
  --title <title>       Page title (rename, or lookup/create key with --space)
  --parent-id <id>      Parent page for page creation
  --image <path>        Attach an image (repeatable), referenced as {{img:name.png}}
  --file <path>         Attach a file (repeatable), referenced as {{file:name.csv}}
  --label <name>        Ensure label on the page (repeatable)
  --message <text>      Page version comment
  --no-create           Fail instead of creating a missing page
  --dry-run             Render and validate without writing to Confluence
  --help                Show this help

Environment:
  CONFLUENCE_BASE_URL   e.g. https://confluence.example.com
  CONFLUENCE_TOKEN      PAT (Data Center) or API token (Cloud); CONFLUENCE_PAT also works
  CONFLUENCE_USERNAME   required for basic auth (Cloud e-mail)
  CONFLUENCE_AUTH_TYPE  bearer (default) | basic
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'page-id': { type: 'string' },
      space: { type: 'string' },
      title: { type: 'string' },
      'parent-id': { type: 'string' },
      image: { type: 'string', multiple: true },
      file: { type: 'string', multiple: true },
      label: { type: 'string', multiple: true },
      message: { type: 'string' },
      'no-create': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const [command, markdownPath] = positionals;
  if (command !== 'publish' || !markdownPath) {
    console.error(`Unknown command or missing file. See --help.`);
    process.exit(1);
  }

  const cfg = loadConfigFromEnv();
  const result = await publishPage(
    {
      pageId: values['page-id'],
      spaceKey: values.space,
      title: values.title,
      parentPageId: values['parent-id'],
      markdownPath,
      images: values.image ?? [],
      files: values.file ?? [],
      labels: values.label,
      versionMessage: values.message,
      createIfMissing: values['no-create'] ? false : undefined,
      dryRun: values['dry-run'],
    },
    cfg,
  );
  console.log(
    `[cli] ${result.updated ? 'published' : 'unchanged'}: page ${result.pageId} v${result.version}`,
  );
}

main().catch((err: unknown) => {
  console.error(`[cli] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
