// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import LocusMark from '../src/components/LocusMark.jsx';
import BrandMark from '../src/components/access/BrandMark.jsx';

afterEach(cleanup);
const css = fs.readFileSync(`${process.cwd()}/src/index.css`, 'utf8');

describe('the theme-following logo', () => {
  it('draws the brand mark: ring, pin, hole and a fixed gold dot', () => {
    const { container } = render(<LocusMark />);
    expect(container.querySelector('.locus-mark-ring')).not.toBeNull();
    expect(container.querySelector('.locus-mark-pin')).not.toBeNull();
    expect(container.querySelector('.locus-mark-hole')).not.toBeNull();
    expect(container.querySelector('circle[fill="#D9962B"]')).not.toBeNull();
  });

  it('is decorative unless it is given a title', () => {
    const plain = render(<LocusMark />).container.querySelector('svg');
    expect(plain.getAttribute('aria-hidden')).toBe('true');
    cleanup();
    const named = render(<LocusMark title="LOCUS" />).container.querySelector('svg');
    expect(named.getAttribute('aria-label')).toBe('LOCUS');
    expect(named.hasAttribute('aria-hidden')).toBe(false);
  });

  it('is navy on the light theme and white on the dark one, with the hole swapped, as in branding/', () => {
    expect(css).toMatch(/\.locus-mark-ring \{ stroke: #12294D; \}/);
    expect(css).toMatch(/\.locus-mark-pin \{ fill: #12294D; \}/);
    expect(css).toMatch(/\.locus-mark-hole \{ fill: #FFFFFF; \}/);
    expect(css).toMatch(/:root\[data-theme="dark"\] \.locus-mark-ring \{ stroke: #FFFFFF; \}/);
    expect(css).toMatch(/:root\[data-theme="dark"\] \.locus-mark-pin \{ fill: #FFFFFF; \}/);
    expect(css).toMatch(/:root\[data-theme="dark"\] \.locus-mark-hole \{ fill: #12294D; \}/);
  });

  it('BrandMark is that logo, in three sizes', () => {
    for (const [size, cls] of [['large', 'w-16'], ['medium', 'w-10'], ['small', 'w-6']]) {
      const { container } = render(<BrandMark size={size} />);
      expect(container.querySelector('span').className).toContain(cls);
      expect(container.querySelector('svg .locus-mark-ring')).not.toBeNull();
      cleanup();
    }
  });
});
