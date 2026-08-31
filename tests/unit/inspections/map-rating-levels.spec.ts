import { describe, it, expect } from 'vitest';
import { mapRatingSystemLevels } from '../../../server/lib/map-rating-levels';

/**
 * B-18 root cause #2 — mapRatingSystemLevels translated rating_systems
 * levels for the editor/report but silently DROPPED `pausesAdvance` (and
 * `hotkey`), so the seeds' "Defect/Monitor pause for notes" intent never
 * reached the client and the editor auto-advanced unconditionally.
 */
describe('mapRatingSystemLevels', () => {
  const seedLevels = [
    { abbreviation: 'Sat', label: 'Satisfactory', color: '#10b981', severity: 'good', isDefect: false, hotkey: '1', pausesAdvance: false, order: 0 },
    { abbreviation: 'D', label: 'Defect', color: '#ef4444', severity: 'significant', isDefect: true, hotkey: '3', pausesAdvance: true, order: 2 },
  ];

  it('passes pausesAdvance through to the client shape', () => {
    const mapped = mapRatingSystemLevels(seedLevels);
    const defect = mapped.find((l) => l.label === 'Defect');
    expect(defect?.pausesAdvance).toBe(true);
    const sat = mapped.find((l) => l.label === 'Satisfactory');
    expect(sat?.pausesAdvance).toBe(false);
  });

  it('reads severity directly from the canonical shape (id/abbreviation/severity/isDefect)', () => {
    const mapped = mapRatingSystemLevels(seedLevels);
    const defect = mapped.find((l) => l.label === 'Defect')!;
    expect(defect.id).toBe('Defect');
    expect(defect.abbreviation).toBe('D');
    expect(defect.severity).toBe('significant');
    expect(defect.isDefect).toBe(true);
  });
});

/**
 * The `safety` severity must survive the mapper.
 *
 * `CANON` is a RUNTIME Set, so it is the one place the severity vocabulary is
 * enforced where the compiler cannot help: the TypeScript unions alongside it
 * are erased at build time. When `safety` was added to the zod validators but
 * not here, a Safety-Major level was accepted on write and then silently
 * rewritten to `minor` on read — which renders as "N/A" and drops out of the
 * defect count. A safety hazard reported as "N/A" is the worst possible
 * direction for this bug to fail in, hence a test rather than a comment.
 */
describe('mapRatingSystemLevels — safety severity', () => {
  it('preserves severity "safety" instead of falling back to "minor"', () => {
    const [mapped] = mapRatingSystemLevels([
      { abbreviation: 'S/M', label: 'Safety-Major', color: '#dc2626', severity: 'safety', order: 0 },
    ]);
    expect(mapped.severity).toBe('safety');
  });

  it('treats a safety level as a defect even when isDefect is not set', () => {
    const [mapped] = mapRatingSystemLevels([
      { abbreviation: 'S/M', label: 'Safety-Major', color: '#dc2626', severity: 'safety', order: 0 },
    ]);
    expect(mapped.isDefect).toBe(true);
  });

  it('still falls back to "minor" for a genuinely unknown severity', () => {
    const [mapped] = mapRatingSystemLevels([
      { abbreviation: 'X', label: 'Legacy', color: '#000000', severity: 'not-a-severity', order: 0 },
    ]);
    expect(mapped.severity).toBe('minor');
  });
});
