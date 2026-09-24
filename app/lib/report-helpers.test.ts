import { describe, it, expect } from 'vitest';
import { formatEpochMs, formatUnixSeconds, itemDrivesSummary, sectionsForFilter } from './report-helpers';

// The repair checkbox honors the tenant's per-category Summary switch.
describe('itemDrivesSummary', () => {
  const item = (defects: Array<{ included: boolean; drivesSummary?: boolean }>) =>
    ({ severityBucket: 'defect', resolvedTabs: { defects } }) as never;

  it('is true when any included defect drives the summary', () => {
    expect(itemDrivesSummary(item([{ included: true, drivesSummary: true }]))).toBe(true);
    expect(itemDrivesSummary(item([{ included: true, drivesSummary: false }, { included: true, drivesSummary: true }]))).toBe(true);
  });
  it('treats an unset drivesSummary as true (server default)', () => {
    expect(itemDrivesSummary(item([{ included: true }]))).toBe(true);
  });
  it('is false when every defect category is switched off', () => {
    expect(itemDrivesSummary(item([{ included: true, drivesSummary: false }]))).toBe(false);
    expect(itemDrivesSummary(item([{ included: false, drivesSummary: true }]))).toBe(false);
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
    resolvedTabs: { defects: [{ included: true, drivesSummary: drives }] },
  });
  const mixed = {
    id: 'mixed',
    resolvedTabs: { defects: [
      { included: true, drivesSummary: true, title: 'Safety issue' },
      { included: true, drivesSummary: false, title: 'Minor issue' },
      { included: false, drivesSummary: true, title: 'Unselected canned comment' },
    ] },
  };
  /** An item the inspector answered with nothing wrong. */
  const clean = (id: string) => ({ id, resolvedTabs: { defects: [] as Array<{ included: boolean; drivesSummary: boolean }> } });
  // Every category a tenant defines is a defect, so `drives` here is NOT
  // "is this a defect" — it is "does this category reach the Summary".
  // Read `item('b', false)` as a Minor finding with Minor switched off.
  //   roof   two findings, one driving one not, plus an item with nothing found
  //   attic  rated clean, carries a driving finding
  //   garage rated defective, every finding non-driving (all Minor, Minor off)
  const sections = [
    { id: 'roof', defectCount: 2, items: [item('a', true), item('b', false), mixed, clean('r-ok')] },
    { id: 'attic', defectCount: 0, items: [item('c', true)] },
    { id: 'garage', defectCount: 1, items: [item('d', false)] },
  ];

  it('"all" passes every section and every item through', () => {
    const out = sectionsForFilter(sections, 'all');
    expect(out.map((s) => s.id)).toEqual(['roof', 'attic', 'garage']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a', 'b', 'mixed', 'r-ok']);
  });

  // The Summary switch must NOT reach this view. Unticking Minor is a delivery
  // choice; it cannot change what the report says is wrong with the house.
  it('"defects" keeps every included finding regardless of rating or Summary switch', () => {
    const out = sectionsForFilter(sections, 'defects');
    expect(out.map((s) => s.id)).toEqual(['roof', 'attic', 'garage']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a', 'b', 'mixed']);
    expect(out[1].items.map((i) => i.id)).toEqual(['c']);
    expect(out[2].items.map((i) => i.id)).toEqual(['d']);
  });

  it('"summary" gates sections on the CATEGORY axis, and never on the rating', () => {
    const out = sectionsForFilter(sections, 'summary');
    // attic KEPT: the tenant's switch, not the rating, decides what reaches the
    // Summary. garage DROPPED: nothing in it drives the summary.
    expect(out.map((s) => s.id)).toEqual(['roof', 'attic']);
    expect(out[0].items.map((i) => i.id)).toEqual(['a', 'mixed']);
    expect(out[1].items.map((i) => i.id)).toEqual(['c']);
    expect(out[0].items[1].resolvedTabs.defects).toEqual([
      { included: true, drivesSummary: true, title: 'Safety issue' },
    ]);
  });

  // Aaron's call, 2026-09-20: a section with nothing to report stays OUT of the
  // summary rather than appearing to say "All clear".
  it('"summary" never returns an empty section', () => {
    const out = sectionsForFilter(sections, 'summary');
    expect(out.every((s) => s.items.length > 0)).toBe(true);
    expect(sectionsForFilter([sections[2]], 'summary')).toEqual([]);
  });

  it('ignores unselected canned findings in both narrowed views', () => {
    const unselected = { id: 'unselected', defectCount: 1, items: [{
      id: 'unselected-item',
      resolvedTabs: { defects: [{ included: false, drivesSummary: true }] },
    }] };
    expect(sectionsForFilter([unselected], 'defects')).toEqual([]);
    expect(sectionsForFilter([unselected], 'summary')).toEqual([]);
  });

  it('never mutates its input', () => {
    sectionsForFilter(sections, 'summary');
    expect(sections[0].items.map((i) => i.id)).toEqual(['a', 'b', 'mixed', 'r-ok']);
    expect(mixed.resolvedTabs.defects).toHaveLength(3);
  });
});
