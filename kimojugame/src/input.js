// 键盘、鼠标、指针锁定（被拒绝时可以按住鼠标拖动转视角）
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.btnPressed = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.lockFailed = false;
    this.enabled = true;
    const block = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    window.addEventListener('keydown', (e) => {
      if (block.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    dom.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button); this.btnPressed.add(e.button);
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.buttons.delete(e.button); });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.buttons.size > 0) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; }
    });
    dom.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
  }
  requestLock() {
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { this.lockFailed = true; });
    } catch (e) { this.lockFailed = true; }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  btn(b) { return this.enabled && this.buttons.has(b); }
  btnHit(b) { return this.enabled && this.btnPressed.has(b); }
  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }
  endFrame() { this.pressed.clear(); this.btnPressed.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; }
}
