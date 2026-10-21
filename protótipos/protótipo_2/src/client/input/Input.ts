/** Radians per css px of mouse movement (pointer locked) and of a look drag (mouse or finger). */
const MOUSE_SENS = 0.0024;
const DRAG_SENS = 0.0042;
const TOUCH_SENS = 0.0062;
/** A press that moves less than this (px) is a click, not a look drag. */
const CLICK_SLOP = 6;
const MAX_EVENT_MOVE = 250;
const clampMove = (v: number) => Math.max(-MAX_EVENT_MOVE, Math.min(MAX_EVENT_MOVE, v));

export interface InputOptions {
  /** Elements whose touches are their own (buttons): they never start a joystick or a look drag. */
  ignore: () => HTMLElement[];
}

/**
 * Keyboard + mouse and touch → movement intent RELATIVE TO THE CAMERA (x right, y forward, length
 * ≤ 1), run flag, camera look deltas (radians) and attack presses.
 *
 * Desktop: WASD/arrows, Shift runs. A click captures the mouse (pointer lock) and from then on the
 * mouse looks and a left click attacks; Esc releases it (the browser does). Where pointer lock is
 * not available (some embedded pages), dragging looks and a click attacks.
 * Touch: a floating joystick on the left half (pushed to the edge it runs) and a look drag on the
 * right half; buttons (attack, view) are HUD elements that call pressAttack / onKey.
 */
