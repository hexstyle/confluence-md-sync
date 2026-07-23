#!/usr/bin/env node
/**
 * CLI: три подкоманды.
 *
 *   confluence-md-sync publish page.md --page-id 12345 \
 *     --image build/p1.png --file data.csv --label docs --dry-run
 *   confluence-md-sync publish page.md --space DOCS --title "My Page" --parent-id 777
 *
 *   confluence-md-sync export 12345 --out-dir ./exported
 *   confluence-md-sync roundtrip 12345           # проверка без потерь, ничего не пишет
 *
 * Конфиг — из env: CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN (или CONFLUENCE_PAT),
 * CONFLUENCE_USERNAME, CONFLUENCE_AUTH_TYPE (bearer|basic).
 */

import { parseArgs } from 'node:util';
import { loadConfigFromEnv } from './client/config.js';
import { publishPage } from './publish/publish.js';
import { exportPage } from './export/export-page.js';
import { roundTripPage } from './export/roundtrip.js';

const HELP = `confluence-md-sync — Markdown ⇄ Confluence

Usage:
  confluence-md-sync publish   <markdown-file> [options]
  confluence-md-sync export    <page-id> [--out <file> | --out-dir <dir>] [--readable] [--no-attachments]
  confluence-md-sync roundtrip <page-id> [--show-markdown]

publish options:
  --page-id <id>        Target page ID
  --space <key>         Space key (with --title, when page ID is unknown)
  --title <title>       Page title (rename, or lookup/create key with --space)
  --parent-id <id>      Parent page for page creation
  --image <src>         Attach an image (repeatable), referenced as {{img:name.png}}
  --file <src>          Attach a file (repeatable), referenced as {{file:name.csv}}
                        <src> is a relative/absolute path or an http(s) URL;
                        URLs on the Confluence host are fetched with your token
  --label <name>        Ensure label on the page (repeatable)
  --message <text>      Page version comment
  --no-create           Fail instead of creating a missing page
  --dry-run             Render and validate without writing to Confluence

export options:
  --out <file>          Write the Markdown to exactly this path (attachments,
                        if any, go to attachments/ next to it)
  --out-dir <dir>       Output directory (default: ./<page-id>); writes page.md
                        and attachments/
  --readable            Prefer clean Markdown over fidelity: no raw HTML blocks,
                        complex tables flattened to GFM. Not round-trippable —
                        loses styling/exact cell merges, keeps the content
  --no-attachments      Do not download referenced attachments

roundtrip options:
  --show-markdown       Print the intermediate Markdown to stdout

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
      out: { type: 'string' },
      'out-dir': { type: 'string' },
      readable: { type: 'boolean' },
      'no-attachments': { type: 'boolean' },
      'show-markdown': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  const [command, arg] = positionals;
  if (values.help || command === undefined) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const cfg = loadConfigFromEnv();

  if (command === 'publish') {
    if (!arg) throw new Error('publish: markdown file is required');
    const result = await publishPage(
      {
        pageId: values['page-id'],
        spaceKey: values.space,
        title: values.title,
        parentPageId: values['parent-id'],
        markdownPath: arg,
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
    return;
  }

  if (command === 'export') {
    if (!arg) throw new Error('export: page id is required');
    const result = await exportPage(
      arg,
      {
        outFile: values.out,
        outDir: values['out-dir'],
        downloadAttachments: !values['no-attachments'],
        mode: values.readable ? 'readable' : 'faithful',
      },
      cfg,
    );
    const tail = values.readable
      ? `${result.stats.lossy} block(s) simplified`
      : `${result.stats.fenced} raw storage block(s)`;
    console.log(
      `[cli] exported page ${result.pageId} "${result.title}" v${result.version} → ${result.markdownPath}` +
        ` (${result.downloaded.size} attachment(s), ${tail})`,
    );
    return;
  }

  if (command === 'roundtrip') {
    if (!arg) throw new Error('roundtrip: page id is required');
    const result = await roundTripPage(arg, cfg);
    if (values['show-markdown']) console.log(result.markdown);
    console.log(
      `[cli] roundtrip page ${arg} "${result.title}": ${result.equal ? 'OK — no markup loss' : 'DIFFERENCES FOUND'}` +
        ` (markers=${result.stats.markers}, fenced=${result.stats.fenced}, rawHtml=${result.stats.rawHtml})`,
    );
    for (const d of result.diffs) console.error(`  ${d.path}: ${d.message}`);
    process.exit(result.equal ? 0 : 2);
  }

  console.error(`Unknown command '${command}'. See --help.`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`[cli] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
