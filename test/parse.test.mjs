/**
 * obix-compiler-parser — Phase 1 of the VueTS compiler recovery (docs/recovery/vuets-compiler.md).
 *
 * `.obix` source is Vue-compatible SFC source, and the ONLY parser is the official one (@vue/compiler-sfc, pinned at 3.5.43). These tests hold
 * parseObix / parseVueReference to that: every expectation below is computed by calling the official parser DIRECTLY in this file — never by calling
 * the package under test twice — so a wrapper that quietly altered, dropped or invented anything cannot agree with itself.
 *
 * Written before the implementation (RED), then satisfied (GREEN). The corpus is tests/corpus/vuets: every fixture is a byte-identical pair
 * Foo.vue / Foo.obix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as vueParse, version as sfcVersion } from '@vue/compiler-sfc';
import { ErrorCodes } from '@vue/compiler-core';
import { positionAt } from 'obix-compiler-diagnostics';
import { parseObix, parseVueReference, vueCompilerVersion, OBIX_SFC_CODES, OBIX_SFC_UPSTREAM_CODES } from '../dist/index.js';
import { classify, officialVocabulary, toDiagnostic } from '../dist/classify.js';

const PACKAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(PACKAGE, '..', '..', 'tests', 'corpus', 'vuets');
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const read = (id, file) => fs.readFileSync(path.join(CORPUS, id, file), 'utf8');

// ── the independent reference: a projection of the OFFICIAL parser's own output ─────────────────────────────────────────────────────────────
const pos = (p) => ({ offset: p.offset, line: p.line, column: p.column });
const blockOf = (b) => (b ? { type: b.type, content: b.content, attrs: { ...b.attrs }, lang: b.lang ?? null, src: b.src ?? null, start: pos(b.loc.start), end: pos(b.loc.end) } : null);
const projectDescriptor = (d) => ({
  filename: d.filename,
  source: d.source,
  template: blockOf(d.template),
  script: d.script ? { ...blockOf(d.script), setup: d.script.setup ?? false } : null,
  scriptSetup: d.scriptSetup ? { ...blockOf(d.scriptSetup), setup: d.scriptSetup.setup ?? false } : null,
  styles: d.styles.map((s) => ({ ...blockOf(s), scoped: !!s.scoped, module: s.module ?? false })),
  customBlocks: d.customBlocks.map(blockOf),
  cssVars: [...d.cssVars],
  slotted: d.slotted,
});
const official = (source, filename) => vueParse(source, { filename, sourceMap: false, ignoreEmpty: true, pad: false });
const parsers = [['parseObix', parseObix, 'obix', '.obix', 'obix'], ['parseVueReference', parseVueReference, 'vue-reference', '.vue', 'vue']];

// ── the surface ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the module exposes parseObix, parseVueReference and the version of the official compiler it wraps — the pinned 3.5.43', () => {
  assert.equal(typeof parseObix, 'function');
  assert.equal(typeof parseVueReference, 'function');
  assert.equal(vueCompilerVersion, sfcVersion);
  assert.equal(vueCompilerVersion, '3.5.43');
});

test('SSR boundary (directive, Bottleneck C): importing the package reads no browser global — the official compiler is loaded on first use — and parsing then works with the globals absent, as on a server', () => {
  const entry = pathToFileURL(path.join(PACKAGE, 'dist', 'index.js')).href;
  const script = `
    const names = ['window', 'self', 'document', 'HTMLElement', 'Element', 'MutationObserver', 'requestAnimationFrame'];
    const log = [];
    for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { log.push(n); throw new ReferenceError(n + ' is not defined (trap)'); } });
    const mod = await import(${JSON.stringify(entry)});
    const atImport = [...log];
    for (const n of names) delete globalThis[n];
    const r = mod.parseObix('<template><p>{{ a }}</p></template>', 'Pure.obix');
    const bad = mod.parseObix('<template><div></template>', 'Bad.obix');
    process.stdout.write('@@' + JSON.stringify({ atImport, template: !!r.descriptor.template, diagnostics: r.diagnostics.length, badCode: bad.diagnostics[0].code, version: mod.vueCompilerVersion }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const m = /@@(.*)$/s.exec(r.stdout ?? '');
  assert.ok(m, `the probe died: ${(r.stderr ?? '').slice(0, 400)}`);
  const out = JSON.parse(m[1]);
  assert.deepEqual(out.atImport, [], 'importing the package must not read any browser global');
  assert.deepEqual([out.template, out.diagnostics, out.badCode, out.version], [true, 0, 'OBIX_SFC_ELEMENT_END_TAG_MISSING', '3.5.43']);
});

test('the corpus is a set of byte-identical .vue / .obix pairs, every fixture is listed, and no directory is unlisted', () => {
  const listed = new Set(manifest.fixtures.map((f) => f.id));
  const onDisk = fs.readdirSync(CORPUS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.deepEqual([...onDisk].sort(), [...listed].sort());
  for (const f of manifest.fixtures) {
    const files = fs.readdirSync(path.join(CORPUS, f.id)).sort();
    assert.deepEqual(files, [`${f.name}.obix`, `${f.name}.vue`], f.id);
    assert.equal(read(f.id, `${f.name}.obix`), read(f.id, `${f.name}.vue`), `${f.id}: the pair must be byte-identical`);
  }
  assert.ok(manifest.fixtures.filter((f) => f.valid).length >= 20 && manifest.fixtures.filter((f) => !f.valid).length >= 8);
});

// ── canonical source ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

for (const [label, parser, syntax, ext] of parsers) {
  test(`${label} parses the canonical Counter of the directive: script setup lang="ts", template, scoped style, no diagnostics`, () => {
    const source = read('00-canonical-counter', `Counter${ext}`);
    const result = parser(source, `Counter${ext}`);
    assert.equal(result.syntax, syntax);
    assert.equal(result.filename, `Counter${ext}`);
    assert.equal(result.source, source);
    assert.deepEqual(result.diagnostics, []);
    const d = result.descriptor;
    assert.equal(d.filename, `Counter${ext}`);
    assert.equal(d.scriptSetup?.lang, 'ts');
    assert.equal(d.scriptSetup?.attrs.setup, true);
    assert.equal(d.script, null);
    assert.ok(d.template && d.template.content.includes('@click="decrement"'));
    assert.equal(d.styles.length, 1);
    assert.equal(d.styles[0].scoped, true);
  });
}

// ── faithfulness to the official parser (the oracle is called directly) ────────────────────────────────────────────────────────────────────

for (const [label, parser, , ext] of parsers) {
  test(`${label}: for every corpus fixture the descriptor IS what the official parser returns for that source and filename`, () => {
    for (const f of manifest.fixtures) {
      const source = read(f.id, `${f.name}${ext}`);
      const filename = `${f.name}${ext}`;
      // the official parser caches its result objects: take the reference as a plain SNAPSHOT before the code under test runs, so that a wrapper that altered the shared descriptor cannot agree with itself
      const expected = projectDescriptor(official(source, filename).descriptor);
      const got = parser(source, filename);
      assert.deepEqual(projectDescriptor(got.descriptor), expected, `${f.id}${ext}`);
    }
  });
}

test('the official parser\'s source maps are off: no block carries a `map`, so the output never depends on source-map generation', () => {
  const d = parseObix(read('00-canonical-counter', 'Counter.obix'), 'Counter.obix').descriptor;
  for (const b of [d.template, d.scriptSetup, ...d.styles, ...d.customBlocks]) if (b) assert.equal(b.map, undefined, b.type);
});

// ── diagnostics ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

for (const [label, parser, , ext] of parsers) {
  test(`${label}: valid fixtures report nothing; every invalid fixture reports exactly the official parser's errors — same order, messages and places — under the OBIX codes the manifest lists`, () => {
    for (const f of manifest.fixtures) {
      const source = read(f.id, `${f.name}${ext}`);
      const filename = `${f.name}${ext}`;
      const expected = official(source, filename).errors.map((e) => ({ message: e.message, code: e.code, loc: e.loc && { start: pos(e.loc.start), end: pos(e.loc.end) } })); // a snapshot, before the code under test runs
      const got = parser(source, filename).diagnostics;
      assert.equal(got.length, expected.length, `${f.id}${ext}: count`);
      assert.equal(f.valid, expected.length === 0, `${f.id}: the manifest agrees with the official parser`);
      expected.forEach((e, i) => {
        assert.equal(got[i].message, e.message, `${f.id}${ext}[${i}] message`);
        assert.equal(got[i].severity, 'error', `${f.id}${ext}[${i}] severity`);
        assert.equal(got[i].filename, filename, `${f.id}${ext}[${i}] filename`);
        assert.equal(got[i].code, f.diagnostics[i], `${f.id}${ext}[${i}] code`);
        // what Vue said travels beside the OBIX code as upstream metadata: the member of the official enum and its number for a template-parser error, nothing but the reporter for a plain SyntaxError
        const upstream = typeof e.code === 'number'
          ? { package: '@vue/compiler-sfc', version: '3.5.43', enum: 'ErrorCodes', name: ErrorCodes[e.code], code: e.code }
          : { package: '@vue/compiler-sfc', version: '3.5.43', enum: null, name: null, code: null };
        assert.deepEqual({ ...got[i].upstream }, upstream, `${f.id}${ext}[${i}] upstream`);
        assert.ok(Object.isFrozen(got[i].upstream), `${f.id}${ext}[${i}] upstream is frozen`);
        if (e.loc) {
          assert.deepEqual(got[i].start, e.loc.start, `${f.id}${ext}[${i}] start`);
          assert.deepEqual(got[i].end, e.loc.end, `${f.id}${ext}[${i}] end`);
        } else {
          assert.equal(got[i].start, undefined, `${f.id}${ext}[${i}] start`);
          assert.equal(got[i].end, undefined, `${f.id}${ext}[${i}] end`);
        }
      });
    }
  });
}

test('diagnostic codes are stable, namespaced identifiers — never the raw Vue message — and the "unclassified" fallback is not used by anything the corpus produces', () => {
  const seen = new Set();
  for (const f of manifest.fixtures.filter((x) => !x.valid)) for (const d of parseObix(read(f.id, `${f.name}.obix`), `${f.name}.obix`).diagnostics) { assert.match(d.code, /^OBIX_SFC_[A-Z0-9_]+$/); seen.add(d.code); }
  assert.ok(!seen.has('OBIX_SFC_UNCLASSIFIED'));
  assert.deepEqual([...seen].sort(), ['OBIX_SFC_DUPLICATE_SCRIPT', 'OBIX_SFC_DUPLICATE_SCRIPT_SETUP', 'OBIX_SFC_DUPLICATE_TEMPLATE', 'OBIX_SFC_EMPTY', 'OBIX_SFC_SCRIPT_SETUP_SRC', 'OBIX_SFC_SCRIPT_SRC_WITH_SETUP', 'OBIX_SFC_STYLE_VARS', 'OBIX_SFC_TEMPLATE_FUNCTIONAL', 'OBIX_SFC_ELEMENT_END_TAG_MISSING'].sort());
});

// ── the vocabulary: OBIX-owned codes, independent of Vue's numbers; Vue's names and codes travel as upstream metadata (D-50) ─────────────────────

/** The vocabulary is a DECISION, so it is stated here a second time, independently of the implementation's table: what the tokenizer and the parser report, and the invalid expression the SFC parser finds while it parses. */
const EXPECTED_TABLE = {
  ABRUPT_CLOSING_OF_EMPTY_COMMENT: 'OBIX_SFC_COMMENT_EMPTY_CLOSED_ABRUPTLY',
  CDATA_IN_HTML_CONTENT: 'OBIX_SFC_CDATA_IN_HTML',
  DUPLICATE_ATTRIBUTE: 'OBIX_SFC_ATTRIBUTE_DUPLICATE',
  END_TAG_WITH_ATTRIBUTES: 'OBIX_SFC_END_TAG_HAS_ATTRIBUTES',
  END_TAG_WITH_TRAILING_SOLIDUS: 'OBIX_SFC_END_TAG_HAS_SOLIDUS',
  EOF_BEFORE_TAG_NAME: 'OBIX_SFC_TAG_NAME_MISSING_AT_END',
  EOF_IN_CDATA: 'OBIX_SFC_CDATA_UNCLOSED',
  EOF_IN_COMMENT: 'OBIX_SFC_COMMENT_UNCLOSED',
  EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT: 'OBIX_SFC_SCRIPT_COMMENT_LIKE_TEXT_UNCLOSED',
  EOF_IN_TAG: 'OBIX_SFC_TAG_UNCLOSED_AT_END',
  INCORRECTLY_CLOSED_COMMENT: 'OBIX_SFC_COMMENT_CLOSED_INCORRECTLY',
  INCORRECTLY_OPENED_COMMENT: 'OBIX_SFC_COMMENT_OPENED_INCORRECTLY',
  INVALID_FIRST_CHARACTER_OF_TAG_NAME: 'OBIX_SFC_TAG_NAME_START_INVALID',
  MISSING_ATTRIBUTE_VALUE: 'OBIX_SFC_ATTRIBUTE_VALUE_MISSING',
  MISSING_END_TAG_NAME: 'OBIX_SFC_END_TAG_NAME_MISSING',
  MISSING_WHITESPACE_BETWEEN_ATTRIBUTES: 'OBIX_SFC_ATTRIBUTE_SEPARATOR_MISSING',
  NESTED_COMMENT: 'OBIX_SFC_COMMENT_NESTED',
  UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME: 'OBIX_SFC_ATTRIBUTE_NAME_CHARACTER_UNEXPECTED',
  UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE: 'OBIX_SFC_ATTRIBUTE_VALUE_CHARACTER_UNEXPECTED',
  UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME: 'OBIX_SFC_ATTRIBUTE_NAME_STARTS_WITH_EQUALS',
  UNEXPECTED_NULL_CHARACTER: 'OBIX_SFC_NULL_CHARACTER_UNEXPECTED',
  UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME: 'OBIX_SFC_TAG_NAME_IS_QUESTION_MARK',
  UNEXPECTED_SOLIDUS_IN_TAG: 'OBIX_SFC_TAG_SOLIDUS_UNEXPECTED',
  X_INVALID_END_TAG: 'OBIX_SFC_END_TAG_INVALID',
  X_MISSING_END_TAG: 'OBIX_SFC_ELEMENT_END_TAG_MISSING',
  X_MISSING_INTERPOLATION_END: 'OBIX_SFC_INTERPOLATION_UNCLOSED',
  X_MISSING_DIRECTIVE_NAME: 'OBIX_SFC_DIRECTIVE_NAME_MISSING',
  X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END: 'OBIX_SFC_DYNAMIC_ARGUMENT_UNCLOSED',
  X_INVALID_EXPRESSION: 'OBIX_SFC_EXPRESSION_INVALID',
};

