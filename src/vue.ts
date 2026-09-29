/**
 * The one place that loads the official Vue compiler — and it does so on FIRST USE, not at import.
 *
 * Why: the official `@vue/compiler-sfc` bundles a lodash that probes a browser global while it loads (`typeof self` at module initialisation). That is harmless
 * in Node, but importing an OBIX compiler package must read no browser global at all (directive, Bottleneck C: compile-time, server-runtime and
 * browser-runtime are distinct, and a server-safe module must import in Node without `window`, `document` or `self`). A static `import` would run the probe
 * as soon as this package is imported; loading on the first parse keeps the import pure and moves the official compiler's own initialisation to where it is
 * actually needed. `npm run check:purity` enforces the import; the parser's tests enforce the first use.
 *
 * What is read without executing any of the compiler's code: its version, from its package.json.
 */
import { createRequire } from "node:module";
import type { ErrorCodes } from "@vue/compiler-core";
import type * as Sfc from "@vue/compiler-sfc";

export interface OfficialCompiler {
  readonly parse: typeof Sfc.parse;
  readonly version: string;
  /** Vue's error-code enum (an object with reverse mapping): read only to name an upstream code as metadata — an OBIX code is never derived from it (D-50). */
  readonly ErrorCodes: typeof ErrorCodes;
}

const requireOfficial = createRequire(import.meta.url);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isSfcModule(value: unknown): value is Pick<typeof Sfc, "parse" | "version"> {
  return isRecord(value) && typeof value["parse"] === "function" && typeof value["version"] === "string";
}

function isCoreModule(value: unknown): value is { readonly ErrorCodes: typeof ErrorCodes } {
  return isRecord(value) && isRecord(value["ErrorCodes"]);
}

/** The version of the official compiler, read from its package.json (which executes none of its code). */
function readVersion(): string {
  const manifest: unknown = requireOfficial("@vue/compiler-sfc/package.json");
  if (!isRecord(manifest) || typeof manifest["version"] !== "string") throw new Error("@vue/compiler-sfc/package.json has no version");
  return manifest["version"];
}

export const officialVersion: string = readVersion();

let loaded: OfficialCompiler | undefined;

/** Loads `@vue/compiler-sfc` and `@vue/compiler-core` the first time it is called; the same frozen object afterwards. */
export function officialCompiler(): OfficialCompiler {
  if (loaded) return loaded;
  const sfc: unknown = requireOfficial("@vue/compiler-sfc");
  const core: unknown = requireOfficial("@vue/compiler-core");
  if (!isSfcModule(sfc)) throw new Error("@vue/compiler-sfc does not export parse and version");
  if (!isCoreModule(core)) throw new Error("@vue/compiler-core does not export ErrorCodes");
  loaded = Object.freeze({ parse: sfc.parse, version: sfc.version, ErrorCodes: core.ErrorCodes });
  return loaded;
}
