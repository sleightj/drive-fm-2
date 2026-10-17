/**
 * Road generator checks, in Node, no rendering.
 *   npx tsx tools/road-check.ts [--seeds 1,2,3,4,5] [--km 100] [--map out-dir]
 * Drives a virtual player along the road exactly as the game streams it (generation ahead,
 * random branch at each fork, trimming behind) and checks every metre that was ever generated:
 * gaps, self-crossings, grades per class, elevation range, hard-turn types and their signs,
 * and (when roadside placement is available) building overlaps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RoadGenerator, BRANCH_HORIZON } from '../src/road/generator';
import { RoadStream } from '../src/road/stream';
import { Path, resetPathIds } from '../src/road/path';
import { CLASS_SPEC, CrossSection, HARD_TURNS, RoadClass } from '../src/road/types';
import { SpatialHash } from '../src/core/spatialHash';
import { Rng } from '../src/core/rng';
import { createCanvas } from '@napi-rs/canvas';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seeds = opt('seeds', '1,2,3,4,5').split(',').map(Number);
const KM = Number(opt('km', '100'));
const mapDir = opt('map', '');

interface Rec { pid: number; s: number; x: number; z: number; hw: number; dead?: boolean }

function check(seed: number) {
  resetPathIds(1);
  const t0 = Date.now();
  const gen = new RoadGenerator({ seed });
  const stream = new RoadStream(gen);
  const rng = new Rng(seed * 7 + 1);
  let cur: Path = gen.root;
  let s = 0;
  let driven = 0;
  const target = KM * 1000;

  // everything ever generated, recorded at 4 m (for crossings) — test only
  const recs = new SpatialHash<Rec>(40);
  const allRecs: Rec[] = [];
  const recorded = new Map<Path, number>();
  const xs: CrossSection = {} as any;
  const pe = { z: 0, g: 0, k: 0 };

  const stats = {
    seed, km: KM, maxGrade: { back: 0, avenue: 0, arterial: 0 } as Record<RoadClass, number>, gradeViolations: 0,
    zMin: Infinity, zMax: -Infinity, events: {} as Record<string, number>, forks: 0, gaps: 0, crossings: 0, kinks: 0, steps: 0,
    maxHeadingJump: 0, unsignedHardTurns: 0, minRadius: Infinity, paths: 0, maxPathsLive: 0, rejected: 0,
    crossingExamples: [] as string[], gapExamples: [] as string[], gradeExamples: [] as string[], stuck: 0, fallbacks: 0, airCrests: 0, crests: 0, profileFinalViolations: 0,
  };
  const pathSet = new Set<Path>();
  const lastProfileCheck = new Map<Path, number>();
  const finishedEvents = new Set<number>();
  const trace: { x: number; z: number; zz: number; cls: string }[] = [];

  // record & check every newly final metre of every live path
  const scan = () => {
    for (const p of gen.net.paths) {
      if (!pathSet.has(p)) { pathSet.add(p); stats.paths++; if (p.parent) parentOf.set(p.id, { parent: p.parent.id, forkS: p.parent.forkS ?? p.parent.length }); }
      const fin = Math.min(gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd);
      let from = lastProfileCheck.get(p) ?? 0;
      if (from < p.base) from = p.base;
      let prevZ = NaN;
      let prevG = 0;
      if (from > p.base) { p.profile.eval(from - 1, pe); prevZ = pe.z; }
      for (let si = from; si < fin; si++) {
        p.profile.eval(si, pe);
        const cls = p.clsAt(si);
        const g = Math.abs(pe.g);
        if (g > stats.maxGrade[cls]) stats.maxGrade[cls] = g;
        // a taper uses the stricter of its two classes (generator caps it so)
        const span = p.classAt(si);
        const lim = Math.max(CLASS_SPEC[span.from].maxGrade, CLASS_SPEC[span.to].maxGrade);
        if (g > CLASS_SPEC[cls].maxGrade + 1e-6 && g > lim + 1e-6) { stats.gradeViolations++; if (stats.gradeExamples.length < 6) stats.gradeExamples.push(`p${p.id}@${si} ${cls} ${(g * 100).toFixed(1)}%`); }
        if (pe.z < stats.zMin) stats.zMin = pe.z;
        if (pe.z > stats.zMax) stats.zMax = pe.z;
        if (!Number.isNaN(prevZ) && Math.abs(pe.z - prevZ) > 0.2) { stats.steps++; }
        // crest: grade changes sign from + to - here; air if v²·|k| > g below 30 m/s (108 km/h)
        if (prevG > 0 && pe.g <= 0) { stats.crests++; if (pe.k < 0 && Math.sqrt(9.81 / -pe.k) < 30) stats.airCrests++; }
        prevG = pe.g;
        prevZ = pe.z;
        // plan continuity: consecutive samples 1 m apart, heading change bounded by curvature
        if (si > p.base) {
          const d = Math.hypot(p.sx(si) - p.sx(si - 1), p.sz(si) - p.sz(si - 1));
          if (Math.abs(d - 1) > 0.02) { stats.gaps++; if (stats.gapExamples.length < 5) stats.gapExamples.push(`p${p.id} s${si} d=${d.toFixed(3)}`); }
          const dh = Math.abs(p.sh(si) - p.sh(si - 1));
          if (dh > stats.maxHeadingJump) stats.maxHeadingJump = dh;
          if (dh > 0.12) stats.kinks++;
          const k = Math.abs(p.sk(si));
          if (k > 0) stats.minRadius = Math.min(stats.minRadius, 1 / k);
        }
        // record for crossing checks every 4 m
        if (si % 2 === 0) {
          p.xsAt(si, xs);
          const [lo, hi] = p.drivableAt(si, xs);
          const hw = Math.max(hi, -lo);
          const r: Rec = { pid: p.id, s: si, x: p.sx(si), z: p.sz(si), hw };
          // crossing: any recorded sample from elsewhere closer than both half widths
          const R = hw + 30;
          let hit: Rec | null = null;
          recs.query(r.x - R, r.z - R, r.x + R, r.z + R, (o) => {
            if (o.pid === r.pid && Math.abs(o.s - r.s) < 1.6 * (o.hw + r.hw + 2.5) + 8) return;
            if (related(p, si, o)) return;
            const dd = Math.hypot(o.x - r.x, o.z - r.z);
            if (dd < o.hw + r.hw + 0.5) { hit = o; return true; }
          });
          if (hit) {
            stats.crossings++;
            const h = hit as Rec;
            if (stats.crossingExamples.length < 6) stats.crossingExamples.push(`p${p.id}@${si} vs p${h.pid}@${h.s} d=${Math.hypot(h.x - r.x, h.z - r.z).toFixed(1)} hw=${r.hw.toFixed(1)}+${h.hw.toFixed(1)}`);
          }
          recs.insert(r, r.x, r.z, r.x, r.z);
          if (mapDir) allRecs.push(r);
        }
      }
      lastProfileCheck.set(p, Math.max(from, fin));
      // events fully inside the checked range
      for (const e of p.events) {
        if (finishedEvents.has(e.id) || e.s1 > fin) continue;
        finishedEvents.add(e.id);
        stats.events[e.type] = (stats.events[e.type] ?? 0) + 1;
        if (HARD_TURNS.includes(e.type) && e.turns.length === 0) stats.unsignedHardTurns++;
      }
    }
    stats.maxPathsLive = Math.max(stats.maxPathsLive, gen.net.paths.length);
  };

  // drive
  const step = 25;
  while (driven < target) {
    stream.ensure(cur, s);
    scan();
    for (let k = 0; k < step; k++) {
      const sk = Math.min(s + k, cur.sampleEnd);
      if (sk < cur.base) continue;
      cur.profile.eval(sk, pe);
      trace.push({ x: cur.sx(Math.floor(sk)), z: cur.sz(Math.floor(sk)), zz: pe.z, cls: cur.clsAt(sk) });
    }
    s += step;
    driven += step;
    // fork?
    if (cur.forkS !== null && s >= cur.forkS) {
      const f = stream.forkOf(cur)!;
      // make sure both branches exist to the horizon before choosing
      stream.ensure(cur, s);
      scan();
      const pick = rng.chance(0.5) ? f.left : f.right;
      s = s - cur.forkS;
      cur = pick;
      stats.forks++;
      // commit once past the gore nose
      stream.ensure(cur, s);
    }
    if (cur.junctionStart && s > cur.junctionStart.nose) stream.enter(cur);
    stream.trim(cur, s);
  }
  scan();
  stats.rejected = gen.stats.rejected;
  stats.stuck = gen.stats.stuck;
  stats.fallbacks = gen.stats.fallbacks;
  const elapsed = Date.now() - t0;
  return { stats, elapsed, gen, recs, allRecs, trace };
}

/** Family links recorded when a path is first seen (paths are discarded later; the links stay). */
const parentOf = new Map<number, { parent: number; forkS: number }>();
/** Samples that are meant to touch: a trunk and its branches at the junction, siblings at their shared start. */
function related(p: Path, s: number, o: Rec): boolean {
  const near = 260;
  const mine = parentOf.get(p.id), theirs = parentOf.get(o.pid);
  // o is on my parent's approach to the fork
  if (mine && mine.parent === o.pid && s < near && o.s > mine.forkS - near) return true;
  // o is on my child's opening (my samples near my fork end)
  if (theirs && theirs.parent === p.id && o.s < near && s > theirs.forkS - near) return true;
  // siblings at their shared start
  if (mine && theirs && mine.parent === theirs.parent && s < near && o.s < near) return true;
  return false;
}

