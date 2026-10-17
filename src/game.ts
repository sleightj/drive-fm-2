import { Color, PerspectiveCamera, Scene, WebGLRenderer, Vector3 } from 'three';
import { RoadGenerator } from './road/generator';
import { RoadStream } from './road/stream';
import { RoadSurface } from './road/surface';
import { WearField } from './road/wear';
import { Path } from './road/path';
import { ChunkManager } from './world/chunks';
import { TerrainField } from './world/terrain';
import { TerrainClipmap } from './world/terrainClipmap';
import { loadWorldLayers, WorldLayers } from './render/worldTextures';
import { GROUND_LAYERS, GROUND_TILES, SURFACES } from './world/kit/street';
import { Roadside } from './world/roadside';
import { Footprints } from './world/footprints';
import { makeWorldMaterial } from './render/worldMaterial';
import { makeActorMaterial, makeInkMaterial } from './render/actorMaterial';
import { PROP_STYLE, PROP_SLOTS_LIST } from './world/kit/propStyle';
import { makeRoadMaterial, makeWearPool } from './render/roadMaterial';
import { makeSky } from './render/sky';
import { env, applyTimeOfDay, TIME_NAMES } from './render/environment';
import { Car, CarInput } from './vehicle/car';
import { CarVisual } from './vehicle/carVisual';
import { ChaseCamera } from './vehicle/camera';
import { loadVehicle, VehicleAsset } from './render/actorAssets';
import { VEHICLE_SLOTS } from './render/actorMaterial';
import { Input } from './input/input';
import { Autopilot } from './debug/autopilot';
import { MOOD_FOG, asphaltTone } from './world/moodLook';
import { MOODS } from './world/moods';
import { fbm1 } from './core/noise';
import { hash32 } from './core/rng';
import { clamp } from './core/math';

export type GameState = 'boot' | 'title' | 'driving' | 'paused';
export type GraphicsLevel = 'high' | 'low' | 'verylow';

export interface LevelSpec {
  scale: number; // render scale
  radius: number; // near city radius
  wearLayers: number;
  wearPx: number;
  wearW: number;
  wearH: number;
  budgetMs: number; // world-build slice
  detail: number;
  terrainLevels: number;
  terrainMs: number; // terrain slice
  nearR: number; // detailed roadside within this distance
  texScale: number; // world texture size
}

export const LEVELS: Record<GraphicsLevel, LevelSpec> = {
  high: { scale: 1, radius: 1100, wearLayers: 40, wearPx: 8, wearW: 512, wearH: 256, budgetMs: 4, detail: 1, terrainLevels: 5, terrainMs: 1.5, texScale: 1, nearR: 450 },
  low: { scale: 0.85, radius: 800, wearLayers: 32, wearPx: 5, wearW: 256, wearH: 128, budgetMs: 3, detail: 0.6, terrainLevels: 4, terrainMs: 1, texScale: 0.5, nearR: 320 },
  verylow: { scale: 0.6, radius: 500, wearLayers: 24, wearPx: 4, wearW: 256, wearH: 128, budgetMs: 2, detail: 0.3, terrainLevels: 4, terrainMs: 0.8, texScale: 0.5, nearR: 220 },
};

const DT = 1 / 120;
const DAY_SECONDS = 720; // a full day in 12 minutes

export interface GameOptions {
  seed: number;
  level: GraphicsLevel;
  hour: number;
  autopilot: boolean;
  /** simulation steps per rendered frame multiplier (tests) */
  simRate: number;
  freezeTime: boolean;
  /** every frame advances exactly 1/60 s of game time (benchmarks: same work per metre at any frame rate) */
  fixedStep?: boolean;
}

export class Game {
  state: GameState = 'boot';
  renderer: WebGLRenderer;
  scene = new Scene();
  camera: PerspectiveCamera;
  gen: RoadGenerator;
  stream: RoadStream;
  surface: RoadSurface;
  wear: WearField;
  chunks!: ChunkManager;
  terrain: TerrainField;
  clip!: TerrainClipmap;
  tex!: WorldLayers;
  roadside!: Roadside;
  foot = new Footprints();
  car: Car;
  visual!: CarVisual;
  chase: ChaseCamera;
  input: Input;
  autopilot: Autopilot;
  hour: number;
  level: LevelSpec;
  originX = 0;
  originZ = 0;
  private acc = 0;
  private last = 0;
  private titleT = 0;
  frame = 0;
  simTime = 0;
  lastInput: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
  metrics = { frameMs: 0, simMs: 0, worldMs: 0, terrainMs: 0, renderMs: 0, maxFrameMs: 0, pendingChunks: 0, pendingTerrain: 0 };
  heroAsset!: VehicleAsset;
  onState: ((s: GameState) => void) | null = null;
  private moodW = [0, 0, 0, 0, 0, 0];
  private fogTint = new Color();

