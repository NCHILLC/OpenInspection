import { describe, it, expect } from 'vitest';
import { serializeAnnotations, deserializeAnnotations } from '~/components/media-studio/annotations';

/**
 * The measure tool is gone (2026-09-08), but docs it saved are not: it wrapped
 * the array in `{ annotations, calibration }`. Those must keep deserializing
 * to their non-measure marks so an already-annotated photo reopens intact.
 */
describe('legacy measure envelope', () => {
  it('reads the annotations out of a { annotations, calibration } document', () => {
    const json = JSON.stringify({
      annotations: [
        { kind: 'circle', x: 1, y: 2, r: 3 },
        { kind: 'measure', x: 0, y: 0, x2: 50, y2: 0, unit: 'cm' },
      ],
      calibration: { pxPerUnit: 12.5, calibUnit: 'cm' },
    });
    expect(deserializeAnnotations(json)).toHaveLength(2);
    expect(deserializeAnnotations(json)[0]).toEqual({ kind: 'circle', x: 1, y: 2, r: 3 });
  });

  it('round-trips a plain array unchanged', () => {
    const anns = [{ kind: 'circle' as const, x: 1, y: 2, r: 3 }];
    expect(deserializeAnnotations(serializeAnnotations(anns))).toEqual(anns);
  });
});