const results: any[] = [];
function drawMap(seed: number, allRecs: Rec[], driven: { x: number; z: number; zz: number; cls: string }[]) {
  const sel = allRecs;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const d of driven) { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); z0 = Math.min(z0, d.z); z1 = Math.max(z1, d.z); }
  const pad = 300; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  const W = 1400, sc = W / (x1 - x0), H = Math.min(6000, Math.ceil((z1 - z0) * sc));
  const cv = createCanvas(W, H + 300);
  const g = cv.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H + 300);
  const X = (x: number) => (x - x0) * sc, Y = (z: number) => H - (z - z0) * sc;
  for (const r of sel) { g.fillStyle = '#999'; g.beginPath(); g.arc(X(r.x), Y(r.z), Math.max(0.6, r.hw * sc), 0, 7); g.fill(); }
  const col: Record<string, string> = { back: '#d0402a', avenue: '#2a62d0', arterial: '#222' };
  for (let i = 0; i < driven.length; i += 2) { const d = driven[i]; g.fillStyle = col[d.cls]; g.fillRect(X(d.x) - 1, Y(d.z) - 1, 2, 2); }
  // profile strip of the first 20 km driven
  const n = Math.min(driven.length, 20000);
  g.strokeStyle = '#333'; g.beginPath();
  for (let i = 0; i < n; i++) { const px = (i / n) * W, py = H + 150 - driven[i].zz * 2.5; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
  g.stroke();
  fs.writeFileSync(path.join(mapDir, `road-seed${seed}.png`), cv.toBuffer('image/png'));
}
for (const seed of seeds) {
  const { stats, elapsed, allRecs, trace } = check(seed);
  if (mapDir) { fs.mkdirSync(mapDir, { recursive: true }); drawMap(seed, allRecs, trace); }
  results.push(stats);
  const hard = HARD_TURNS.map((t) => `${t}:${stats.events[t] ?? 0}`).join(' ');
  console.log(`seed ${seed}: ${KM} km in ${(elapsed / 1000).toFixed(1)} s | gaps ${stats.gaps} crossings ${stats.crossings} kinks ${stats.kinks} steps ${stats.steps} | grade back ${(stats.maxGrade.back * 100).toFixed(1)}% avenue ${(stats.maxGrade.avenue * 100).toFixed(1)}% arterial ${(stats.maxGrade.arterial * 100).toFixed(1)}% violations ${stats.gradeViolations} | z ${stats.zMin.toFixed(1)}..${stats.zMax.toFixed(1)} | forks ${stats.forks} | ${hard} | minR ${stats.minRadius.toFixed(1)} | unsigned ${stats.unsignedHardTurns} | paths ${stats.paths} (live max ${stats.maxPathsLive}) | fallbacks ${stats.fallbacks} stuck ${stats.stuck} | crests ${stats.crests} air<108kmh ${stats.airCrests}`);
  if (stats.gradeExamples.length) console.log('  grades:', stats.gradeExamples.join('; '));
  if (stats.crossingExamples.length) console.log('  crossings:', stats.crossingExamples.join('; '));
  if (stats.gapExamples.length) console.log('  gaps:', stats.gapExamples.join('; '));
}
if (mapDir) fs.writeFileSync(path.join(mapDir, 'road-check.json'), JSON.stringify(results, null, 1));
const bad = results.some((r) => r.stuck || r.gaps || r.crossings || r.gradeViolations || r.kinks || r.steps || r.unsignedHardTurns || HARD_TURNS.some((t) => !r.events[t]));
process.exit(bad ? 1 : 0);
