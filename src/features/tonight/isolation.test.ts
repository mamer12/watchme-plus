import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sparkAskLabel } from '../../lib/sparkBrand';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', '..');
const searchDir = join(src, 'features', 'search');

describe('Tonight is separate from search', () => {
  it('TONIGHT-013: the search code never imports Tonight, has no link to it', () => {
    const files = readdirSync(searchDir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'));
    expect(files).toContain('SearchPage.tsx');
    for (const f of files) {
      const text = readFileSync(join(searchDir, f), 'utf8');
      const imports = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      expect(imports.filter((i) => /tonight/i.test(i)), f).toEqual([]);
    }
    expect(readFileSync(join(searchDir, 'SearchPage.tsx'), 'utf8')).not.toMatch(/\/tonight|\/spark|sparkName/);
  });

  it('TONIGHT-013: no shared module imports Tonight; only the router loads it, lazily', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (p !== join(src, 'features', 'tonight')) walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && /from\s+['"][^'"]*tonight/i.test(readFileSync(p, 'utf8'))) {
          offenders.push(p.slice(src.length + 1));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
    expect(readFileSync(join(src, 'App.tsx'), 'utf8')).toContain("lazy(() => import('./features/tonight/TonightPage'))");
  });
});

describe('Spark entry in the header', () => {
  it('TONIGHT-018: the header has a labelled Spark icon button before Search, and /tonight redirects to /spark', () => {
    const layout = readFileSync(join(src, 'components', 'Layout.tsx'), 'utf8');
    expect(layout).toMatch(/aria-label=\{askLabel\}/);
    expect(layout.indexOf('<SparkIcon')).toBeGreaterThan(-1);
    expect(layout.indexOf('<SparkIcon')).toBeLessThan(layout.indexOf('<SearchIcon size={22}'));
    expect(sparkAskLabel('en', 'Spark')).toBe('Ask Spark');
    expect(sparkAskLabel('ar', 'Spark')).toBe('اسأل Spark');
    const app = readFileSync(join(src, 'App.tsx'), 'utf8');
    expect(app).toContain('path="/spark"');
    expect(app).toMatch(/path="\/tonight" element=\{<Navigate to="\/spark"/);
  });
});
