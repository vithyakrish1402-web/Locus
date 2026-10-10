// The redesign's motion rule for the app's own CSS (src/index.css): animate only transform
// and opacity. Width, height, top, left and filter animations re-lay-out or repaint every
// frame on a phone; the download sweep used to animate `left`, and every press used to
// transition colour, shadow and filter.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'));

const ALLOWED = new Set(['transform', 'opacity', 'scale', 'translate', 'rotate']);

describe('index.css animates only transform and opacity', () => {
  const keyframes = [];
  css.walkAtRules('keyframes', (rule) => keyframes.push(rule));

  it.each(keyframes.map((k) => [k.params, k]))('@keyframes %s', (_name, rule) => {
    rule.walkDecls((decl) => expect(ALLOWED.has(decl.prop), `animates ${decl.prop}`).toBe(true));
  });

  it('every control transitions only transform and opacity on press', () => {
    let pressRule = null;
    css.walkRules((rule) => {
      if (rule.selector.startsWith('button, [role="button"]')) pressRule = rule;
    });
    let properties = null;
    pressRule.walkDecls('transition-property', (decl) => { properties = decl.value.split(',').map((p) => p.trim()); });
    expect(properties.length).toBeGreaterThan(0);
    properties.forEach((p) => expect(ALLOWED.has(p), `transitions ${p}`).toBe(true));
  });

  it('presses to the redesign scale and timings', () => {
    let pressed = null;
    css.walkRules((rule) => {
      if (rule.selector.includes('button:not(:disabled):active') && !rule.parent?.params) pressed = rule;
    });
    const decls = {};
    pressed.walkDecls((d) => { decls[d.prop] = d.value; });
    expect(decls.scale).toBe('var(--press-scale)');
    expect(decls['transition-duration']).toBe('var(--duration-press-in)');
  });
});

// The same rule in the components' own animation props and Tailwind transition classes.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'devtools' ? [] : sourceFiles(path);
  return /\.(jsx?|tsx?)$/.test(name) ? [path] : [];
});

describe('components animate only transform and opacity', () => {
  const files = sourceFiles(SRC);
  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/filter:\s*['"`]blur/);
    expect(text).not.toMatch(/transition-\[(width|height|max-height|top|left|filter)\]/);
  });
});
