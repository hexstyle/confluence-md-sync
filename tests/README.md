# Tests

`npm test` runs Vitest. Native macro tests check storage round trips. Publish tests use
a local HTTP server and verify idempotency. draw.io tests cover native/image publishing,
extensionless XML attachments, parameters and missing dependency validation.
Search tests preserve structured space references and quoted template queries.

Structurizr tests cover PNG rendering, editable import and attachment validation.