test('the OBIX code table is exactly the stated vocabulary: the members the tokenizer and parser report, plus the invalid expression the SFC parser finds — and no digit, no Vue number, no `VUE` in any code', () => {
  assert.deepEqual({ ...OBIX_SFC_UPSTREAM_CODES }, EXPECTED_TABLE);
  assert.ok(Object.isFrozen(OBIX_SFC_UPSTREAM_CODES) && Object.isFrozen(OBIX_SFC_CODES));
  const codes = Object.values(EXPECTED_TABLE);
  assert.equal(new Set(codes).size, codes.length, 'one OBIX code per upstream member');
  for (const code of [...codes, ...Object.values(OBIX_SFC_CODES)]) {
    assert.match(code, /^OBIX_SFC_[A-Z_]+$/, `${code}: a namespaced word list`);
    assert.doesNotMatch(code, /VUE/, `${code}: OBIX-owned, not derived from Vue`);
  }
  // every name is a member of the official enum, and the parse-stage ones are exactly the members before the first transform-stage one
  for (const name of Object.keys(EXPECTED_TABLE)) assert.ok(name in ErrorCodes, name);
  const parseStage = Object.keys(ErrorCodes).filter((k) => Number.isNaN(Number(k)) && !k.startsWith('__') && ErrorCodes[k] < ErrorCodes.X_V_IF_NO_EXPRESSION);
  assert.deepEqual(parseStage.sort(), Object.keys(EXPECTED_TABLE).filter((k) => k !== 'X_INVALID_EXPRESSION').sort());
});

