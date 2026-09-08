/**
 * Media Studio — annotation model. Coords are NATURAL-IMAGE PIXELS (resolution-
 * stable). `annotationsJson` stored server-side is the JSON of this array.
 */
export interface Point { x: number; y: number }
export type Annotation =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'arrow'; x: number; y: number; x2: number; y2: number }
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'freehand'; x: number; y: number; points: Point[] };
export const ANNOTATION_COLOR = '#ef4444';

export function serializeAnnotations(anns: Annotation[]): string { return JSON.stringify(anns); }
export function deserializeAnnotations(json: string | null | undefined): Annotation[] {
  if (!json) return [];
  try {
    const p = JSON.parse(json);
    if (Array.isArray(p)) return p as Annotation[];
    // Older docs saved by the retired measure tool wrapped the array in
    // { annotations, calibration } — read the array, drop the calibration.
    if (p && Array.isArray(p.annotations)) return p.annotations as Annotation[];
    return [];
  } catch { return []; }
}
