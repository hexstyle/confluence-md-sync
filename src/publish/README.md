# Publish

`publish.ts` validates references, uploads attachments and publishes idempotently.
draw.io XML belongs in files[], its matching PNG in images[]. Native macros use the
latest target-page attachment version; old Confluence revision/page pins are removed.
`remote.ts` resolves URLs, `notice.ts` creates the managed-page banner, and `runner.ts`
runs multi-page plans. Tests use a local HTTP server rather than live Confluence.
