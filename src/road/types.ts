/** Road classes, cross-sections and shared road types. Pure data, no three.js. */

export type RoadClass = 'back' | 'avenue' | 'arterial';
export const CLASSES: RoadClass[] = ['back', 'avenue', 'arterial'];

export interface ClassSpec {
  lanes: number; // per direction
  laneW: number;
  median: number; // half-width of the raised median (0 = painted centre line)
  margin: number; // painted margin between median/centre and the first lane
  shoulder: number; // kerb-side shoulder / gutter
  maxGrade: number;
  vcMin: number; // vertical curve length range (m)
  vcMax: number;
  maxDeltaGrade: number; // biggest grade change at a single vertical curve
  vpiMin: number; // spacing between VPIs
  vpiMax: number;
  crown: number;
  speed: number; // nominal traffic speed (m/s)
}

export const CLASS_SPEC: Record<RoadClass, ClassSpec> = {
  back: { lanes: 1, laneW: 3.0, median: 0, margin: 0, shoulder: 0.25, maxGrade: 0.12, vcMin: 12, vcMax: 30, maxDeltaGrade: 0.24, vpiMin: 45, vpiMax: 170, crown: 0.015, speed: 11.5 },
  avenue: { lanes: 2, laneW: 3.25, median: 0, margin: 0, shoulder: 0.5, maxGrade: 0.08, vcMin: 30, vcMax: 70, maxDeltaGrade: 0.15, vpiMin: 90, vpiMax: 280, crown: 0.015, speed: 14.5 },
  arterial: { lanes: 3, laneW: 3.5, median: 1.0, margin: 0.25, shoulder: 0.75, maxGrade: 0.06, vcMin: 70, vcMax: 160, maxDeltaGrade: 0.1, vpiMin: 160, vpiMax: 420, crown: 0.015, speed: 16.5 },
};

export function kerbHalfWidth(c: RoadClass): number {
  const s = CLASS_SPEC[c];
  return s.median + s.margin + s.lanes * s.laneW + s.shoulder;
}

/** Hard-turn and signage events recorded along a path. */
export type EventType = 'hairpin' | 'switchbacks' | 'blockturn' | 'chicane' | 'tightening' | 'fork' | 'sweeper' | 'crest' | 'crosswalk';
export const HARD_TURNS: EventType[] = ['hairpin', 'switchbacks', 'blockturn', 'chicane', 'tightening'];

export interface RoadEvent {
  type: EventType;
  s0: number; // start of the feature on the path
  s1: number; // end
  dir: number; // +1 left turn, -1 right turn (first turn for chicanes/switchbacks)
  /** turn pieces inside the event: [sStart, sEnd, dir] (for chevrons and guard rails) */
  turns: [number, number, number][];
  /** minimum radius */
  radius: number;
  id: number;
}

/** A section of class along a path, with a taper at its start. */
export interface ClassSpan {
  s0: number; // taper start
  s1: number; // taper end (class fully `to` from here)
  from: RoadClass;
  to: RoadClass;
}

/** Cross-section at an arc length. All offsets are lateral t (left positive). */
export interface CrossSection {
  kerbL: number; // t of the left kerb (outbound side, > 0)
  kerbR: number; // t of the right kerb (< 0)
  median: number; // raised median half-width (0 = none)
  hatch: number; // half-width of painted hatching in the centre (taper to a median)
  laneW: number;
  lanesOut: number;
  lanesIn: number;
  margin: number;
  crown: number;
  cls: RoadClass;
  clsBlend: number; // 0..1 progress of the current taper
  fromCls: RoadClass;
}

export function laneCenter(xs: CrossSection, dir: 1 | -1, i: number): number {
  const inner = Math.max(xs.median, xs.hatch) + xs.margin;
  return dir * (inner + xs.laneW * (i + 0.5));
}
