# Publish

`publish.ts` validates references, uploads attachments and publishes idempotently.
draw.io XML belongs in files[], its matching PNG in images[]. Native macros use the
latest target-page attachment version; old Confluence revision/page pins are removed.
`remote.ts` resolves URLs, `notice.ts` creates the managed-page banner, and `runner.ts`
runs multi-page plans. Tests use a local HTTP server rather than live Confluence.

`jira.ts` resolves the target Confluence default Jira connection at publication;
ambiguous or unavailable configuration produces an explicit error.

`user.ts` resolves each authored login once per request to the target user key/account
ID before hashing. Confluence's own normalization then causes no extra publication
after import. Explicit keys/account IDs require no lookup; inaccessible logins fail explicitly.

`mermaid.ts` discovers fenced diagrams, renders PNG and stores the source/image map.
Flowcharts and sequence diagrams use the same RMK geometry as the visual editor.
Other kinds use local Mermaid/Chromium with external requests blocked. Rendering needs
optional peers `@resvg/resvg-js`, `mermaid` and `puppeteer`; normal pages do not load them.
