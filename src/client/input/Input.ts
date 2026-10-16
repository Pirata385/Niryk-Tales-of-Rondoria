/**
 * Keyboard + mouse and touch (virtual joystick + buttons) → movement intent in SCREEN space
 * (x right, y down, length ≤ 1), run flag, attack presses and the mouse aim point.
 */
export class Input {
  /** Screen-space movement (x right, y down). */
  readonly move = { x: 0, y: 0 };
  run = false;
  /** Mouse position in css px (null when not over the canvas or on touch devices). */
  pointer: { x: number; y: number } | null = null;
  touchMode = false;
  private keys = new Set<string>();
  private attackPresses = 0;
  private attackAimed: { x: number; y: number } | null = null;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  onKey: (key: string) => void = () => {};
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly joystick: { base: HTMLElement; knob: HTMLElement },
  ) {
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window) => {
      target.addEventListener(t, f as EventListener, { passive: false });
      this.cleanup.push(() => target.removeEventListener(t, f as EventListener));
    };
    on('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) {
        if (k === ' ') this.attackPresses++;
        this.onKey(k);
      }
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    on('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on('blur', () => this.keys.clear());
    on('mousemove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
    });
    on(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        this.touchMode = false;
        this.attackPresses++;
        this.attackAimed = { x: e.clientX, y: e.clientY };
      },
      surface,
    );
    on('contextmenu', (e) => e.preventDefault(), surface);
    // touch: the left 55% of the screen is a floating joystick
    on(
      'touchstart',
      (e) => {
        this.touchMode = true;
        for (const t of Array.from(e.changedTouches)) {
          if (this.joyId === null && t.clientX < innerWidth * 0.55) {
            this.joyId = t.identifier;
            this.joyOrigin = { x: t.clientX, y: t.clientY };
            this.joyVec = { x: 0, y: 0 };
            this.showJoystick(true);
          }
        }
        e.preventDefault();
      },
      surface,
    );
    on('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
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
    });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          this.joyId = null;
          this.joyVec = { x: 0, y: 0 };
          this.showJoystick(false);
        }
      }
    };
    on('touchend', end);
    on('touchcancel', end);
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
    const k = this.joystick.knob.style;
    k.transform = `translate(${this.joyVec.x * R}px, ${this.joyVec.y * R}px)`;
  }

  /** On-screen attack button (touch). */
  pressAttack(): void {
    this.attackPresses++;
    this.attackAimed = null;
  }

  /** Reads and clears pending attack presses; returns the aim point for mouse clicks. */
  consumeAttack(): { pressed: boolean; at: { x: number; y: number } | null } {
    const pressed = this.attackPresses > 0;
    this.attackPresses = 0;
    const at = this.attackAimed;
    this.attackAimed = null;
    return { pressed, at };
  }

  update(): void {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
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
      this.move.y = len > 0.18 ? this.joyVec.y : 0;
      this.run = len > 0.82; // push to the edge to run
    } else {
      this.move.x = this.move.y = 0;
      this.run = false;
    }
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }
}
