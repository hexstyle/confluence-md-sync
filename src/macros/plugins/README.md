# Macro plugins — how to add a Confluence macro

Each Confluence macro lives as **one file in this folder** (`src/macros/plugins/<name>.ts`).
A macro can travel in up to three directions; wire the ones it needs:

| Direction | What | Where |
| --- | --- | --- |
| **render** (md → storage) | marker `<!-- MACRO:start:name … -->` → `<ac:structured-macro>` | this file: a `MacroPlugin` with a `render(ctx)` + a `macros.<name>` builder |
| **author** (native md → marker) | `{{name:…}}` / `> [!X]` / `::: name` written by a human | `../../markdown/native.ts` |
| **export** (storage → md) | `<ac:structured-macro>` → native `{{name:…}}` on round-trip | `../export/to-markdown.ts` |

## Steps

1. **Create `plugins/<name>.ts`** — export a `MacroPlugin` (the `render` builds storage via
   `structuredMacro(name, ctx.macroId, { params })`) and a convenience builder returning `Markdown`
   (via `macro('<name>').param(...)`). Model on [`csv-table.ts`](csv-table.ts) (bodyless w/ attachment)
   or [`portfolio-for-jira-plan.ts`](portfolio-for-jira-plan.ts) (bodyless w/ params).
2. **Register in [`../index.ts`](../index.ts)** — `export … from './plugins/<name>.js'`, add
   `.use(<name>Plugin)` in `createDefaultRegistry()`, and add the builder to the `macros` namespace.
   This is what makes the publisher (docs-studio) actually render the macro.
3. **(optional) Native md syntax** — if authors should write it as `{{name:…}}`:
   - `native.ts`: add to `NATIVE_PLACEHOLDERS`, `nativeMacroList()`, and the `PLACEHOLDER_INLINE_RE`
     alternation (block macros use `NATIVE_DIRECTIVES`/`NATIVE_ADMONITIONS` instead).
   - `../export/to-markdown.ts`: add to `NATIVE_PLACEHOLDER_NAME` so export emits `{{name:…}}`
     instead of a raw ` ```confluence-storage ` fence.
4. **Test** — add a round-trip test (`tests/native.test.ts`) and/or a render test (`tests/macros.test.ts`),
   then `npm run build && npm test`.

## Rules

- **No raw `<ac:…>` in authored markdown.** Verbatim storage falls back to a ` ```confluence-storage `
  fence ("published as-is"); the point of a plugin is to replace that with supported `{{…}}` syntax.
- **Stable param order** in `render` (fixed array), so the content-hash doesn't churn between runs.
- **Params via `paramMap(ctx.params)`**; escape/encode is handled by `structuredMacro`.
- Keep the macro's three directions **round-trippable**: export → native md → render → storage must
  canonically match the original (the export verifies this before emitting native syntax).
