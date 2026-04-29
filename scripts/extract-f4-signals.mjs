#!/usr/bin/env node
// Regenerate src/data/sim-falcon4-signals.json from the SimLinkup source's
// F4SimSupportModule.cs CreateSimOutputsList(). Run this whenever F4SimOutputs.cs
// adds, removes, or renames signals upstream.
//
// Usage:
//   node scripts/extract-f4-signals.mjs [path/to/F4SimSupportModule.cs]
//
// Default path assumes lightningstools is checked out as a sibling of this repo
// at ../lightningstools. Override with an absolute path if it lives elsewhere.

import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, join} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outPath = join(repoRoot, 'src', 'data', 'sim-falcon4-signals.json');

const defaultSrcPath = resolve(repoRoot, '..', 'lightningstools', 'src', 'F4Utils', 'SimSupport', 'F4SimSupportModule.cs');
const srcPath = process.argv[2] || defaultSrcPath;

const src = readFileSync(srcPath, 'utf8');
const lines = src.split(/\r?\n/);

// String literal that allows embedded escaped quotes: "...\"..."
const STR = String.raw`"((?:\\"|[^"])+)"`;
const fivearg = new RegExp(
  String.raw`AddF4SimOutput\(CreateNewF4SimOutput\(\s*` + STR +
  String.raw`\s*,\s*` + STR +
  String.raw`\s*,\s*F4SimOutputs\.([A-Z0-9_]+)\s*,\s*typeof\((bool|string|float|int|byte|short|long)\)`
);
const sixarg = new RegExp(
  String.raw`AddF4SimOutput\(CreateNewF4SimOutput\(\s*` + STR +
  String.raw`\s*,\s*(?:` + STR + String.raw`|null)\s*,\s*[\$@]?` + STR +
  String.raw`\s*,\s*F4SimOutputs\.([A-Z0-9_]+)\s*,\s*(null|i|[0-9]+)\s*,\s*typeof\((bool|string|float|int|byte|short|long)\)`
);

const tyKind = ty => ty === 'bool' ? 'digital' : ty === 'string' ? 'text' : 'analog';
const unesc = s => s.replace(/\\"/g, '"');
// C# interpolation tokens like {i + 1} or #{(i+1).ToString().PadLeft(2,'0')} → "[N]"
const cleanIndexedTpl = s => s
  .replace(/#\{\(?i \+ 1\)?\.ToString\(\)\.PadLeft\(\d+, '0'\)\}/g, '[N]')
  .replace(/\{i \+ 1\}/g, '[N]')
  .replace(/\{i\}/g, '[N]');

const scalar = [];
const indexed = new Map();
const seen = new Set();
const dedupe = id => { if (seen.has(id)) return false; seen.add(id); return true; };

for (const l of lines) {
  let m;
  if (m = l.match(sixarg)) {
    const [, coll, sub, friendlyRaw, en, idx, ty] = m;
    const subC = sub || '';
    const friendly = unesc(friendlyRaw);
    if (idx === 'i') {
      indexed.set(en, { coll, sub: subC, friendlyTpl: friendly, ty, kind: tyKind(ty) });
    } else if (idx === 'null') {
      const id = 'F4_' + en;
      if (dedupe(id)) scalar.push({ id, coll, sub: subC, friendly, kind: tyKind(ty) });
    } else {
      const id = `F4_${en}[${idx}]`;
      if (dedupe(id)) scalar.push({ id, coll, sub: subC, friendly, kind: tyKind(ty) });
    }
  } else if (m = l.match(fivearg)) {
    const [, coll, friendlyRaw, en, ty] = m;
    const id = 'F4_' + en;
    if (dedupe(id)) scalar.push({ id, coll, sub: '', friendly: unesc(friendlyRaw), kind: tyKind(ty) });
  }
}

// Stable-sort by (coll, sub) so the file reads as contiguous category groups.
// The dropdown UI uses `coll` to drive <optgroup> headings, so co-located
// entries also keep <optgroup> well-formed regardless of how the file is
// hand-edited.
const scalarOut = scalar
  .map((e, i) => ({ e, i }))
  .sort((a, b) => {
    const c = a.e.coll.localeCompare(b.e.coll);
    if (c !== 0) return c;
    const s = a.e.sub.localeCompare(b.e.sub);
    if (s !== 0) return s;
    return a.i - b.i;
  })
  .map(({ e }) => ({
    id: e.id,
    kind: e.kind,
    coll: e.coll,
    sub: e.sub,
    label: e.sub ? `${e.coll} → ${e.sub} → ${e.friendly}` : `${e.coll} → ${e.friendly}`,
  }));

const indexedOut = [...indexed].map(([en, info]) => {
  const friendly = cleanIndexedTpl(info.friendlyTpl);
  return {
    id: 'F4_' + en,
    kind: info.kind,
    coll: info.coll,
    sub: info.sub,
    label: info.sub ? `${info.coll} → ${info.sub} → ${friendly}` : `${info.coll} → ${friendly}`,
  };
});

writeFileSync(outPath, JSON.stringify({ scalar: scalarOut, indexed: indexedOut }, null, 2) + '\n');
console.log(`Updated ${outPath}`);
console.log(`  scalar: ${scalarOut.length}, indexed: ${indexedOut.length}`);
