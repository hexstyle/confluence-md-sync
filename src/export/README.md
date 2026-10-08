# Export

`to-markdown.ts` converts Confluence storage to native Markdown or faithful fallbacks.
draw.io keeps the XML attachment name, PNG preview and viewer parameters.
Search Results preserves the space reference and all query parameters as native syntax.
Paragraphs containing only adjacent native macros keep their order and lose only the
redundant paragraph wrapper; this is reported as a normalized conversion.
`export-page.ts` downloads the referenced attachments. `canonical.ts` and `roundtrip.ts`
verify semantic equivalence; `xhtml.ts` parses storage without losing namespaced elements.

Structurizr preview filenames restore native references, DSL and JSON attachments.

`links.ts` collects and rewrites ordinary/native page links after batch destinations
are allocated. Code and macro parameters stay intact; rich labels and anchors survive.
`storageToMarkdown` and `exportPage` accept `linkResolver` for reverse mapping.