test('OBIX codes are independent of Vue\'s numbers: renumbering every upstream code changes the metadata and never the OBIX code', () => {
  const shift = 1000;
  const renumbered = { memberOf: (code) => officialVocabulary.memberOf(code - shift) };
  for (const [name, obixCode] of Object.entries(EXPECTED_TABLE)) {
    const real = classify(ErrorCodes[name]);
    const moved = classify(ErrorCodes[name] + shift, renumbered);
    assert.equal(real.obixCode, obixCode, name);
    assert.equal(moved.obixCode, obixCode, `${name} after renumbering`);
    assert.deepEqual([real.upstream.name, real.upstream.code], [name, ErrorCodes[name]], name);
    assert.deepEqual([moved.upstream.name, moved.upstream.code], [name, ErrorCodes[name] + shift], name);
  }
});

test('classify keeps the identity of every upstream code as metadata; what the vocabulary does not know is reserved, never guessed — and never carries a number into an OBIX code', () => {
  const known = classify(ErrorCodes.X_MISSING_END_TAG);
  assert.equal(known.obixCode, 'OBIX_SFC_ELEMENT_END_TAG_MISSING');
  assert.deepEqual({ ...known.upstream }, { package: '@vue/compiler-sfc', version: '3.5.43', enum: 'ErrorCodes', name: 'X_MISSING_END_TAG', code: ErrorCodes.X_MISSING_END_TAG });
  const reserved = OBIX_SFC_CODES.unclassified;
  for (const [code, enumName, name] of [
    [ErrorCodes.X_V_IF_NO_EXPRESSION, 'ErrorCodes', 'X_V_IF_NO_EXPRESSION'], // a transform-stage member: the template stage's, not this one's
    [ErrorCodes.__EXTEND_POINT__, 'DOMErrorCodes', null], // the first DOM code: this stage has no DOM vocabulary
    [99999, 'DOMErrorCodes', null],
    [-1, 'ErrorCodes', null],
  ]) {
    const c = classify(code);
    assert.deepEqual([c.obixCode, c.upstream.enum, c.upstream.name, c.upstream.code], [reserved, enumName, name, code], String(code));
    assert.doesNotMatch(c.obixCode, /\d/, 'no Vue number in an OBIX code');
    assert.ok(Object.isFrozen(c.upstream));
  }
  const compat = classify('COMPILER_IS_ON_ELEMENT');
  assert.deepEqual([compat.obixCode, compat.upstream.enum, compat.upstream.name, compat.upstream.code], [reserved, 'CompilerDeprecationTypes', 'COMPILER_IS_ON_ELEMENT', 'COMPILER_IS_ON_ELEMENT']);
});

