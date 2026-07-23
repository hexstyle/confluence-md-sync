# confluence-md-sync

[![npm version](https://img.shields.io/npm/v/confluence-md-sync)](https://www.npmjs.com/package/confluence-md-sync)
[![CI](https://github.com/hexstyle/confluence-md-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/hexstyle/confluence-md-sync/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 20.11](https://img.shields.io/badge/node-%E2%89%A5%2020.11-brightgreen)](package.json)

Docs-as-code for Confluence (Data Center & Cloud): publish Markdown, read
typed tables back, attach files — idempotently, with a **pluggable macro
system**. ESM-only, zero-config CI.

```bash
npm install confluence-md-sync          # as a library
npm install -g confluence-md-sync       # as a CLI: `confluence-md-sync …`
```

## Highlights

- **No history spam** — rendered content is SHA-256-hashed into a content
  property; identical re-publish skips the update, page version doesn't grow.
- **Attachment dedup** — uploads are tagged `sha256:<hash>`; unchanged files
  are reused. `<file>.src-sha256` sidecars pin dedup to the *source* of
  non-deterministic artifacts (e.g. PNGs rendered by a headless browser).
- **Fail before write** — placeholders, files and macro markers are validated
  up front; Confluence is never touched on a broken input.
- **Pluggable macros** — built-in `core` + `table-filter` plugins, extend
  with your own in a few lines; unknown macros pass through unchanged.
- **Flexible sources** — images/files accept relative paths, absolute paths
  or `http(s)` URLs; URLs on your Confluence host are fetched with the
  configured token.
- **Export & round-trip** — pull a page into Markdown and publish it back
  loss-free (verified by canonical storage comparison), or export a
  `readable`, pure-Markdown version for humans.

## Configuration

| Env var | Meaning |
| --- | --- |
| `CONFLUENCE_BASE_URL` | e.g. `https://confluence.example.com` |
| `CONFLUENCE_TOKEN` | PAT (Data Center) or API token (Cloud); `CONFLUENCE_PAT` also accepted |
| `CONFLUENCE_USERNAME` | required for `basic` auth (Cloud e-mail) |
| `CONFLUENCE_AUTH_TYPE` | `bearer` (default, DC) \| `basic` (Cloud) |

```ts
import { loadConfigFromEnv } from 'confluence-md-sync';
const cfg = loadConfigFromEnv();
// or explicitly:
// const cfg = { baseUrl, token, username: 'me@example.com', authType: 'basic' };
```

## Publish a page

Markdown + three placeholder kinds:

```markdown
# Отчёт за месяц

{{img:chart.png}}            <!-- inline image from images[] -->
{{img:flow.bpmn}}            <!-- BPMN diagram — rendered to PNG automatically -->
Исходник: {{file:data.csv}}  <!-- attachment link from files[] -->

{{table:summary}}            <!-- table injected from tables[] -->
```

```ts
import { publishPage, macros, renderMarkdownTable } from 'confluence-md-sync';

const summary = renderMarkdownTable(rows, [
  { header: 'Проект',    cell: (r) => r.name },
  { header: 'Часы',      cell: (r) => r.hours.toFixed(2), align: 'right' },
  { header: 'Статус',    cell: (r) => r.status },
]);

await publishPage({
  pageId: '123456789',
  markdownPath: 'docs/report.md',
  images: [
    'build/chart.png',
    'docs/flow.bpmn',   // converted to flow.png on the fly (see BPMN section)
  ],
  files: ['build/data.csv'],
  tables: [{
    name: 'summary',
    // sortable/filterable table with a totals row
    markdown: macros.tableFilter(
      macros.tableExcerpt(summary, 'summary'),
      { totalrow: ',Sum,' },
    ),
  }],
  labels: ['report', 'auto'],
  versionMessage: 'automated publish',
}, cfg);
```

More cases:

```ts
// By space + title — page is looked up and created when missing
await publishPage({ spaceKey: 'DOCS', title: 'Monthly Report',
                    parentPageId: '123', markdown: reportMd }, cfg);

// Dry run — full render + validation, nothing written (great for PR checks)
const { storage } = await publishPage({ pageId, markdownPath, dryRun: true }, cfg);

// Inline content instead of a file
await publishPage({ pageId, markdown: '# Generated\n\ntext' }, cfg);

// Remote sources — downloaded at publish time; the filename for {{img:...}}
// comes from the URL path. URLs on the configured Confluence host are
// fetched with your token, so you can pull attachments from other pages.
await publishPage({
  pageId,
  markdownPath,
  images: ['https://confluence.example.com/download/attachments/999/flow.bpmn'],
  files: ['https://files.example.com/exports/выгрузка.csv'],
  downloadDir: 'build',   // optional; default: temp dir per run
}, cfg);
```

## BPMN diagrams out of the box

Pass a `.bpmn` file as an image (a path or an `http(s)` URL) — it is
rendered to PNG at publish time
(headless Chromium via [bpmn-to-image](https://npmjs.com/package/bpmn-to-image),
an optional peer dependency).

Setup — install the converter **and** force a current puppeteer:

```bash
npm install -D bpmn-to-image puppeteer
```

```jsonc
// package.json — required: bpmn-to-image pins puppeteer 21, whose bundled
// Chromium fails to launch on recent OSes ("socket hang up"). The override
// must reference the direct dependency ("$puppeteer"), otherwise `npm ci`
// fails with "Override for puppeteer conflicts with direct dependency".
{
  "devDependencies": {
    "bpmn-to-image": "^0.7.0",
    "puppeteer": "^24.0.0"
  },
  "overrides": {
    "puppeteer": "$puppeteer"
  }
}
```

```markdown
Процесс выпуска релиза:

{{img:release-flow.bpmn}}
```

```ts
await publishPage({
  pageId: '123456789',
  markdownPath: 'docs/process.md',
  images: ['docs/release-flow.bpmn'],   // converted to release-flow.png automatically
  bpmnOutDir: 'build',                  // optional; default: temp dir per run
}, cfg);
```

Chromium PNG output is not byte-stable between runs, so dedup is pinned to
the SHA-256 of the *source* `.bpmn` via a `.src-sha256` sidecar — unchanged
diagrams never create new attachment versions. Batch pre-conversion is also
available:

```ts
import { convertBpmnFolder } from 'confluence-md-sync';
await convertBpmnFolder({ srcDir: 'docs/diagrams', outDir: 'build' });
```

## Export a page back to Markdown

Pull an existing page by ID and turn its storage format into Markdown.
Attachments and page links become `{{img:...}}` / `{{file:...}}` /
`{{page:...}}` placeholders. Two modes trade fidelity against readability:

| Mode | For | What it does |
| --- | --- | --- |
| `faithful` *(default)* | round-trip, editing then re-publishing | **Loss-free by construction.** Clean Markdown → macro markers → verbatim storage (raw HTML, or a ` ```confluence-storage ` fence) as a fallback. Perfect fidelity, but the raw-HTML blocks (complex tables, wrappers) render poorly in some Markdown viewers. |
| `readable` | reading, diffing, docs you won't publish back | **Clean Markdown, no raw HTML.** Complex tables are flattened to GFM (merged cells → filled grid, block cells → `• …` joined by `<br>`), styled spans/wrappers are unwrapped, entities decoded, and `<br>` in paragraphs becomes a real line break (inside table cells it stays `<br>` — GFM cells can't hold newlines). Keeps the content; **drops** colours, exact merge geometry, wrappers — *not* round-trippable. |

Images and attachments are downloaded by default (pass
`downloadAttachments: false` to skip). They land in `attachments/` next to
the Markdown, and the page body references them via `{{img:name}}` /
`{{file:name}}` — in both modes.

```ts
import { exportPage } from 'confluence-md-sync';

const { markdownPath, images, downloaded } = await exportPage(
  '123456789',
  { outDir: 'exported' },              // faithful; exported/page.md + exported/attachments/
  cfg,
);
console.log(downloaded);               // Map<filename, localPath> of saved attachments

// Readable variant for humans (writes page.md + ./attachments/ next to it):
await exportPage('123456789', { outFile: 'page.md', mode: 'readable' }, cfg);
```

Round-trip means *edit the Markdown, then publish it straight back*:

```ts
await publishPage({
  pageId: '123456789',
  markdownPath: 'exported/page.md',
  images: ['exported/attachments/diagram.png'],
  // exported markup uses native attachment/link references, not URLs:
  render: { imageStyle: 'attachment', fileStyle: 'attachment', linkify: false },
}, cfg);
```

Verify a page survives the trip with no markup loss (writes nothing):

```ts
import { roundTripPage } from 'confluence-md-sync';

const r = await roundTripPage('123456789', cfg);
console.log(r.equal, r.stats);   // true { markers, fenced, rawHtml }
// r.diffs lists any canonical differences when equal === false
```

Equivalence is **canonical**, not byte-for-byte: `ac:macro-id`,
schema-version, attribute/parameter order and entity vs literal forms are
normalised away (Confluence itself rewrites these on every save). Use
`compareStorage(a, b)` directly to diff two storage fragments.

From the CLI:

```bash
# attachments download to ./attachments/ next to the .md (omit --no-attachments)
confluence-md-sync export    123456789 --out page.md              # faithful
confluence-md-sync export    123456789 --out page.md --readable   # clean Markdown
confluence-md-sync roundtrip 123456789 --show-markdown            # exit 2 on loss
```

## Read pages and tables

```ts
import { confluence } from 'confluence-md-sync';

const page = await confluence(cfg).readPage('987654321');

// by index (0 = first) or by table-excerpt macro name
const employees = page.getTable('employees').toType<Employee>((row, e) => {
  e.fio   = row['ФИО'];
  e.email = row['Почта'];
});

const csv = await page.getAttachmentText('timesheet.csv');
await page.removeOldAttachmentVersions();   // keep latest version only
await page.addLabels(['hr']);
```

CSV helpers (BOM detection, Windows-1251 fallback, `;`/`,` auto-detect):

```ts
import { decodeText, readCsv, writeCsv } from 'confluence-md-sync/csv';
const rows = readCsv(decodeText(await page.getAttachment('data.csv')));
```

## Macros

Builders return `Markdown` with comment markers; markers become
`<ac:structured-macro>` after rendering (nested macros resolve inner-first):

```ts
// containers
macros.expand(body, 'Details');
macros.note(body, 'Внимание');            // also: info, warning, tip
macros.panel(body, { title: 'Panel' });
macros.codeBlock(src, { language: 'sql', title: 'Query' });
macros.excerpt(body);

// bodyless
macros.toc({ maxLevel: '3' });
macros.status('Green', 'ON TRACK');
macros.jiraIssue('PROJ-123');
macros.anchor('section-1');
macros.children({ depth: '2' });

// cross-page includes
macros.includePage('Page Title', 'DOCS');
macros.excerptInclude('Source Page');
macros.tableExcerptInclude('name', 'Source Page');

// Table Filter and Charts app
macros.tableExcerpt(md, 'name', /* hide */ true);
macros.tableFilter(md, { totalrow: ',,Sum' });
macros.tableJoiner(includesMd, "SELECT * FROM T1 LEFT JOIN T2 ON …");  // multiline SQL ok
```

Or write markers by hand right in Markdown:

```markdown
<!-- MACRO:start:expand:title=Детали -->
Any **markdown**, including nested macros.
<!-- MACRO:end:expand -->
```

Any macro name works out of the box — one that isn't registered passes
through to `<ac:structured-macro>` as-is (params + rich-text body). Disable
with `registry.passthroughUnknownMacros(false)`.

### Custom macro plugin

```ts
import { MacroRegistry, coreMacrosPlugin, tableFilterPlugin,
         structuredMacro } from 'confluence-md-sync';

const registry = new MacroRegistry()
  .use(coreMacrosPlugin)
  .use(tableFilterPlugin)
  .register('roadmap', (ctx) =>
    structuredMacro('roadmap', ctx.macroId, { params: ctx.params, richBody: ctx.body }));

await publishPage({ pageId, markdownPath, registry }, cfg);
```

`structuredMacro()` handles escaping, rich vs plain (CDATA) bodies and `]]>`
splitting; `pageLinkValue()` builds `<ac:link><ri:page/>` parameter values.

## CLI

Installed globally (`npm i -g confluence-md-sync`) the `confluence-md-sync`
command is on your PATH; otherwise prefix the examples with `npx`. The
instance URL and token come from the environment.

```bash
export CONFLUENCE_BASE_URL='https://confluence.example.com'
export CONFLUENCE_TOKEN='<your-PAT>'

# Download a page to an exact .md path (add --no-attachments for the md only)
confluence-md-sync export 123456789 --out ./page.md              # faithful
confluence-md-sync export 123456789 --out ./page.md --readable   # clean Markdown

confluence-md-sync publish docs/page.md --page-id 123456789 \
  --image build/flow.png --file build/data.csv --label docs

confluence-md-sync publish docs/page.md --space DOCS --title "Моя страница" --dry-run

confluence-md-sync export    123456789 --out-dir exported   # page.md + attachments/
confluence-md-sync roundtrip 123456789                      # exit 2 if markup would be lost
```

## CI publish plans

```ts
// docs/dev-process/publish.ts — run with `npx tsx`
import { runPublish } from 'confluence-md-sync';

await runPublish(import.meta.dirname, (here, build) => [
  { pageId: '111', markdownPath: here('process.md'), images: [build('flow.png')] },
  { pageId: '222', markdownPath: here('release.md') },
]);
```

```yaml
# .github/workflows/docs.yml
- run: npx tsx docs/dev-process/publish.ts
  env:
    CONFLUENCE_BASE_URL: ${{ vars.CONFLUENCE_BASE_URL }}
    CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
```

`here()` resolves next to the script, `build()` inside the artifacts dir; the
process exits 1 before any write on error.

## Architecture

```
src/
├── client/        REST client + auth: pages, properties, attachments, labels, CQL
├── markdown/      Markdown type, markdown-it → storage renderer, validation
├── macros/        registry, builder, plugins (core, table-filter)
├── attachments/   sha256 dedup, sidecar source hashes, version history
├── pages/         Page/Table object model, table parse & render
├── publish/       idempotent publish pipeline, runPublish plans, remote sources
├── export/        storage parser, storage→Markdown, canonical compare, round-trip
├── wrapper.ts     confluence() facade
├── csv.ts         CSV helpers (subpath export ./csv)
└── cli.ts         confluence-md-sync CLI
```

## Roadmap

Cloud API v2 backend · page-tree sync from a directory · Mermaid/PlantUML
fences → images · fenced code → `code` macro · HTTP retry/backoff ·
comments API · dry-run diff preview.

Issues and PRs welcome.

## Development

```bash
npm ci
npm run typecheck && npm test && npm run build
```

Releasing (maintainers): `npm version minor && git push --follow-tags` —
the `v*` tag triggers the npm publish workflow (tag must match
`package.json` version).

## License

[MIT](LICENSE)
