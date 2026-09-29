/**
 * obix-compiler-parser — the `.obix` VueTS parser (Phase 1 of the VueTS compiler recovery, docs/recovery/vuets-compiler.md).
 *
 * `.obix` source is Vue-compatible single-file-component source, and the only parser is the OFFICIAL one, `@vue/compiler-sfc` (pinned at exactly 3.5.43
 * by obix-vue.json). There is no OBIX grammar here, no regular expression over the source, no second parser and no copy of Vue code:
 *
 *     Counter.obix  →  official Vue SFC parser  →  Vue-compatible descriptor  (+ OBIX diagnostics)
 *
 * The official compiler is loaded on the FIRST PARSE, not at import (see vue.ts): importing this package reads no browser global.
 *
 * The descriptor is a frontend artefact. It is NOT the semantic authority of OBIX — the canonical DOP IR is (D-44) — and the canonical SFC boundary that
 * later stages consume is `obix-compiler-sfc`. Import specifiers (`from "obix"`) are left exactly as written; resolving that authoring alias is
 * a later phase and is never a string replacement.
 *
 * The diagnostic contract — `ObixCompilerDiagnostic`, the positions, `positionAt`, the upstream metadata — is NOT owned here: it lives in the frontend-neutral
 * `obix-compiler-diagnostics` (Phase 4 prelude), which this package depends on. What this package owns is the OBIX SFC codes.
 *
 * This package is NOT the Level-0 parser: that one is `obix-compiler-legacy-parser`, a frozen compatibility track (D-46), and nothing here
 * imports it.
 */
import type { SFCDescriptor } from "@vue/compiler-sfc";
import type { ObixCompilerDiagnostic } from "obix-compiler-diagnostics";
import { toDiagnostic } from "./classify.js";
import { officialCompiler, officialVersion } from "./vue.js";

export { OBIX_SFC_CODES, OBIX_SFC_UPSTREAM_CODES } from "./classify.js";

/** Which entry point parsed the source: `.obix` authoring source, or a `.vue` file parsed as the semantic reference. */
export type ObixSourceSyntax = "obix" | "vue-reference";

export interface ObixParseResult {
  readonly syntax: ObixSourceSyntax;
  readonly filename: string;
  readonly source: string;
  /**
   * The official parser's descriptor for this source and filename. The official parser caches by source and options, so this object may be shared between
   * calls that agree on both: treat it as read-only.
   */
  readonly descriptor: SFCDescriptor;
  /** Frozen. Every error of the official parser, in its order, under a stable OBIX code. Empty for a valid SFC. */
  readonly diagnostics: readonly ObixCompilerDiagnostic[];
}

/** The version of the official Vue compiler this parser wraps. The contract (obix-vue.json) pins it exactly; the tests assert it. */
export const vueCompilerVersion: string = officialVersion;

/**
 * Explicit, so that the output never depends on what the official defaults happen to be: no source maps (the output is deterministic data), empty blocks
 * are ignored as in Vue, and blocks are not padded (line and column stay those of the source).
 */
const OFFICIAL_OPTIONS = { sourceMap: false, ignoreEmpty: true, pad: false } as const;

function parseWith(syntax: ObixSourceSyntax, entry: string, extension: string, source: unknown, filename: unknown): ObixParseResult {
  if (typeof source !== "string") throw new TypeError(`${entry}: source must be a string, received ${source === null ? "null" : typeof source}`);
  if (typeof filename !== "string" || filename.length <= extension.length || !filename.endsWith(extension)) {
    throw new TypeError(`${entry} expects a ${extension} filename, received ${JSON.stringify(filename)}`);
  }
  const { descriptor, errors } = officialCompiler().parse(source, { ...OFFICIAL_OPTIONS, filename });
  const diagnostics = Object.freeze(errors.map((error) => toDiagnostic(error, filename)));
  return Object.freeze({ syntax, filename, source, descriptor, diagnostics });
}

/** Parse `.obix` source (Vue-compatible SFC source) with the official Vue SFC parser. The filename must end in `.obix`. */
export function parseObix(source: string, filename: string): ObixParseResult {
  return parseWith("obix", "parseObix", ".obix", source, filename);
}

/** Parse `.vue` source with the official Vue SFC parser: the reference path of the equivalence tests. The filename must end in `.vue`. */
export function parseVueReference(source: string, filename: string): ObixParseResult {
  return parseWith("vue-reference", "parseVueReference", ".vue", source, filename);
}
