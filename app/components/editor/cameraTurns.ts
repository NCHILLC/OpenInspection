/**
 * Quarter turns (counter-clockwise) a captured video frame needs so the scene is
 * upright. A getUserMedia frame follows the SCREEN orientation, not how the phone
 * is held: with rotation locked to portrait and the phone held landscape (the
 * natural way to shoot a building) the frame is sideways, and the canvas bake
 * has no EXIF to correct it from. The accelerometer knows how it is held.
 *
 * ax/ay: accelerationIncludingGravity in device axes (x right, y toward the top
 * edge). Top edge pointing left = rotated CCW = x > 0, the same sense as
 * screen.orientation.angle. Phone flat (no in-plane gravity): trust the screen.
 */
export function captureQuarterTurns(ax: number, ay: number, screenAngle: number): number {
  if (Math.hypot(ax, ay) < 4) return 0;
  const held = Math.round((Math.atan2(ax, ay) * 180) / Math.PI / 90);
  return (((held - Math.round(screenAngle / 90)) % 4) + 4) % 4;
}
