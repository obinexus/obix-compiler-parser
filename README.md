# obix-compiler-parser

> Previous name: `@obinexusltd/obix-compiler-parser` — OBIX packages are named without an npm scope since decision D-102 (2026-09-29); the package, its version and its exports are unchanged.

**The `.obix` VueTS parser — the official Vue SFC parser behind `parseObix` / `parseVueReference`.**

`.obix` source is Vue-compatible single-file-component source (`<script setup lang="ts">`, `<template>`, `<style scoped>`, custom blocks). The only parser is the official one, `@vue/compiler-sfc`, pinned at exactly **3.5.43** by `obix-vue.json` (OBIX monorepo record). There is no OBIX grammar here, no regular expression over the source, no second parser and no copy of Vue code.

```bash
npm install obix-compiler-parser
```

```ts
import { parseObix, parseVueReference } from "obix-compiler-parser";

const result = parseObix(source, "Counter.obix");
result.descriptor;   // the official Vue SFC descriptor (a frontend artefact — read-only)
result.diagnostics;  // frozen; [] for a valid SFC
// → { code: "OBIX_SFC_ELEMENT_END_TAG_MISSING", message: "Element is missing end tag.", severity: "error",
//     filename: "Counter.obix", start: { line: 2, column: 3, offset: 13 }, end: { … },
//     upstream: { package: "@vue/compiler-sfc", version: "3.5.43", enum: "ErrorCodes", name: "X_MISSING_END_TAG", code: 24 } }

parseVueReference(source, "Counter.vue"); // the same parser, for the .vue reference path of the equivalence tests
```

| Export | Role |
|---|---|
| `parseObix(source, filename)` | parse `.obix` source; `filename` must end in `.obix` |
| `parseVueReference(source, filename)` | parse `.vue` source with the same official parser; `filename` must end in `.vue` |
| `vueCompilerVersion` | the version of the official compiler wrapped (asserted to be 3.5.43) |
| `OBIX_SFC_CODES` | the OBIX codes of the SFC-level errors, and the reserved `OBIX_SFC_UNCLASSIFIED` |
| `OBIX_SFC_UPSTREAM_CODES` | the OBIX code of every error of Vue's template parser, keyed by the NAME of the upstream member |
| types | `ObixParseResult`, `ObixSourceSyntax` — the diagnostic types (`ObixCompilerDiagnostic`, `ObixDiagnosticSeverity`, `ObixSourcePosition`, `ObixUpstreamError`, …) and `positionAt` are the frontend-neutral contract's, in `obix-compiler-diagnostics` (moved there in Phase 4 without a change of meaning) |

Misuse (a non-string source, a filename with the wrong extension) throws a `TypeError`. A **bad SFC is never an exception**: it is a diagnostic.

## Diagnostics

Every error of the official parser becomes an `ObixCompilerDiagnostic` (the type of `obix-compiler-diagnostics`) — same order, same message, same place (1-based `line` / `column`, and `offset`) — under an **OBIX-owned code** instead of Vue's raw message, and with what Vue said kept beside it as **`upstream` metadata**:

```ts
upstream: { package: "@vue/compiler-sfc", version: "3.5.43", enum: "ErrorCodes", name: "X_MISSING_END_TAG", code: 24 }
```

An OBIX code never contains a Vue number or a Vue name and is never computed from a Vue enum (D-50): a table maps the *name* of the upstream member to the OBIX code, so a Vue release that renumbers or reorders its enum cannot change what a consumer of OBIX sees — only the metadata moves. The Vue number is read in one place (`UpstreamVocabulary`, to tell which enum it belongs to), and a test renumbers it. An error the parser reports as plain text (a `SyntaxError` with no code) is matched by its exact message and carries only the reporter in `upstream` (`enum`, `name` and `code` are `null`).

