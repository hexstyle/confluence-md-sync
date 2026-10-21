# Tests

`npm test` runs Vitest. Native macro tests check storage round trips. Publish tests use
a local HTTP server and verify idempotency. draw.io tests cover native/image publishing,
extensionless XML attachments, parameters and missing dependency validation.
Search tests preserve structured space references and quoted template queries.
`table-macros.test.ts` covers nested editable tables, SQL, source references and mentions.
`CONFLUENCE_MACRO_FIXTURES` enables local ORP/vacations/staff snapshots without committing private data.

Structurizr tests cover PNG rendering, editable import and attachment validation.
Render tests also cover repository assets, linked images, rich labels and anchors.
`image-format.test.ts` verifies native image properties, linked captions, GFM cells,
Structurizr formatting, code examples and unsafe hyperlink rejection.

`links.test.ts` checks forward/reverse repository links and second-pass tree relinking.

`inline-note.test.ts` covers cell Notes, nested page/Jira/file, escaping, code literals,
paragraphs versus line breaks and faithful fallback. `publish.test.ts` verifies that
importing and republishing a Note adds no page version.

`properties.test.ts` covers duplicate headings, styled tables, preserved data and repeated cycles.

`jira.test.ts` checks portable references and target-side default server resolution.
`properties-live.test.ts` runs three actual Confluence cycles on a disposable page;
set CONFLUENCE_TEST_BASE_URL/TOKEN/PARENT_ID/SPACE_KEY explicitly. Cleanup deletes the test page.