test('a member name is a key, not a property path: a vocabulary that names a member like an inherited property still gets the reserved code', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const c = classify(7, { memberOf: () => ({ enumName: 'ErrorCodes', name }) });
    assert.equal(c.obixCode, OBIX_SFC_CODES.unclassified, name);
    assert.equal(c.upstream.name, name);
  }
});

test('toDiagnostic reads an upstream error by what it carries: a number by its enum member (zero included), a string key as a compat deprecation, and anything that is not a code by its message', () => {
  const at = (props, message = 'm') => toDiagnostic(Object.assign(new Error(message), props), 'a.obix');
  const first = at({ code: 0 });
  assert.deepEqual([first.code, first.upstream.name, first.upstream.code], ['OBIX_SFC_COMMENT_EMPTY_CLOSED_ABRUPTLY', 'ABRUPT_CLOSING_OF_EMPTY_COMMENT', 0], 'code 0 is a code');
  assert.equal(at({ code: ErrorCodes.X_MISSING_END_TAG }).code, 'OBIX_SFC_ELEMENT_END_TAG_MISSING');
  const key = at({ code: 'COMPILER_IS_ON_ELEMENT' });
  assert.deepEqual([key.code, key.upstream.enum, key.upstream.name, key.upstream.code], [OBIX_SFC_CODES.unclassified, 'CompilerDeprecationTypes', 'COMPILER_IS_ON_ELEMENT', 'COMPILER_IS_ON_ELEMENT']);
  for (const code of ['', undefined, null, {}, [], true]) {
    const d = at({ code }, 'Single file component can contain only one <template> element');
    assert.equal(d.code, OBIX_SFC_CODES.duplicateTemplate, `${String(code)} is not a code: the message decides`);
    assert.deepEqual({ ...d.upstream }, { package: '@vue/compiler-sfc', version: '3.5.43', enum: null, name: null, code: null });
  }
  const unknown = at({}, 'a message from a newer Vue');
  assert.deepEqual([unknown.code, unknown.upstream.enum], [OBIX_SFC_CODES.unclassified, null]);
  assert.equal(Object.isFrozen(unknown), true);
});

