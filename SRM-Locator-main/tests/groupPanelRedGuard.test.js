// Red is for the emergency and destructive actions only (the redesign's rule). After the
// Group panel batch the panel's only red is Leave group and Remove and block; everywhere else in
// App.jsx the only red left is the admin route recorder's ABORT (destructive: it throws a
// recording away) and the WiFi floor tag's colour, which the WiFi code keeps (off, untouched).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const RED = /red-\d|#EF4444|rgba\(239,\s*68,\s*68/i;
const DANGER = /\bdanger\b/;

describe('the group panel', () => {
  it('is red only for Leave group and Remove and block', () => {
    const dir = new URL('../src/components/group/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const text = src(`components/group/${file}`);
      expect(text, file).not.toMatch(RED);
      if (!['LeaveGroup.jsx', 'MemberOptions.jsx'].includes(file)) expect(text, file).not.toMatch(DANGER);
    }
  });

  it("member rows and their words are never red", () => {
    for (const file of ['components/SquadMemberCard.jsx', 'utils/memberStatus.js', 'copy/group.js']) {
      expect(src(file), file).not.toMatch(RED);
      expect(src(file), file).not.toMatch(DANGER);
    }
  });
});

describe('App.jsx', () => {
  it('has no red but the admin route recorder ABORT and the WiFi floor tag', () => {
    const lines = src('App.jsx').split(/\r?\n/);
    const red = lines.map((line, i) => [line, i]).filter(([line]) => RED.test(line));
    for (const [line, i] of red) {
      const near = lines.slice(i, i + 4).join('\n');
      expect(/ABORT/.test(near) || /FloorTag/.test(line), `line ${i + 1}: ${line.trim()}`).toBe(true);
    }
  });
});
