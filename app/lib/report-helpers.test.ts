import { describe, it, expect } from 'vitest';
import { formatEpochMs, formatUnixSeconds, itemDrivesSummary, sectionsForFilter } from './report-helpers';

// IA-66 — "Defects Only" filter + "Add to repair request" checkbox must agree,
// and both must honour the tenant's per-category drivesSummary switch (not a
// severityBucket regex that never matched custom categories).
describe('itemDrivesSummary', () => {
  const item = (defects: Array<{ drivesSummary?: boolean }>) =>
    ({ severityBucket: 'defect', resolvedTabs: { defects } }) as never;

  it('is true when any included defect drives the summary', () => {
    expect(itemDrivesSummary(item([{ drivesSummary: true }]))).toBe(true);
    expect(itemDrivesSummary(item([{ drivesSummary: false }, { drivesSummary: true }]))).toBe(true);
  });
  it('treats an unset drivesSummary as true (server default)', () => {
    expect(itemDrivesSummary(item([{}]))).toBe(true);
  });
  it('is false when every defect category is switched off', () => {
    expect(itemDrivesSummary(item([{ drivesSummary: false }]))).toBe(false);
  });
  it('is false for an item with no defects', () => {
    expect(itemDrivesSummary(item([]))).toBe(false);
    expect(itemDrivesSummary({ severityBucket: 'satisfactory' } as never)).toBe(false);
  });
});

describe('report-helpers timezone', () => {
  it('formatEpochMs renders in the supplied tenant tz', () => {
    // 2026-01-01T04:00:00Z is still Dec 31 in New York (EST -05:00)
    expect(formatEpochMs(Date.parse('2026-01-01T04:00:00Z'), 'America/New_York')).toContain('Dec 31');
    expect(formatEpochMs(Date.parse('2026-01-01T04:00:00Z'), 'UTC')).toContain('Jan 1');
  });
  it('formatEpochMs defaults to UTC when no tz given', () => {
    expect(formatEpochMs(Date.parse('2026-01-01T04:00:00Z'))).toContain('Jan 1');
  });
  it('formatUnixSeconds honors the tenant tz (no longer hardcoded UTC)', () => {
    const sec = Date.parse('2026-01-01T04:00:00Z') / 1000;
    expect(formatUnixSeconds(sec, 'America/New_York')).toContain('Dec 31');
    expect(formatUnixSeconds(sec, 'UTC')).toContain('Jan 1');
  });
  it('returns empty string on null/invalid', () => {
    expect(formatEpochMs(null)).toBe('');
    expect(formatEpochMs(undefined)).toBe('');
  });
});

// #13 — the Summary filter narrowed NOTHING and the renderer hid every item, so
// a recipient who opened "Summary" got section totals and no finding text. These
// pin that it narrows, and that it narrows on the tenant's own drivesSummary
// switch rather than a severity guess.
describe('sectionsForFilter', () => {
  const item = (id: string, drives: boolean) => ({
    id,
    resolvedTabs: { defects: [{ drivesSummary: drives }] },
  });
  // The fixture is built so the two axes DISAGREE on every section — that is the
  // only way these tests can tell them apart:
  //   roof   rating says defect, and has a summary-driving finding
  //   attic  rating says clean, but HAS a summary-driving finding
  //   garage rating says defect, but every finding is non-driving (e.g. Minor)
  const sections = [
    { id: 'roof', defectCount: 2, items: [item('a', true), item('b', false)] },
    { id: 'attic', defectCount: 0, items: [item('c', true)] },
    { id: 'garage', defectCount: 1, items: [item('d', false)] },
  ];

  it('"all" passes every section and every item through', () => {
    const out = sectionsForFilter(sections, 'all');
    expect(out.map((s) => s.id)).toEqual(['roof', 'attic', 'garage']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('"defects" gates sections on the RATING axis', () => {
    const out = sectionsForFilter(sections, 'defects');
    // attic is dropped despite carrying a summary-driving finding, because its
    // rating bucket is clean. garage survives the section test on its rating
    // and is left with no items; <ReportSectionBlock> drops it at render.
    expect(out.map((s) => s.id)).toEqual(['roof', 'garage']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a']);
    expect(out[1].items).toEqual([]);
  });

  it('"summary" gates sections on the CATEGORY axis, and never on the rating', () => {
    const out = sectionsForFilter(sections, 'summary');
    // attic KEPT: the tenant's switch, not the rating, decides what reaches the
    // Summary. garage DROPPED: nothing in it drives the summary.
    expect(out.map((s) => s.id)).toEqual(['roof', 'attic']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a']);
    expect(out[1].items.map((i) => i.id)).toEqual(['c']);
  });

  // Aaron's call, 2026-09-20: a section with nothing to report stays OUT of the
  // summary rather than appearing to say "All clear".
  it('"summary" never returns an empty section', () => {
    const out = sectionsForFilter(sections, 'summary');
    expect(out.every((s) => s.items.length > 0)).toBe(true);
    expect(sectionsForFilter([sections[2]], 'summary')).toEqual([]);
  });

  it('never mutates its input', () => {
    sectionsForFilter(sections, 'summary');
    expect(sections[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