test('toDiagnostic trusts a location only when it is whole: a range needs a start and an end, each with a line, a column and an offset', () => {
  const p = (line, column, offset) => ({ line, column, offset });
  const at = (loc) => toDiagnostic(Object.assign(new Error('m'), { code: ErrorCodes.EOF_IN_TAG, loc }), 'a.obix');
  const whole = at({ start: p(1, 2, 3), end: p(4, 5, 6) });
  assert.deepEqual([whole.start, whole.end], [p(1, 2, 3), p(4, 5, 6)]);
  assert.ok(Object.isFrozen(whole.start) && Object.isFrozen(whole.end));
  for (const loc of [undefined, null, 7, {}, { start: p(1, 2, 3) }, { end: p(1, 2, 3) }, { start: p(1, 2, 3), end: { line: 1, column: 1 } }, { start: p(1, 2, 3), end: { line: '1', column: 1, offset: 0 } }, { start: { line: 1, offset: 0 }, end: p(1, 1, 0) }, { start: { column: 1, offset: 0 }, end: p(1, 1, 0) }]) {
    const d = at(loc);
    assert.equal(d.start, undefined, JSON.stringify(loc));
    assert.equal(d.end, undefined, JSON.stringify(loc));
  }
});

test('the empty-file message names the file, so the .vue and .obix messages differ by exactly the filename and nothing else', () => {
  const f = manifest.fixtures.find((x) => x.id === '00b-empty-file');
  const o = parseObix('', `${f.name}.obix`).diagnostics[0].message;
  const v = parseVueReference('', `${f.name}.vue`).diagnostics[0].message;
  assert.notEqual(o, v);
  assert.equal(o.replace(`${f.name}.obix`, '<file>'), v.replace(`${f.name}.vue`, '<file>'));
});