export class Input {
  /** Camera-relative movement: x to the right, y forward. */
  readonly move = { x: 0, y: 0 };
  run = false;
  touchMode = false;
  /** The mouse is captured (pointer lock). */
  locked = false;
  /** Pointer lock failed once: dragging looks and a click attacks. */
  lockUnavailable = false;
  onKey: (key: string) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  private readonly keys = new Set<string>();
  private attackPresses = 0;
  private lookX = 0;
  private lookY = 0;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly joystick: { base: HTMLElement; knob: HTMLElement },
    private readonly opts: InputOptions,
  ) {
    const on = <K extends keyof (WindowEventMap & DocumentEventMap)>(
      t: K,
      f: (e: (WindowEventMap & DocumentEventMap)[K]) => void,
      target: Window | Document | HTMLElement = window,
    ) => {
      target.addEventListener(t, f as EventListener, { passive: false });
      this.cleanup.push(() => target.removeEventListener(t, f as EventListener));
    };

    // ---------------------------------------------------------------- keyboard
    on('keydown', (e) => {
      const k = e.key.toLowerCase();
      // browsers release the pointer lock on Esc by themselves; some (headless, embedded views) only
      // deliver the key, so release it here too - and an Esc that frees the mouse does nothing else
      if (k === 'escape' && this.locked) {
        this.releaseLock();
        return;
      }
      if (!this.keys.has(k)) this.onKey(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    });
    on('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on('blur', () => {
      this.keys.clear();
      this.drag = null;
    });

    // ---------------------------------------------------------------- mouse
    on('pointerlockchange', () => {
      this.locked = document.pointerLockElement === surface;
      this.onLockChange(this.locked);
    }, document);
    on('pointerlockerror', () => {
      this.lockUnavailable = true;
      this.onLockChange(false);
    }, document);
    on(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        this.touchMode = false;
        if (this.locked) this.attackPresses++;
        else this.drag = { x: e.clientX, y: e.clientY, moved: false };
      },
      surface,
    );
    on('mousemove', (e) => {
      if (this.locked) {
        // some browsers report a spurious jump right after locking: cap a single event
        this.lookX += clampMove(e.movementX) * MOUSE_SENS;
        this.lookY += clampMove(e.movementY) * MOUSE_SENS;
        return;
      }
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) d.moved = true;
      if (d.moved) {
        this.lookX += e.movementX * DRAG_SENS;
        this.lookY += e.movementY * DRAG_SENS;
      }
    });
    on('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || e.button !== 0 || d.moved || this.locked) return;
      if (this.lockUnavailable) this.attackPresses++;
      else this.requestLock();
    });
    on('contextmenu', (e) => e.preventDefault(), surface);

    // ---------------------------------------------------------------- touch
    const own = (t: EventTarget | null) => this.opts.ignore().some((b) => b.contains(t as Node));
    on(
      'touchstart',
      (e) => {
        this.touchMode = true;
        for (const t of Array.from(e.changedTouches)) {
          if (own(t.target)) continue;
          if (t.clientX < innerWidth * 0.5) {
            if (this.joyId !== null) continue;
            this.joyId = t.identifier;
            this.joyOrigin = { x: t.clientX, y: t.clientY };
            this.joyVec = { x: 0, y: 0 };
            this.showJoystick(true);
          } else if (this.lookId === null) {
            this.lookId = t.identifier;
            this.lookLast = { x: t.clientX, y: t.clientY };
          }
        }
        if (e.cancelable) e.preventDefault();
      },
      surface,
    );
    on('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.lookId) {
          this.lookX += (t.clientX - this.lookLast.x) * TOUCH_SENS;
          this.lookY += (t.clientY - this.lookLast.y) * TOUCH_SENS;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
        if (t.identifier !== this.joyId) continue;
        const R = this.joyRadius;
        let dx = (t.clientX - this.joyOrigin.x) / R;
        let dy = (t.clientY - this.joyOrigin.y) / R;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          // drag the base along so the stick never "sticks" at the edge
          this.joyOrigin.x = t.clientX - (dx / len) * R;
          this.joyOrigin.y = t.clientY - (dy / len) * R;
          dx /= len;
          dy /= len;
        }
        this.joyVec = { x: dx, y: dy };
        this.positionJoystick();
      }
      // no page scroll or pinch zoom while playing
      if (e.cancelable) e.preventDefault();
    });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          this.joyId = null;
          this.joyVec = { x: 0, y: 0 };
          this.showJoystick(false);
        }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    on('touchend', end);
    on('touchcancel', end);
    // iOS Safari: pinch and double-tap zoom ignore touch-action on some versions
    on('gesturestart' as keyof WindowEventMap, (e) => e.preventDefault(), document);
    on('dblclick', (e) => e.preventDefault(), document);
  }

  /** Captures the mouse (desktop). A refusal marks pointer lock as unavailable. */
  requestLock(): void {
    try {
      const r = this.surface.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') {
        r.catch(() => {
          this.lockUnavailable = true;
          this.onLockChange(false);
        });
      }
      if (!this.surface.requestPointerLock) this.lockUnavailable = true;
    } catch {
      this.lockUnavailable = true;
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.surface) document.exitPointerLock();
  }

  private get joyRadius(): number {
    return Math.max(44, Math.min(70, Math.min(innerWidth, innerHeight) * 0.12));
  }

  private showJoystick(v: boolean): void {
    this.joystick.base.style.display = v ? 'block' : 'none';
    if (v) this.positionJoystick();
  }

  private positionJoystick(): void {
    const R = this.joyRadius;
    const b = this.joystick.base.style;
    b.width = b.height = `${R * 2}px`;
    b.left = `${this.joyOrigin.x - R}px`;
    b.top = `${this.joyOrigin.y - R}px`;
    this.joystick.knob.style.transform = `translate(${this.joyVec.x * R}px, ${this.joyVec.y * R}px)`;
    this.joystick.base.classList.toggle('run', Math.hypot(this.joyVec.x, this.joyVec.y) > 0.82);
  }

  /** On-screen attack button (touch), or a test. */
  pressAttack(): void {
    this.attackPresses++;
  }

  /** Reads and clears the attack presses since the last call. */
  consumeAttack(): boolean {
    const pressed = this.attackPresses > 0;
    this.attackPresses = 0;
    return pressed;
  }

  /**
   * Reads and clears the look since the last call: radians to turn right (x) and down (y).
   * The returned object is reused.
   */
  consumeLook(out = { x: 0, y: 0 }): { x: number; y: number } {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = this.lookY = 0;
    return out;
  }

  update(): void {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (x || y) {
      const l = Math.hypot(x, y);
      this.move.x = x / l;
      this.move.y = y / l;
      this.run = this.keys.has('shift');
    } else if (this.joyId !== null) {
      const len = Math.hypot(this.joyVec.x, this.joyVec.y);
      this.move.x = len > 0.18 ? this.joyVec.x : 0;
      this.move.y = len > 0.18 ? -this.joyVec.y : 0;
      this.run = len > 0.82; // push to the edge to run
    } else {
      this.move.x = this.move.y = 0;
      this.run = false;
    }
  }

  dispose(): void {
    this.releaseLock();
    for (const c of this.cleanup) c();
  }
}