| Code | Meaning |
|---|---|
| `OBIX_SFC_ELEMENT_END_TAG_MISSING` · `_END_TAG_INVALID` · `_END_TAG_NAME_MISSING` · `_END_TAG_HAS_ATTRIBUTES` · `_END_TAG_HAS_SOLIDUS` | element end tags |
| `OBIX_SFC_TAG_NAME_START_INVALID` · `_TAG_NAME_IS_QUESTION_MARK` · `_TAG_NAME_MISSING_AT_END` · `_TAG_UNCLOSED_AT_END` · `_TAG_SOLIDUS_UNEXPECTED` | tag names and tags |
| `OBIX_SFC_ATTRIBUTE_DUPLICATE` · `_ATTRIBUTE_VALUE_MISSING` · `_ATTRIBUTE_VALUE_CHARACTER_UNEXPECTED` · `_ATTRIBUTE_NAME_CHARACTER_UNEXPECTED` · `_ATTRIBUTE_NAME_STARTS_WITH_EQUALS` · `_ATTRIBUTE_SEPARATOR_MISSING` | attributes |
| `OBIX_SFC_COMMENT_UNCLOSED` · `_COMMENT_NESTED` · `_COMMENT_CLOSED_INCORRECTLY` · `_COMMENT_OPENED_INCORRECTLY` · `_COMMENT_EMPTY_CLOSED_ABRUPTLY` · `_CDATA_IN_HTML` · `_CDATA_UNCLOSED` · `_SCRIPT_COMMENT_LIKE_TEXT_UNCLOSED` · `_NULL_CHARACTER_UNEXPECTED` | comments, CDATA and characters |
| `OBIX_SFC_INTERPOLATION_UNCLOSED` · `_DIRECTIVE_NAME_MISSING` · `_DYNAMIC_ARGUMENT_UNCLOSED` · `_EXPRESSION_INVALID` | interpolation and directives (the invalid expression is found by the parser because it parses expressions with Babel) |
| `OBIX_SFC_DUPLICATE_TEMPLATE` · `_SCRIPT` · `_SCRIPT_SETUP` | more than one `<template>`, `<script>` or `<script setup>` |
| `OBIX_SFC_EMPTY` | no `<template>` and no `<script>` |
| `OBIX_SFC_SCRIPT_SETUP_SRC` · `OBIX_SFC_SCRIPT_SRC_WITH_SETUP` | a `src` attribute the official parser refuses next to `<script setup>` |
| `OBIX_SFC_TEMPLATE_FUNCTIONAL` · `OBIX_SFC_STYLE_VARS` | `<template functional>` and `<style vars>`, both removed from Vue 3 |
| `OBIX_SFC_UNCLASSIFIED` | reserved: an upstream error this vocabulary does not know (a member added by a newer Vue, a transform-stage member, a compat key, a reworded message) — reported with its upstream identity, never guessed. The corpus tests fail if anything they produce lands here |

`ObixCompilerDiagnostic` is the one shape of every stage. Beside `upstream`, it carries the optional **`detail`** (the raw text of the exception behind a diagnostic, kept out of `message` where it depends on the build of the official compiler or carries the file name) and **`space`**: absent or `"source"` — `start` / `end` index into the SFC source, file-absolute, as the SFC, template and script stages report them — or `"generated"`, for the TypeScript phase, whose places index into the generated code it was given. The upstream identity can name Vue's enums, a compat deprecation key, Babel's reason codes (reported through the script compiler) or TypeScript's diagnostics.

The errors raised while a template is *transformed* are the template stage's (`OBIX_TEMPLATE_*`, [`obix-compiler-template`](https://github.com/obinexus/obix-compiler-template)); `npm run test:vuets` states from the outside that the two stages together classify every member of Vue's enums and claim no OBIX code twice.

## What this package does not do

