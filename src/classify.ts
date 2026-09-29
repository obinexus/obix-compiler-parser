/**
 * Turns what the official Vue SFC parser reports into OBIX diagnostics: an OBIX-OWNED code and, beside it, what Vue said as upstream metadata.
 *
 * The official parser reports two kinds of error:
 *   - errors of its template parser (`@vue/compiler-core`): a numeric `code` from Vue's `ErrorCodes` enum and a location;
 *   - structural errors of the SFC itself, plain `SyntaxError`s with a message (and sometimes a location) but no code.
 *
 * An OBIX code never contains a Vue number or a Vue name and is never computed from a Vue enum (D-50). For the first kind a table maps the NAME of the upstream
 * member to an OBIX code (`X_MISSING_END_TAG` → `OBIX_SFC_ELEMENT_END_TAG_MISSING`), so a Vue release that renumbers or reorders its enum cannot change what a
 * consumer of OBIX sees; the number matters in one place only — telling which enum it belongs to (`UpstreamVocabulary`). For the second kind the exact message is
 * matched: the version of the official compiler is pinned (obix-vue.json), so a new or reworded message is caught by the corpus tests and lands in the reserved
 * `OBIX_SFC_UNCLASSIFIED` until it is classified on purpose. Nothing is guessed and nothing is dropped: what Vue said travels as `upstream` — the reporter and its
 * version and, for an enum member, the enum, the member's name and its number.
 *
 * No cast is used: the shape of every value read from the official parser is checked where it is read.
 */
import type { ObixCompilerDiagnostic, ObixSourcePosition, ObixUpstreamEnum, ObixUpstreamError } from "obix-compiler-diagnostics";
import { officialCompiler, officialVersion } from "./vue.js";

/** The OBIX codes that are OBIX's own: the SFC-level errors of the official parser (matched by message), and the reserved fallback. */
export const OBIX_SFC_CODES = Object.freeze({
  duplicateTemplate: "OBIX_SFC_DUPLICATE_TEMPLATE",
  duplicateScript: "OBIX_SFC_DUPLICATE_SCRIPT",
  duplicateScriptSetup: "OBIX_SFC_DUPLICATE_SCRIPT_SETUP",
  templateFunctional: "OBIX_SFC_TEMPLATE_FUNCTIONAL",
  styleVars: "OBIX_SFC_STYLE_VARS",
  empty: "OBIX_SFC_EMPTY",
  scriptSetupSrc: "OBIX_SFC_SCRIPT_SETUP_SRC",
  scriptSrcWithSetup: "OBIX_SFC_SCRIPT_SRC_WITH_SETUP",
  /** Reserved: an upstream error this vocabulary does not know — a member added by a newer Vue, a transform-stage member, a compat key, a reworded message. */
  unclassified: "OBIX_SFC_UNCLASSIFIED",
} as const);

/**
 * Upstream member NAME → OBIX code: what the tokenizer and the parser report, and the invalid expression the SFC parser finds while it parses. The errors raised
 * while a template is TRANSFORMED belong to the template stage (`OBIX_TEMPLATE_*`). No number appears here.
 */
