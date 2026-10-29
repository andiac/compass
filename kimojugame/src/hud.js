// 界面：Boss 血条与部位、奇魔猪的装甲/推进/最后射击槽、武器、准星、锁定框、导弹来袭箭头、伤害数字、提示
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Hud {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = $('hud');
    this.e = {
      bossHp: $('boss-hp'), bossLag: $('boss-lag'), bossPhase: $('boss-phase'), chipL: $('chip-bayL'), chipR: $('chip-bayR'), chipF: $('chip-fn'), fnCount: $('fn-count'),
      hp: $('hp-fill'), hpNum: $('hp-num'), boost: $('boost-fill'), boostBar: $('boost-bar'), sp: $('sp-fill'), spBar: $('sp-bar'),
      ammo: $('ammo'), bz: $('bz-cd'), wBz: $('w-bz'), wSaber: $('w-saber'), wShield: $('w-shield'), wRifle: $('w-rifle'),
      cross: $('crosshair'), hit: $('hitmark'), lock: $('lock'), lockLabel: $('lock-label'), threats: $('threats'), toasts: $('toasts'),
      dmg: $('dmgnums'), vig: $('vignette'), warn: $('warn'), interrupt: $('interrupt'), intFill: $('int-fill'),
    };
    this.lag = 1;
    this.hitT = 0;
    this.vigT = 0;
    this.arrows = [];
    for (let i = 0; i < 8; i++) { const a = document.createElement('div'); a.className = 'threat'; a.textContent = '▲'; this.e.threats.appendChild(a); this.arrows.push(a); }
    this.nums = [];
    for (let i = 0; i < 24; i++) { const n = document.createElement('div'); n.className = 'dnum'; this.e.dmg.appendChild(n); this.nums.push({ el: n, t: 1, life: 0.8, pos: new THREE.Vector3(), alive: false }); }
    this.numIdx = 0;
    this.ammoPips = [];
    for (let i = 0; i < 12; i++) { const p = document.createElement('i'); this.e.ammo.appendChild(p); this.ammoPips.push(p); }
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  toast(text, color = 'white', dur = 1.6) {
    const el = document.createElement('div');
    el.className = `toast ${color}`;
    el.textContent = text;
    this.e.toasts.prepend(el);
    while (this.e.toasts.children.length > 4) this.e.toasts.lastChild.remove();
    setTimeout(() => el.classList.add('out'), dur * 1000);
    setTimeout(() => el.remove(), dur * 1000 + 500);
  }
  warn(text, color = 'green') {
    if (!text) { this.e.warn.classList.remove('on'); return; }
    this.e.warn.textContent = text;
    this.e.warn.className = `on ${color}`;
  }
  setInterrupt(frac) {
    if (frac < 0) { this.e.interrupt.classList.remove('on'); return; }
    this.e.interrupt.classList.add('on');
    this.e.intFill.style.width = `${Math.min(100, frac * 100)}%`;
  }
  hitMarker(weak) {
    this.hitT = 0.18;
    this.e.hit.classList.toggle('weak', !!weak);
  }
  damageFlash(k) { this.vigT = Math.max(this.vigT, 0.5 * k + 0.2); }
  flashPart(part) {
    const el = part === 'bayL' ? this.e.chipL : this.e.chipR;
    el.classList.add('broken');
  }
  damageNumber(pos, value, weak) {
    if (!pos || value < 1) return;
    const n = this.nums[this.numIdx]; this.numIdx = (this.numIdx + 1) % this.nums.length;
    n.alive = true; n.t = 0; n.life = weak ? 0.95 : 0.7;
    this.numStack = ((this.numStack || 0) + 1) % 4;
    n.pos.copy(pos).add(_v.set((Math.random() - 0.5) * 1.6, 0.3 + this.numStack * 0.45, (Math.random() - 0.5) * 1.6));
    n.el.textContent = value;
    n.el.className = `dnum show ${weak ? 'weak' : ''}`;
  }
  resetParts() { this.e.chipL.classList.remove('broken'); this.e.chipR.classList.remove('broken'); this.lag = 1; }
  setLock() { /* 锁定框在 update 里按锁定点更新 */ }

  project(p, out) {
    const cam = this.ctx.camera;
    _v2.copy(p).project(cam);
    const w = window.innerWidth, h = window.innerHeight;
    out.x = (_v2.x * 0.5 + 0.5) * w; out.y = (-_v2.y * 0.5 + 0.5) * h; out.z = _v2.z;
    return out;
  }

  update(dt) {
    const ctx = this.ctx, p = ctx.player, d = ctx.dragon, e = this.e;
    // Boss
    const hpf = Math.max(0, d.hp / d.maxHp);
    if (this.lag < hpf) this.lag = hpf; else this.lag = Math.max(hpf, this.lag - dt * 0.25);
    e.bossHp.style.width = `${hpf * 100}%`;
    e.bossLag.style.width = `${this.lag * 100}%`;
    e.bossPhase.textContent = ['', '第一阶段', '第二阶段', '第三阶段 · 狂暴'][d.phase] || '';
    e.bossPhase.classList.toggle('rage', d.phase === 3);
    e.fnCount.textContent = d.funnels.aliveCount;
    e.chipF.classList.toggle('active', d.funnels.active);
    e.chipF.classList.toggle('broken', d.funnels.aliveCount === 0);
    e.chipL.style.setProperty('--hp', `${Math.max(0, d.bays[0].hp / d.bays[0].maxHp) * 100}%`);
    e.chipR.style.setProperty('--hp', `${Math.max(0, d.bays[1].hp / d.bays[1].maxHp) * 100}%`);
    // 玩家
    e.hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
    e.hp.classList.toggle('low', p.hp / p.maxHp < 0.3);
    e.hpNum.textContent = Math.ceil(p.hp);
    e.boost.style.width = `${p.boost}%`;
    e.boostBar.classList.toggle('overheat', p.overheat);
    e.sp.style.width = `${p.special}%`;
    e.spBar.classList.toggle('full', p.special >= 100);
    const ammo = Math.floor(p.ammo);
    this.ammoPips.forEach((pip, i) => pip.classList.toggle('on', i < ammo));
    e.bz.textContent = p.bazookaCd > 0 ? p.bazookaCd.toFixed(1) : '就绪';
    e.wBz.classList.toggle('cd', p.bazookaCd > 0);
    e.wSaber.classList.toggle('on', p.state === 'slash');
    e.wShield.classList.toggle('on', p.shieldT > 0.5);
    e.wRifle.classList.toggle('on', p.aiming);
    // 命中标记
    this.hitT = Math.max(0, this.hitT - dt);
    e.hit.style.opacity = this.hitT > 0 ? 1 : 0;
    this.vigT = Math.max(0, this.vigT - dt * 1.4);
    e.vig.style.opacity = Math.min(1, this.vigT);
    // 锁定框
    const lp = p.getLockPoint();
    if (lp) {
      this.project(lp, _v);
      if (_v.z < 1) {
        e.lock.classList.add('on');
        e.lock.style.transform = `translate(${_v.x}px, ${_v.y}px) translate(-50%, -50%) rotate(45deg)`;
        e.lockLabel.textContent = p.lock.label || '';
      } else e.lock.classList.remove('on');
    } else e.lock.classList.remove('on');
    e.cross.classList.toggle('locked', !!lp);
    // 导弹来袭箭头
    const W = window.innerWidth, H = window.innerHeight;
    let k = 0;
    const cam = ctx.camera;
    for (const m of ctx.projectiles.missiles) {
      if (k >= this.arrows.length) break;
      const dist = m.pos.distanceTo(p.pos);
      if (dist > 45) continue;
      this.project(m.pos, _v);
      const on = _v.z < 1 && _v.x > 0 && _v.x < W && _v.y > 0 && _v.y < H;
      if (on) continue;
      // 屏幕外：箭头贴在屏幕边上指向导弹
      _v2.copy(m.pos).applyMatrix4(cam.matrixWorldInverse);
      let ax = _v2.x, ay = -_v2.y;
      if (_v2.z > 0) { ax = -ax; ay = -ay; }
      const ang = Math.atan2(ay, ax);
      const c = Math.cos(ang), s = Math.sin(ang);
      // 上边留出 Boss 血条的位置
      const rx = W / 2 - 60, ry = s < 0 ? H / 2 - 150 : H / 2 - 120;
      const sc = Math.min(Math.abs(rx / (c || 1e-6)), Math.abs(ry / (s || 1e-6)));
      const a = this.arrows[k++];
      a.style.display = 'block';
      a.style.transform = `translate(${W / 2 + c * sc}px, ${H / 2 + s * sc}px) translate(-50%, -50%) rotate(${ang + Math.PI / 2}rad)`;
      a.style.opacity = dist < 15 ? 1 : 0.6;
    }
    for (; k < this.arrows.length; k++) this.arrows[k].style.display = 'none';
    // 伤害数字
    for (const n of this.nums) {
      if (!n.alive) continue;
      n.t += dt;
      if (n.t > n.life) { n.alive = false; n.el.className = 'dnum'; continue; }
      n.pos.y += dt * 1.2;
      this.project(n.pos, _v);
      if (_v.z > 1) { n.el.style.opacity = 0; continue; }
      n.el.style.opacity = 1 - Math.max(0, (n.t - n.life * 0.5) / (n.life * 0.5));
      n.el.style.transform = `translate(${_v.x}px, ${_v.y}px) translate(-50%, -50%)`;
    }
  }
}
