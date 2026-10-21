# Export

`to-markdown.ts` converts Confluence storage to native Markdown or faithful fallbacks.
draw.io keeps the XML attachment name, PNG preview and viewer parameters.
Search Results preserves the space reference and all query parameters as native syntax.
Paragraphs containing only adjacent native macros keep their order and lose only the
redundant paragraph wrapper; this is reported as a normalized conversion.
`export-page.ts` downloads the referenced attachments. `canonical.ts` and `roundtrip.ts`
verify semantic equivalence; `xhtml.ts` parses storage without losing namespaced elements.

Structurizr preview filenames restore native references, DSL and JSON attachments.
Image formatting and native Data Center captions survive Structurizr/draw.io conversion.
Quoted image values preserve separators, braces and links inside GFM tables.

`links.ts` collects and rewrites ordinary/native page links after batch destinations
are allocated. Code and macro parameters stay intact; rich labels and anchors survive.
`storageToMarkdown` and `exportPage` accept `linkResolver` for reverse mapping.
Table macro containers preserve SQL and every parameter, including empty values.
Styled tables normalize to editable GFM only after comparing normalized cells and
the surrounding macro structure; native user references preserve mention identities.

Cell/in-paragraph Notes export as `{{note:"Markdown body"|title=…|icon=false}}`.
Standalone Notes retain block admonitions. Complex cell Note bodies preserve faithful
storage fences in both modes, rather than silently losing structure or highlighting.