export const OBIX_SFC_UPSTREAM_CODES: Readonly<Record<string, string>> = Object.freeze({
  ABRUPT_CLOSING_OF_EMPTY_COMMENT: "OBIX_SFC_COMMENT_EMPTY_CLOSED_ABRUPTLY",
  CDATA_IN_HTML_CONTENT: "OBIX_SFC_CDATA_IN_HTML",
  DUPLICATE_ATTRIBUTE: "OBIX_SFC_ATTRIBUTE_DUPLICATE",
  END_TAG_WITH_ATTRIBUTES: "OBIX_SFC_END_TAG_HAS_ATTRIBUTES",
  END_TAG_WITH_TRAILING_SOLIDUS: "OBIX_SFC_END_TAG_HAS_SOLIDUS",
  EOF_BEFORE_TAG_NAME: "OBIX_SFC_TAG_NAME_MISSING_AT_END",
  EOF_IN_CDATA: "OBIX_SFC_CDATA_UNCLOSED",
  EOF_IN_COMMENT: "OBIX_SFC_COMMENT_UNCLOSED",
  EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT: "OBIX_SFC_SCRIPT_COMMENT_LIKE_TEXT_UNCLOSED",
  EOF_IN_TAG: "OBIX_SFC_TAG_UNCLOSED_AT_END",
  INCORRECTLY_CLOSED_COMMENT: "OBIX_SFC_COMMENT_CLOSED_INCORRECTLY",
  INCORRECTLY_OPENED_COMMENT: "OBIX_SFC_COMMENT_OPENED_INCORRECTLY",
  INVALID_FIRST_CHARACTER_OF_TAG_NAME: "OBIX_SFC_TAG_NAME_START_INVALID",
  MISSING_ATTRIBUTE_VALUE: "OBIX_SFC_ATTRIBUTE_VALUE_MISSING",
  MISSING_END_TAG_NAME: "OBIX_SFC_END_TAG_NAME_MISSING",
  MISSING_WHITESPACE_BETWEEN_ATTRIBUTES: "OBIX_SFC_ATTRIBUTE_SEPARATOR_MISSING",
  NESTED_COMMENT: "OBIX_SFC_COMMENT_NESTED",
  UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME: "OBIX_SFC_ATTRIBUTE_NAME_CHARACTER_UNEXPECTED",
  UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE: "OBIX_SFC_ATTRIBUTE_VALUE_CHARACTER_UNEXPECTED",
  UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME: "OBIX_SFC_ATTRIBUTE_NAME_STARTS_WITH_EQUALS",
  UNEXPECTED_NULL_CHARACTER: "OBIX_SFC_NULL_CHARACTER_UNEXPECTED",
  UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME: "OBIX_SFC_TAG_NAME_IS_QUESTION_MARK",
  UNEXPECTED_SOLIDUS_IN_TAG: "OBIX_SFC_TAG_SOLIDUS_UNEXPECTED",
  X_INVALID_END_TAG: "OBIX_SFC_END_TAG_INVALID",
  X_MISSING_END_TAG: "OBIX_SFC_ELEMENT_END_TAG_MISSING",
  X_MISSING_INTERPOLATION_END: "OBIX_SFC_INTERPOLATION_UNCLOSED",
  X_MISSING_DIRECTIVE_NAME: "OBIX_SFC_DIRECTIVE_NAME_MISSING",
  X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END: "OBIX_SFC_DYNAMIC_ARGUMENT_UNCLOSED",
  X_INVALID_EXPRESSION: "OBIX_SFC_EXPRESSION_INVALID",
});

const BY_MESSAGE: readonly (readonly [RegExp, string])[] = [
  [/^Single file component can contain only one <template> element$/, OBIX_SFC_CODES.duplicateTemplate],
  [/^Single file component can contain only one <script> element$/, OBIX_SFC_CODES.duplicateScript],
  [/^Single file component can contain only one <script setup> element$/, OBIX_SFC_CODES.duplicateScriptSetup],
  [/^<template functional> is no longer supported in Vue 3\b/, OBIX_SFC_CODES.templateFunctional],
  [/^<style vars> has been replaced by a new proposal\b/, OBIX_SFC_CODES.styleVars],
  [/^At least one <template> or <script> is required in a single file component\./, OBIX_SFC_CODES.empty],
  [/^<script setup> cannot use the "src" attribute\b/, OBIX_SFC_CODES.scriptSetupSrc],
  [/^<script> cannot use the "src" attribute when <script setup> is also present\b/, OBIX_SFC_CODES.scriptSrcWithSetup],
];

// ── the upstream vocabulary ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface UpstreamMember {
  /** The enum a numeric code belongs to: the DOM compiler's codes continue where the core's end. */
  readonly enumName: "ErrorCodes" | "DOMErrorCodes";
  /** The member's name, or `null` when the enum has no member for the number or this stage has no vocabulary for that enum. */
  readonly name: string | null;
}

