# Markdown

`render.ts` renders Markdown and attachment placeholders. `native.ts` converts native
macro syntax to markers. `validate.ts` checks references before publishing.
Inline parameters accept JSON-quoted values for pipes, braces and line breaks.
Table Filter, Table Excerpt and Table Transformer use nested `::: table-*` containers;
`{{table-excerpt-include:…}}` retains structured page/space references.
`{{user:identity|type=userkey}}` preserves Confluence mentions in editable table cells.
`drawio.ts` extracts XML and PNG dependencies, excluding code examples.

`structurizr.ts` validates DSL, JSON and view PNG dependencies, excluding code examples.
`resourceResolver` resolves ordinary Markdown images/files to page attachments or
repository URLs. Page links preserve rich labels, linked images and anchors.

`linkResolver` also accepts explicit repository URLs and can return a stable page URL.
`placeholder.ts` and `inline-syntax.ts` provide browser-safe quoted parameters and
balanced macro scanning, excluding code. They are exported through `confluence-md-sync/syntax`.
`image.ts` renders native image formatting, captions (`title` in Data Center),
hyperlinks and `display=link`. Image parameters are protected before GFM table parsing.

`note.ts` shares inline Note authoring with editors. Quoted bodies support title/icon;
newlines create paragraphs while `<br>` remains a line break. `note-layout.ts` places
Notes outside surrounding paragraphs, including table cells and inline formatting.
