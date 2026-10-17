import { clamp } from '../core/math';

/**
 * Keyboard, gamepad (with rumble) and touch, merged into one control state. Keyboard steering
 * ramps (so a tap is a small correction and a hold is full lock); analog inputs pass through
 * with a small dead zone. The game polls `read()` once per rendered frame.
 */
export interface Controls {
  steer: number; // +1 left
  throttle: number;
  brake: number;
  handbrake: boolean;
  boost: boolean;
  reset: boolean; // edge
  pause: boolean; // edge
  menu: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | null; // edge, gamepad menu navigation
  any: boolean; // any input this frame (edge) — title "press start"
  source: 'keyboard' | 'gamepad' | 'touch';
}

export interface TouchState { steer: number; throttle: number; brake: number; handbrake: boolean; boost: boolean; reset: boolean }

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>(); // edges since last read
  private kSteer = 0;
  private padPrev: boolean[] = [];
  private padIndex = -1;
  source: Controls['source'] = 'keyboard';
  touch: TouchState | null = null;
  private touchPrevReset = false;
  /** set by the game when the player touches the screen (shows touch controls) */
  onTouchSeen: (() => void) | null = null;
  onKeyboardSeen: (() => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.pressed.add(k);
      if (this.source !== 'keyboard') { this.source = 'keyboard'; this.onKeyboardSeen?.(); }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    target.addEventListener('blur', () => { this.keys.clear(); });
    target.addEventListener('touchstart', () => { if (this.source !== 'touch') { this.source = 'touch'; this.onTouchSeen?.(); } }, { passive: true });
    target.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') this.pressed.add('Mouse'); });
    target.addEventListener('gamepadconnected', (e) => { this.padIndex = (e as GamepadEvent).gamepad.index; });
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  read(dt: number): Controls {
    const k = this.keys;
    const has = (...c: string[]) => c.some((x) => k.has(x));
    const edge = (...c: string[]) => c.some((x) => this.pressed.has(x));
    const c: Controls = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, reset: false, pause: false, menu: null, any: false, source: this.source };
    // keyboard
    const left = has('ArrowLeft', 'KeyA'), right = has('ArrowRight', 'KeyD');
    const want = (left ? 1 : 0) - (right ? 1 : 0);
    if (want !== 0) this.kSteer = clamp(this.kSteer + want * dt * (Math.sign(this.kSteer) === -want ? 9 : 4.2), -1, 1);
    else this.kSteer -= Math.sign(this.kSteer) * Math.min(Math.abs(this.kSteer), dt * 7);
    c.steer = this.kSteer;
    c.throttle = has('ArrowUp', 'KeyW') ? 1 : 0;
    c.brake = has('ArrowDown', 'KeyS') ? 1 : 0;
    c.handbrake = has('Space');
    c.boost = has('ShiftLeft', 'ShiftRight');
    c.reset = edge('KeyR');
    c.pause = edge('Escape', 'KeyP');
    if (edge('ArrowUp', 'KeyW')) c.menu = 'up';
    if (edge('ArrowDown', 'KeyS')) c.menu = 'down';
    if (edge('ArrowLeft', 'KeyA')) c.menu = 'left';
    if (edge('ArrowRight', 'KeyD')) c.menu = 'right';
    if (edge('Enter', 'Space')) c.menu = 'confirm';
    if (edge('Escape', 'Backspace')) c.menu = 'back';
    c.any = this.pressed.size > 0;
    this.pressed.clear();

    // gamepad (standard mapping)
    const p = this.pad();
    if (p) {
      const b = (i: number) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      const bv = (i: number) => (p.buttons[i] ? p.buttons[i].value : 0);
      const now = p.buttons.map((_, i) => b(i));
      const pe = (i: number) => now[i] && !this.padPrev[i];
      const ax = p.axes[0] ?? 0;
      const st = Math.abs(ax) < 0.12 ? 0 : (ax - Math.sign(ax) * 0.12) / 0.88;
      const active = Math.abs(st) > 0 || bv(7) > 0.05 || bv(6) > 0.05 || now.some((x) => x);
      if (active && this.source !== 'gamepad') this.source = 'gamepad';
      if (this.source === 'gamepad' || active) {
        if (Math.abs(st) > Math.abs(c.steer)) c.steer = -Math.sign(st) * Math.pow(Math.abs(st), 1.4);
        c.throttle = Math.max(c.throttle, bv(7));
        c.brake = Math.max(c.brake, bv(6));
        c.handbrake = c.handbrake || b(0);
        c.boost = c.boost || b(2) || b(5);
      }
      if (pe(3)) c.reset = true;
      if (pe(9)) c.pause = true;
      if (pe(12)) c.menu = 'up';
      if (pe(13)) c.menu = 'down';
      if (pe(14)) c.menu = 'left';
      if (pe(15)) c.menu = 'right';
      if (pe(0)) c.menu = 'confirm';
      if (pe(1)) c.menu = 'back';
      // left stick as menu navigation too
      const ay = p.axes[1] ?? 0;
      const navY = ay < -0.6 ? 'up' : ay > 0.6 ? 'down' : null;
      const navX = ax < -0.6 ? 'left' : ax > 0.6 ? 'right' : null;
      const navKey = navY ?? navX;
      if (navKey && this.lastNav !== navKey) c.menu = navKey;
      this.lastNav = navKey;
      if (now.some((x, i) => x && !this.padPrev[i])) c.any = true;
      this.padPrev = now;
    }
    // touch
    const t = this.touch;
    if (t && this.source === 'touch') {
      c.steer = t.steer;
      c.throttle = t.throttle;
      c.brake = t.brake;
      c.handbrake = t.handbrake;
      c.boost = t.boost;
      if (t.reset && !this.touchPrevReset) c.reset = true;
      this.touchPrevReset = t.reset;
    }
    c.source = this.source;
    return c;
  }
  private lastNav: string | null = null;

  /** Gamepad rumble (no-op without a gamepad with an actuator). */
  rumble(strong: number, weak: number, ms: number) {
    const p = this.pad() as any;
    if (!p || this.source !== 'gamepad') return;
    const a = p.vibrationActuator;
    if (a && a.playEffect) {
      a.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
    }
  }
}