/** The one seam through which a Vue NUMBER is read. A test can renumber it and show that no OBIX code moves. */
export interface UpstreamVocabulary {
  memberOf(code: number): UpstreamMember;
}

/**
 * The parse stage reports members of the CORE enum only. From the enum's own end marker (`__EXTEND_POINT__`) on, a number belongs to the DOM compiler's enum, whose
 * members are the template stage's vocabulary and are named nowhere here.
 */
export const officialVocabulary: UpstreamVocabulary = Object.freeze({
  memberOf(code: number): UpstreamMember {
    const { ErrorCodes } = officialCompiler();
    if (code >= ErrorCodes.__EXTEND_POINT__) return { enumName: "DOMErrorCodes", name: null };
    const name: string | undefined = ErrorCodes[code];
    return { enumName: "ErrorCodes", name: name ?? null };
  },
});

export interface Classified {
  readonly obixCode: string;
  readonly upstream: ObixUpstreamError;
}

const upstreamOf = (enumName: ObixUpstreamEnum | null, name: string | null, code: number | string | null): ObixUpstreamError =>
  Object.freeze({ package: "@vue/compiler-sfc", version: officialVersion, enum: enumName, name, code });

/** The OBIX code and the upstream identity of one upstream code: a number of Vue's enums, or the string key of a compat deprecation. */
export function classify(code: number | string, vocabulary: UpstreamVocabulary = officialVocabulary): Classified {
  if (typeof code === "string") return { obixCode: OBIX_SFC_CODES.unclassified, upstream: upstreamOf("CompilerDeprecationTypes", code, code) };
  const { enumName, name } = vocabulary.memberOf(code);
  const owned = name !== null && Object.hasOwn(OBIX_SFC_UPSTREAM_CODES, name) ? OBIX_SFC_UPSTREAM_CODES[name] : undefined;
  return { obixCode: owned ?? OBIX_SFC_CODES.unclassified, upstream: upstreamOf(enumName, name, code) };
}

/** A plain `SyntaxError` of the SFC parser has a message and no code: the exact message decides, and only the reporter is upstream metadata. */
function classifyMessage(message: string): Classified {
  const upstream = upstreamOf(null, null, null);
  for (const [pattern, obixCode] of BY_MESSAGE) if (pattern.test(message)) return { obixCode, upstream };
  return { obixCode: OBIX_SFC_CODES.unclassified, upstream };
}

// ── the diagnostic ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function readPosition(value: unknown): ObixSourcePosition | undefined {
  if (!isRecord(value)) return undefined;
  const { line, column, offset } = value;
  if (typeof line !== "number" || typeof column !== "number" || typeof offset !== "number") return undefined;
  return Object.freeze({ line, column, offset });
}

/** The official parser attaches `loc` to some errors and not to others; both a missing and a malformed `loc` become "no position". */
function readRange(error: unknown): { start: ObixSourcePosition; end: ObixSourcePosition } | undefined {
  if (!isRecord(error) || !isRecord(error["loc"])) return undefined;
  const start = readPosition(error["loc"]["start"]);
  const end = readPosition(error["loc"]["end"]);
  return start && end ? { start, end } : undefined;
}

/** One error of the official SFC parser as a frozen OBIX diagnostic (severity `error`: the official parser reports no warnings at this layer). */
export function toDiagnostic(error: Error, filename: string): ObixCompilerDiagnostic {
  const upstreamCode: unknown = isRecord(error) ? error["code"] : undefined;
  const { obixCode, upstream } =
    typeof upstreamCode === "number" || (typeof upstreamCode === "string" && upstreamCode !== "") ? classify(upstreamCode) : classifyMessage(error.message);
  const range = readRange(error);
  return Object.freeze({
    code: obixCode,
    message: error.message,
    severity: "error" as const,
    filename,
    ...(range ? { start: range.start, end: range.end } : {}),
    upstream,
  });
}
