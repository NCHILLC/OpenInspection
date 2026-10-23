import { describe, expect, it } from 'vitest';
import { captureQuarterTurns } from './cameraTurns';

describe('captureQuarterTurns', () => {
  it('upright portrait, screen portrait: no turn', () => expect(captureQuarterTurns(0, 9.8, 0)).toBe(0));
  it('top edge left on a portrait-locked screen: one CCW turn', () => expect(captureQuarterTurns(9.8, 0, 0)).toBe(1));
  it('top edge right on a portrait-locked screen: one CW turn', () => expect(captureQuarterTurns(-9.8, 0, 0)).toBe(3));
  it('upside down: half turn', () => expect(captureQuarterTurns(0, -9.8, 0)).toBe(2));
  it('rotation unlocked, screen already follows the phone: no turn', () => {
    expect(captureQuarterTurns(9.8, 0, 90)).toBe(0);
    expect(captureQuarterTurns(-9.8, 0, 270)).toBe(0);
  });
  it('phone flat: no turn', () => expect(captureQuarterTurns(0.5, 0.5, 0)).toBe(0));
});