  constructor(public canvasParent: HTMLElement, public opt: GameOptions) {
    this.level = LEVELS[opt.level];
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.level.scale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    canvasParent.appendChild(this.renderer.domElement);
    this.camera = new PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.3, 6000);
    this.chase = new ChaseCamera(this.camera);
    window.addEventListener('resize', () => this.resize());
    this.gen = new RoadGenerator({ seed: opt.seed });
    this.stream = new RoadStream(this.gen);
    this.wear = new WearField(opt.seed, (x, z) => this.gen.districts.moodAt(x, z));
    this.surface = new RoadSurface(this.gen.net, this.wear);
    this.terrain = new TerrainField(opt.seed, this.gen.districts);
    this.car = new Car(this.surface);
    this.input = new Input();
    this.autopilot = new Autopilot(this.stream, opt.seed);
    this.hour = opt.hour;
    this.scene.add(makeSky());
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    env.uResolution.value.set(window.innerWidth * this.renderer.getPixelRatio(), window.innerHeight * this.renderer.getPixelRatio(), 1);
  }

  async load(progress: (p: number, label: string) => void) {
    const t0 = performance.now();
    progress(0.05, 'road');
    // the first stretch of road
    this.stream.ensure(this.gen.root, 0);
    const L = this.level;
    const wearTex = makeWearPool(L.wearLayers, L.wearW, L.wearH);
    const roadMat = makeRoadMaterial(wearTex, L.wearPx, L.detail);
    progress(0.2, 'car and textures');
    const texP = loadWorldLayers('./assets/tex', L.texScale);
    this.heroAsset = await loadVehicle('./assets/cars/hero.glb', VEHICLE_SLOTS);
    this.tex = await texP;
    const tl = (m: string) => this.tex.L(GROUND_LAYERS[m as keyof typeof GROUND_LAYERS]);
    this.clip = new TerrainClipmap(this.terrain, {
      levels: L.terrainLevels,
      moodLayers: MOODS.map((m) => tl(m)),
      moodTiles: MOODS.map((m) => GROUND_TILES[m]),
      slopeLayer: this.tex.L(SURFACES.earth.layer),
      slopeTile: SURFACES.earth.tile,
      albedo: this.tex.albedo,
    });
    this.scene.add(this.clip.root);
    const worldMat = makeWorldMaterial({ albedo: this.tex.albedo, emit: this.tex.emit, cutout: true });
    const decalMat = makeWorldMaterial({ albedo: this.tex.albedo, emit: this.tex.emit, cutout: true });
    decalMat.polygonOffset = true;
    decalMat.polygonOffsetFactor = -1;
    decalMat.polygonOffsetUnits = -4;
    const propMat = makeActorMaterial({ style: PROP_STYLE, slots: PROP_SLOTS_LIST });
    const inkMat = makeInkMaterial(1);
    this.roadside = new Roadside({
      gen: this.gen, surface: this.surface, terrain: this.terrain, clip: this.clip, tex: this.tex,
      mats: { world: worldMat, decal: decalMat, prop: propMat, ink: inkMat }, foot: this.foot,
      seed: this.opt.seed, nearR: L.nearR, detail: L.detail,
    });
    this.chunks = new ChunkManager(this.gen, this.surface, wearTex, roadMat, {
      radius: L.radius, wearRadius: 260, wearLayers: L.wearLayers, wearW: L.wearW, wearH: L.wearH, wearPx: L.wearPx,
    }, {
      roadside: (c) => this.roadside.jobsFor(c),
      upgrade: (c) => this.roadside.upgradeJobs(c),
      removed: (c) => this.roadside.removed(c),
    }, (p, s) => this.tone(p, s));
    this.scene.add(this.chunks.root);
    this.visual = new CarVisual(this.heroAsset);
    this.scene.add(this.visual.root, this.visual.shadow);
    // park on the start straight
    const p = this.gen.root;
    this.car.place(p, 60, 1.6);
    this.rebase(this.car.x, this.car.z);
    progress(0.4, 'city');
    // build the nearest chunks before the first frame
    progress(0.5, 'land');
    this.syncTerrain();
    this.clip.update(this.car.x, this.car.z, 1e9, true);
    progress(0.7, 'city');
    let guard = 0;
    while (this.chunks.update(this.car.x, this.car.z, 1e9) > 0 && guard++ < 50) { /* all */ }
    progress(0.95, 'ready');
    this.resize();
    this.applyEnv(0);
    (window as any).__DRIVE_FM_LOAD__ = { ms: performance.now() - t0 };
  }

  private tone(p: Path, s: number): [number, number, number] {
    const pt = { x: 0, z: 0, h: 0, k: 0 };
    p.pointAt(s, pt);
    const mood = this.gen.districts.moodAt(pt.x, pt.z);
    const age = 0.5 + 0.5 * fbm1(hash32(this.opt.seed, 9, p.id), s / 260, 2);
    return asphaltTone(p.clsAt(s), mood, age);
  }

  setState(s: GameState) {
    this.state = s;
    this.onState?.(s);
  }

  start() {
    this.last = performance.now();
    this.setState('title');
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Re-centre the render origin near (x, z): keeps every float on the GPU small. */
  private rebase(x: number, z: number) {
    this.originX = Math.round(x / 100) * 100;
    this.originZ = Math.round(z / 100) * 100;
    this.chunks.rebase(this.originX, this.originZ);
    this.clip?.setOrigin(this.originX, this.originZ);
  }

  /** Keep the land's road stations in step with the live network. */
  private syncTerrain() {
    const rects = this.terrain.sync(this.gen.net.paths, (p) => Math.min(this.gen.finalEnd(p), p.forkS ?? Infinity, p.sampleEnd));
    if (rects.length) this.clip.invalidate(rects);
  }

  private applyEnv(dt: number) {
    if (!this.opt.freezeTime && this.state === 'driving') this.hour = (this.hour + (dt * 24) / DAY_SECONDS) % 24;
    // fog tint from the moods around the camera
    const cx = this.camera.position.x + this.originX, cz = this.camera.position.z + this.originZ;
    this.gen.districts.moodWeights(cx, cz, this.moodW);
    this.fogTint.setRGB(0, 0, 0);
    let amt = 0;
    for (let i = 0; i < 6; i++) {
      const w = this.moodW[i];
      if (w <= 0) continue;
      const f = MOOD_FOG[MOODS[i]];
      this.fogTint.r += f.tint.r * w; this.fogTint.g += f.tint.g * w; this.fogTint.b += f.tint.b * w;
      amt += f.amount * w;
    }
    const st = applyTimeOfDay(this.hour, this.fogTint, amt);
    env.uTime.value += dt;
    env.uCamPos.value.copy(this.camera.position);
    return st;
  }

  private tick() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = this.opt.fixedStep ? 1 / 60 : Math.min(dt, 0.1);
    const f0 = performance.now();
    const ctl = this.input.read(dt);
    this.frame++;

    // ---- state machine
    if (this.state === 'title' && (ctl.any || this.opt.autopilot)) this.setState('driving');
    else if (this.state === 'driving' && ctl.pause) this.setState('paused');
    else if (this.state === 'paused' && ctl.pause) this.setState('driving');

    // ---- simulation (fixed step)
    const s0 = performance.now();
    if (this.state === 'driving') {
      this.acc += dt * this.opt.simRate;
      let n = 0;
      while (this.acc >= DT && n < 12 * Math.max(1, this.opt.simRate)) {
        const inp = this.opt.autopilot ? this.autopilot.drive(this.car) : { steer: ctl.steer, throttle: ctl.throttle, brake: ctl.brake, handbrake: ctl.handbrake, boost: ctl.boost };
        this.lastInput = inp;
        this.car.step(DT, inp);
        this.simTime += DT;
        this.acc -= DT;
        n++;
        this.roadBookkeeping();
      }
      if (ctl.reset) this.resetCar();
    }
    this.metrics.simMs = performance.now() - s0;

    // ---- render origin
    if (Math.hypot(this.car.x - this.originX, this.car.z - this.originZ) > 1000) this.rebase(this.car.x, this.car.z);

    // ---- visuals
    const st = this.applyEnv(dt);
    const braking = this.lastInput.brake > 0.1 && this.car.speed > 0.5;
    const reversing = this.car.speed < -0.3;
    this.visual.update(this.car, dt, this.originX, this.originZ, st.lamps, braking, reversing);
    if (this.state === 'title') this.titleCamera(dt);
    else this.chase.update(this.car, dt, this.originX, this.originZ, this.car.boosting ? 1 : 0);
    // headlights on the world
    const hd = new Vector3(Math.sin(this.car.yaw), -0.08, Math.cos(this.car.yaw)).normalize();
    env.uHeadDir.value.copy(hd);
    env.uHeadPos.value.set(this.car.x - this.originX + hd.x * 2.2, this.car.y + 0.2, this.car.z - this.originZ + hd.z * 2.2);
    env.uHeadOn.value = clamp(st.lamps, 0, 1);

    // ---- world streaming (time-sliced): land first, so the roadside stands on current ground
    this.syncTerrain();
    const w0 = performance.now();
    this.metrics.pendingChunks = this.chunks.update(this.car.x, this.car.z, this.level.budgetMs * Math.max(1, this.opt.simRate));
    this.metrics.worldMs = performance.now() - w0;
    const t0 = performance.now();
    this.metrics.pendingTerrain = this.clip.update(this.camera.position.x + this.originX, this.camera.position.z + this.originZ, this.level.terrainMs * Math.max(1, this.opt.simRate));
    this.metrics.terrainMs = performance.now() - t0;

    // ---- rumble
    if (this.car.impact > 0.5) this.input.rumble(clamp(this.car.impact / 6, 0, 1), 0.5, 120);
    else if (this.car.bump > 0.6) this.input.rumble(0.15, clamp(this.car.bump / 3, 0, 0.6), 60);
    if (this.car.impact > 1.2) this.chase.shake = Math.min(1.5, this.car.impact * 0.2);

    const r0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.metrics.renderMs = performance.now() - r0;
    this.metrics.frameMs = performance.now() - f0;
    if (this.frame > 30) this.metrics.maxFrameMs = Math.max(this.metrics.maxFrameMs, this.metrics.frameMs);
    if (this.rec) {
      const m = this.metrics, ri = this.renderer.info.render;
      this.rec.push(m.frameMs, m.simMs, m.worldMs, m.terrainMs, m.renderMs, ri.calls, ri.triangles, this.car.odometer);
    }
  }
  /** Per-frame samples for the perf tools: frameMs, simMs, worldMs, terrainMs, renderMs, calls, triangles, odometer. */
  rec: number[] | null = null;

  /** Generation ahead, commit at forks, trimming behind: the road follows the car. */
  private roadBookkeeping() {
    const loc = this.car.loc;
    if (!loc.path) return;
    if (this.stepCount++ % 12 !== 0) return;
    this.stream.ensure(loc.path, loc.s, 2);
    const js = loc.path.junctionStart;
    if (js && loc.s > js.nose) this.stream.enter(loc.path);
    const removed = this.stream.trim(loc.path, loc.s);
    for (const p of removed) this.wear.drop(p);
    if (removed.length) this.roadside.trimRuns(new Set(this.gen.net.paths.map((q) => q.id)));
    this.wear.trim(loc.path, loc.s - 400);
  }
  private stepCount = 0;

  resetCar() {
    const loc = this.car.loc;
    if (!loc.path) return;
    const p = loc.path;
    const s = Math.max(p.base + 5, Math.min(loc.s, p.sampleEnd - 5));
    const xs: any = {};
    p.xsAt(s, xs);
    const t = xs.kerbL > 3 ? Math.min(xs.kerbL - 1.8, Math.max(1.7, loc.t)) : 1.6;
    this.car.place(p, s, t);
    this.chase.reset();
  }

  private titleCamera(dt: number) {
    this.titleT += dt;
    const a = this.titleT * 0.08 + 2.3;
    const cx = this.car.x - this.originX, cz = this.car.z - this.originZ;
    const r = 7.5 + Math.sin(this.titleT * 0.2) * 0.8;
    this.camera.position.set(cx + Math.sin(this.car.yaw + a) * r, this.car.y + 0.9 + Math.sin(this.titleT * 0.13) * 0.3, cz + Math.cos(this.car.yaw + a) * r);
    this.camera.lookAt(cx, this.car.y - 0.2, cz);
    if (Math.abs(this.camera.fov - 52) > 0.01) { this.camera.fov = 52; this.camera.updateProjectionMatrix(); }
  }

  setHour(h: number | string) {
    this.hour = typeof h === 'string' ? TIME_NAMES[h] ?? 12 : h;
  }
}
