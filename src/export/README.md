# Export

`to-markdown.ts` converts Confluence storage to native Markdown or faithful fallbacks.
draw.io keeps the XML attachment name, PNG preview and viewer parameters.
Search Results preserves the space reference and all query parameters as native syntax.
`export-page.ts` downloads the referenced attachments. `canonical.ts` and `roundtrip.ts`
verify semantic equivalence; `xhtml.ts` parses storage without losing namespaced elements.
