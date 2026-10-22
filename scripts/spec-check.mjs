#!/usr/bin/env node
/**
 * Spec traceability check.
 * Every requirement ("### ID: Title" in specs/<capability>/spec.md) must say SHALL, have a GIVEN/WHEN/THEN scenario,
 * and be either referenced by a test name (e.g. it('PLAYER-007: ...')) or marked "Verification: manual — <check>".
 * Tests may not reference unknown IDs. `--write` refreshes the status table in specs/README.md.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ID = /\b([A-Z]+-\d{3})\b/g;
const HEADING = /^### ([A-Z]+-\d{3}): (.+)$/;

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(p)) out.push(p);
  }
  return out;
}

const specFiles = walk(join(root, 'specs'), (p) => p.endsWith('spec.md')).sort();
const requirements = [];
for (const file of specFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const capability = relative(join(root, 'specs'), file).split(/[\\/]/)[0];
  let current = null;
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      current = { id: m[1], title: m[2], capability, file: relative(root, file), body: [] };
      requirements.push(current);
    } else if (/^## /.test(line)) {
      current = null;
    } else if (current) {
      current.body.push(line);
    }
  }
}

const testFiles = walk(root, (p) => /\.test\.tsx?$/.test(p) && !p.includes('node_modules'));
const testRefs = new Map();
for (const file of testFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bit\(\s*['"`]([^'"`]+)['"`]/g)) {
    for (const id of m[1].matchAll(ID)) {
      const list = testRefs.get(id[1]) ?? [];
      list.push(relative(root, file));
      testRefs.set(id[1], list);
    }
  }
}

const problems = [];
const seen = new Set();
const rows = [];
for (const r of requirements) {
  const body = r.body.join('\n');
  if (seen.has(r.id)) problems.push(`${r.id}: duplicate id (${r.file})`);
  seen.add(r.id);
  if (!/\bSHALL\b/.test(body)) problems.push(`${r.id}: no "SHALL" statement`);
  if (!/#### Scenario:/.test(body) || !/- GIVEN /.test(body) || !/- WHEN /.test(body) || !/- THEN /.test(body)) {
    problems.push(`${r.id}: needs a "#### Scenario:" with GIVEN/WHEN/THEN`);
  }
  const manual = /Verification: manual\s+[—-]\s+\S/.test(body);
  const tested = testRefs.has(r.id);
  if (!manual && !tested) problems.push(`${r.id}: not referenced by any test and not marked "Verification: manual — <check>"`);
  if (/Verification: test/.test(body) && !tested) problems.push(`${r.id}: says "test" but no test name contains the id`);
  rows.push({ ...r, manual, tested });
}
for (const id of testRefs.keys()) {
  if (!seen.has(id)) problems.push(`${id}: used in ${testRefs.get(id).join(', ')} but not defined in specs/`);
}

// Status table per capability.
const caps = new Map();
for (const r of rows) {
  const c = caps.get(r.capability) ?? { total: 0, tested: 0, manual: 0, prefix: r.id.split('-')[0] };
  c.total += 1;
  if (r.tested) c.tested += 1;
  else if (r.manual) c.manual += 1;
  caps.set(r.capability, c);
}
const table = [
  '| Capability | IDs | Requirements | Tested | Manual |',
  '| --- | --- | ---: | ---: | ---: |',
  ...[...caps.entries()].map(
    ([cap, c]) => `| [${cap}](${cap}/spec.md) | \`${c.prefix}-\` | ${c.total} | ${c.tested} | ${c.manual} |`,
  ),
];
const totals = [...caps.values()].reduce((a, c) => ({ total: a.total + c.total, tested: a.tested + c.tested, manual: a.manual + c.manual }), { total: 0, tested: 0, manual: 0 });
table.push(`| **Total** | | **${totals.total}** | **${totals.tested}** | **${totals.manual}** |`);

if (process.argv.includes('--write')) {
  const readme = join(root, 'specs', 'README.md');
  const text = readFileSync(readme, 'utf8');
  const next = text.replace(/<!-- status:start -->[\s\S]*<!-- status:end -->/, `<!-- status:start -->\n${table.join('\n')}\n<!-- status:end -->`);
  writeFileSync(readme, next);
}

console.log(table.join('\n'));
console.log(`\n${totals.total} requirements: ${totals.tested} covered by tests, ${totals.manual} manual.`);
if (problems.length) {
  console.error(`\nspec:check failed (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('spec:check passed.');