test('positions are the official 1-based line and column plus the offset, CRLF sources included', () => {
  for (const source of ['<template>\r\n  <div>\r\n</template>\r\n', '<template>\n  <div>\n</template>\n']) {
    const expected = official(source, 'Crlf.obix').errors.map((e) => ({ start: pos(e.loc.start), end: pos(e.loc.end) })); // a snapshot, before the code under test runs
    const got = parseObix(source, 'Crlf.obix').diagnostics;
    assert.equal(got.length, 1);
    assert.deepEqual(got[0].start, expected[0].start);
    assert.deepEqual(got[0].end, expected[0].end);
    assert.ok(got[0].start.line >= 1 && got[0].start.column >= 1, '1-based');
    assert.ok(Number.isInteger(got[0].start.offset));
  }
});

test('positionAt gives every stage the official position of an offset: for every block of every corpus fixture, the official parser\'s own line and column are what positionAt derives from its offset — and it clamps, and it counts CRLF as one line break', () => {
  let checked = 0;
  for (const f of manifest.fixtures) {
    const source = read(f.id, `${f.name}.obix`);
    const d = official(source, `${f.name}.obix`).descriptor; // the official positions, before the code under test runs
    for (const block of [d.template, d.script, d.scriptSetup, ...d.styles, ...d.customBlocks]) {
      if (!block) continue;
      for (const at of [block.loc.start, block.loc.end]) {
        assert.deepEqual({ ...positionAt(source, at.offset) }, { line: at.line, column: at.column, offset: at.offset }, `${f.id}: ${block.type} at ${at.offset}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 200, `${checked} positions`);
  assert.deepEqual({ ...positionAt('ab\ncd', 0) }, { line: 1, column: 1, offset: 0 });
  assert.deepEqual({ ...positionAt('ab\ncd', 2) }, { line: 1, column: 3, offset: 2 }, 'the newline itself is the last column of its line');
  assert.deepEqual({ ...positionAt('ab\ncd', 3) }, { line: 2, column: 1, offset: 3 });
  assert.deepEqual({ ...positionAt('ab\r\ncd', 4) }, { line: 2, column: 1, offset: 4 }, 'CRLF: the pair is one line break');
  assert.deepEqual({ ...positionAt('ab\ncd', 5) }, { line: 2, column: 3, offset: 5 }, 'the end of the source');
  assert.deepEqual({ ...positionAt('ab\ncd', 99) }, { line: 2, column: 3, offset: 5 }, 'clamped above');
  assert.deepEqual({ ...positionAt('ab\ncd', -4) }, { line: 1, column: 1, offset: 0 }, 'clamped below');
  assert.deepEqual({ ...positionAt('', 0) }, { line: 1, column: 1, offset: 0 }, 'an empty source');
  assert.ok(Object.isFrozen(positionAt('x', 0)));
});

test('a bad SFC is a diagnostic, never an exception', () => {
  for (const source of ['<template', '<', '<<<>>>', '<script setup lang="ts">const a = </script>', '<template><div></template><script>', '\u0000\u0001 binary', '<style scoped>'.repeat(50)]) {
    const r = parseObix(source, 'Bad.obix');
    assert.ok(Array.isArray(r.diagnostics), JSON.stringify(source));
  }
});

// ── the contract of the two entry points ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('parseObix accepts only a .obix filename and parseVueReference only a .vue one; the source must be a string; the filename must not be empty', () => {
  const ok = '<template><p /></template>';
  assert.throws(() => parseObix(ok, 'Counter.vue'), { name: 'TypeError', message: /parseObix expects a \.obix filename.*Counter\.vue/ });
  assert.throws(() => parseObix(ok, 'Counter.OBIX'), TypeError);
  assert.throws(() => parseObix(ok, 'Counter'), TypeError);
  assert.throws(() => parseObix(ok, ''), TypeError);
  assert.throws(() => parseObix(ok, '.obix'), { name: 'TypeError', message: /parseObix expects a \.obix filename/ }, 'the extension alone is not a file name');
  assert.throws(() => parseVueReference(ok, '.vue'), { name: 'TypeError', message: /parseVueReference expects a \.vue filename/ });
  assert.throws(() => parseVueReference(ok, 'Counter.obix'), { name: 'TypeError', message: /parseVueReference expects a \.vue filename.*Counter\.obix/ });
  assert.throws(() => parseObix(undefined, 'A.obix'), { name: 'TypeError', message: /source must be a string/ });
  assert.throws(() => parseVueReference(42, 'A.vue'), TypeError);
  assert.doesNotThrow(() => parseObix(ok, 'A.obix'));
  assert.doesNotThrow(() => parseVueReference(ok, 'A.vue'));
});

test('the two syntaxes never share a descriptor (the official parser caches by filename) and every call is deterministic', () => {
  const source = read('01-basic-interpolation', 'Greeting.obix');
  const a = parseObix(source, 'Greeting.obix');
  const b = parseVueReference(source, 'Greeting.vue');
  assert.notEqual(a.descriptor, b.descriptor);
  assert.equal(a.descriptor.filename, 'Greeting.obix');
  assert.equal(b.descriptor.filename, 'Greeting.vue');
  const again = parseObix(source, 'Greeting.obix');
  assert.deepEqual(projectDescriptor(again.descriptor), projectDescriptor(a.descriptor));
  assert.deepEqual(again.diagnostics, a.diagnostics);
});

test('the result and the diagnostics a caller receives are frozen data, and so is the seam that names upstream codes', () => {
  const r = parseObix(read('24-invalid-template', 'Unclosed.obix'), 'Unclosed.obix');
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(parseVueReference('<template><p /></template>', 'A.vue')));
  assert.ok(Object.isFrozen(officialVocabulary));
  assert.ok(Object.isFrozen(r.diagnostics));
  assert.ok(Object.isFrozen(r.diagnostics[0]));
  assert.ok(Object.isFrozen(r.diagnostics[0].start));
});

// ── what the parser does NOT do at this layer ────────────────────────────────────────────────────────────────────────────────────────────

test('custom blocks survive with their type, attributes, lang and content (the OBIX metadata blocks of the directive, section 35)', () => {
  const d = parseObix(read('23-custom-block', 'Documented.obix'), 'Documented.obix').descriptor;
  assert.deepEqual(d.customBlocks.map((b) => b.type), ['obix-tests', 'docs']);
  assert.deepEqual({ ...d.customBlocks[0].attrs }, { lang: 'obix-test' });
  assert.equal(d.customBlocks[0].lang, 'obix-test');
  assert.match(d.customBlocks[0].content, /test IncrementCounts \{\n {2}dispatch increment\n {2}expect count is 1\n\}/);
});

test('import specifiers are left exactly as written: resolving the "obix" authoring alias is a later phase, and it is never a string replacement', () => {
  const source = read('00-canonical-counter', 'Counter.obix');
  const d = parseObix(source, 'Counter.obix').descriptor;
  assert.match(d.scriptSetup.content, /\} from "obix"/);
  assert.equal(d.scriptSetup.content, official(source, 'Counter.obix').descriptor.scriptSetup.content);
});

test('documented limits of the official parser at this layer — asserted so that a change is a conscious decision, not a surprise', () => {
  // text outside any block is ignored without a diagnostic (the directive, section 35, says not to append a second language after the component)
  const stray = parseObix('<template><p /></template>\nthis is not a block and nobody says so\n', 'Stray.obix');
  assert.deepEqual(stray.diagnostics, []);
  assert.ok(!JSON.stringify(stray.descriptor.customBlocks).includes('nobody'));
  // a <script> and a <script setup> of different languages are not a parse error (compileScript rejects them, in a later phase)
  assert.deepEqual(parseObix('<script>export const a = 1</script>\n<script setup lang="ts">const b = 2</script>\n<template><p /></template>', 'Lang.obix').diagnostics, []);
  // an empty block is dropped (ignoreEmpty)
  assert.equal(parseObix('<template><p /></template>\n<style scoped></style>\n', 'Empty.obix').descriptor.styles.length, 0);
  // Level-0 source is a structurally valid SFC: nothing at this layer can tell it from the new syntax. Telling them apart, and converting, is the migration tool's job.
  const legacy = '<template>\n  <button on:click="Go" obix:if="visible">{n}</button>\n</template>\n<script>\nconst state = { n: 0 };\nconst actions = { Go(state) { return state; } };\n</script>\n';
  assert.deepEqual(parseObix(legacy, 'Legacy.obix').diagnostics, []);
});
