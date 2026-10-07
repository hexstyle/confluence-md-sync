# Confluence client

`client.ts` handles pages, properties, attachments and labels. XML draw.io attachments
use application/vnd.jgraph.mxfile, including names without extensions; PNG keeps its
image/png media type. This allows a published image to be imported as an editable diagram.
`config.ts` supplies authentication and environment configuration.