* It does not compile: no template, script, TypeScript, style or directive handling (later phases).
* It does not touch import specifiers: `import { ref } from "obix"` stays exactly as written. Resolving the `obix` authoring alias is a later phase and never a string replacement.
* It does not tell Level-0 `.obix` source from the new syntax: a Level-0 file (`{n}`, `on:click`, `obix:if`) is a structurally valid SFC and gets no diagnostic here. Detecting and converting it is the job of the future `obix migrate`.
* The official parser ignores text outside the blocks, empty blocks, and a `<script>` / `<script setup>` language mismatch without a diagnostic; the tests assert that, so a change is a conscious decision.

The Level-0 parser is a different package: [`obix-compiler-legacy-parser`](https://github.com/obinexus/obix-compiler-legacy-parser), a frozen compatibility track. Nothing here imports it.

## Dependency role

Depends on `@vue/compiler-sfc` (the parser) and `@vue/compiler-core` (its error-code table), both exactly 3.5.43 — the only Vue-family dependency of the workspace so far, listed in `obix-vue.json` with its phase and reason. Consumed by `obix-compiler-sfc`. A compile-time package: it never belongs in a browser bundle (graph rule R5).

**The official compiler is loaded on the first parse, not at import.** Its own initialisation probes a browser global (`self`), and importing an OBIX package must read none (`npm run check:purity`, and a test that imports this package with every browser global trapped). Only the version — read from its `package.json` — is available before the first parse.

## Tests

`npm test -w obix-compiler-parser` — every expectation is computed by calling the official parser directly, never by calling this package twice. Corpus: `tests/corpus/vuets` (OBIX monorepo record) (byte-identical `.vue` / `.obix` pairs).

<!-- obix-release:begin — generated by scripts/release/prepare.mjs; edit the text above this line -->

## Installation

```bash
npm install obix-compiler-parser
```

## API surface

- `obix-compiler-parser` — 5 value exports: `OBIX_SFC_CODES`, `OBIX_SFC_UPSTREAM_CODES`, `parseObix`, `parseVueReference`, `vueCompilerVersion`
- Type declarations: `./dist/index.d.ts` (and a declaration next to every JS entry point).

## Architecture role

`obix-compiler-parser` is part of the **OBIX compiler** (build-time tooling): it never runs in an application's browser graph.

The architecture of OBIX — the package families and which packages are public API — is indexed in the umbrella: [docs/architecture.md](https://github.com/obinexus/obix/blob/main/docs/architecture.md).

## Package relationships

- Depends on (OBIX): [`obix-compiler-diagnostics`](https://github.com/obinexus/obix-compiler-diagnostics).
- Used by (OBIX): [`obix-compiler-sfc`](https://github.com/obinexus/obix-compiler-sfc).
- Third-party: `@vue/compiler-core`, `@vue/compiler-sfc`.

## Testing

- 1 test file ships in the npm package (`test/`): the evidence of the package's contract, published so that its verification can be inspected — not runtime code (no entry point reaches it).
- **Standalone**: none.
- **Need the OBIX development / test harness**: 1 — it reads the OBIX monorepo's shared harness, oracles or fixtures, so it does **not** run from an npm install or from this package's repository alone; it is shipped for inspection and provenance:
  - `test/parse.test.mjs` — its code reads a monorepo location (path.join(PACKAGE, '..', '..', 'tests', 'corpus…)
- Run them with `npm test` (`node --test "test/*.test.mjs"`) in the OBIX monorepo, which provides the test tooling (Node's test runner, TypeScript) and the harness.

## Documentation

- [CHANGELOG.md](CHANGELOG.md)
- The OBIX architecture index: [obix/docs/architecture.md](https://github.com/obinexus/obix/blob/main/docs/architecture.md)

## Repository

- https://github.com/obinexus/obix-compiler-parser — `git@github.com:obinexus/obix-compiler-parser.git`
- Issues: https://github.com/obinexus/obix-compiler-parser/issues
- The repository is a clean export of the package from the OBIX monorepo. Its lineage — the sources it was recovered from and its earlier names — is `PROVENANCE.json`, shipped in this package; the repository's copy also records the monorepo commit it was exported from.

## License

MIT — see [LICENSE](LICENSE).

<!-- obix-release:end -->
