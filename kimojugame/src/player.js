// 玩家：3D 元祖高达奇魔猪
// 规则（沿用前几部）：脸只是印上去的豆豆眼和空心圈圈鼻孔，永远不眨不闭；手和武器不挡脸；
// 推进只从背包喷口喷火，脚底永远不喷火；落地像糯米团一样软软地压扁再弹回来。
import * as THREE from 'three';
import { buildPig, PIG_SHOULDER, PIG_REACH, PIG_BODY_PIVOT } from './pigModel.js';
import { clamp, damp, dampAngle, lerp, rand, Spring, wrapAngle, easeOutCubic, easeInOutSine, segmentSphere } from './util.js';
import { glowMaterial } from './materials.js';
import { PINK } from './projectiles.js';
import { ARENA_RADIUS } from './world.js';

const DOWN = new THREE.Vector3(0, -1, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _aimO = new THREE.Vector3(), _aimD = new THREE.Vector3(), _muz = new THREE.Vector3(), _wish = new THREE.Vector3();
const SH_R = new THREE.Vector3(-PIG_SHOULDER.x, PIG_SHOULDER.y - PIG_BODY_PIVOT, 0);
const SH_L = new THREE.Vector3(PIG_SHOULDER.x, PIG_SHOULDER.y - PIG_BODY_PIVOT, 0);
const PINK_SPARK = { r: 3.0, g: 1.0, b: 2.2 };

// 三段斩：每段的刃方向（身体局部坐标，+Z 前，+X 是它的左边）
const SLASHES = [
  { dur: 0.42, a0: 0.07, a1: 0.22, dmg: 100, stop: 0.05, pitch: 1.0,
    dir: (s) => { const a = lerp(-1.9, 1.75, s), e = 0.12; return _v3.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)); } },
  { dur: 0.42, a0: 0.06, a1: 0.21, dmg: 120, stop: 0.05, pitch: 1.15,
    dir: (s) => { const a = lerp(1.6, -1.85, s), e = lerp(-0.25, 0.5, s); return _v3.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)); } },
  { dur: 0.58, a0: 0.12, a1: 0.27, dmg: 200, stop: 0.09, pitch: 0.8,
    dir: (s) => { const b = lerp(-0.35, 2.25, s); return _v3.set(-0.18, Math.cos(b), Math.sin(b)); } },
];

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.model = buildPig();
    ctx.scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.62;
    this.maxHp = 1000;
    this.squash = new Spring(160, 10);
    this.lean = new THREE.Vector2();
    this.aimPoint = new THREE.Vector3();
    this.armDirR = new THREE.Vector3(); this.armDirL = new THREE.Vector3();
    // 最后射击的大光束
    const geo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.lsCore = new THREE.Mesh(geo, glowMaterial(5, 3.2, 4.4, 1));
    this.lsGlow = new THREE.Mesh(geo, glowMaterial(2.6, 0.35, 1.5, 0.55));
    for (const m of [this.lsCore, this.lsGlow]) { m.visible = false; m.frustumCulled = false; ctx.scene.add(m); }
    this.reset(new THREE.Vector3(), 0);
  }

  reset(spawn, yaw) {
    this.pos.copy(spawn); this.vel.set(0, 0, 0); this.yaw = yaw;
    this.hp = this.maxHp; this.boost = 100; this.special = 0; this.ammo = 12; this.maxAmmo = 12;
    this.state = 'normal'; this.stateT = 0;
    this.grounded = true; this.jumpT = 1; this.overheat = false; this.boosting = false;
    this.iframes = 0; this.fireCd = 0; this.bazookaCd = 0; this.dashCd = 0; this.lastShot = -10; this.aimHold = 0;
    this.hurtFlash = 0; this.recoil = 0; this.shieldT = 0; this.walkPhase = 0; this.t = 0;
    this.lock = null; this.combo = 0; this.comboQueued = false; this.slashHits = new Set(); this.lunge = null; this.slashCd = 0; this._swung = false;
    this.deadT = 0; this.dodgeShown = 0; this.damageTaken = 0; this.lsTick = 0; this.lastHurt = -10;
    this.stats = { shots: 0, hits: 0, dmgBy: {} };
    const m = this.model;
    m.saber.visible = false; m.bazooka.visible = false; m.rifle.visible = true;
    m.hilts.forEach((h) => (h.visible = true));
    this.lsCore.visible = false; this.lsGlow.visible = false;
    this.armDirR.set(-0.38, -0.92, 0.05); this.armDirL.set(0.38, -0.92, 0.05);
    m.body.rotation.set(0, 0, 0); m.root.rotation.set(0, yaw, 0);
    this.animate(0.016);
  }

  get alive() { return this.hp > 0; }
  capsule(a, b) { a.copy(this.pos); a.y += 0.55; b.copy(this.pos); b.y += 1.5; return a; }
  center(out) { return out.copy(this.pos).setY(this.pos.y + 1.0); }
  addSpecial(v) {
    if (this.ctx.game.state !== 'battle' || !this.ctx.dragon.alive) return;
    const before = this.special;
    this.special = Math.min(100, this.special + v);
    if (before < 100 && this.special >= 100) { this.ctx.hud.toast('最后射击 准备完毕！按 R', 'pink'); this.ctx.audio.lockOn(); }
  }

  // ---------- 锁定 ----------
  toggleLock() {
    const ctx = this.ctx;
    if (this.lock) { this.lock = null; ctx.hud.setLock(null); return; }
    const cam = ctx.camera;
    cam.getWorldDirection(_aimD);
    const cands = ctx.dragon.lockCandidates();
    for (const f of ctx.dragon.funnels.list) if (f.alive && (f.state === 'hover' || f.state === 'launch')) cands.push({ kind: 'funnel', f, pos: f.pos, label: '浮游炮' });
    let best = null, bestA = 0.6;
    for (const c of cands) {
      _v.subVectors(c.pos, cam.position).normalize();
      const a = Math.acos(clamp(_v.dot(_aimD), -1, 1));
      if (a < bestA) { bestA = a; best = c; }
    }
    if (!best) best = cands.find((c) => c.id === 'body') || cands[0];
    this.lock = best;
    ctx.audio.lockOn();
  }
  getLockPoint() {
    if (!this.lock) return null;
    const d = this.ctx.dragon;
    if (!d.alive) { this.lock = null; return null; }
    if (this.lock.kind === 'funnel') {
      const f = this.lock.f;
      if (!f.alive || (f.state !== 'hover' && f.state !== 'launch')) { this.lock = d.lockCandidates().find((c) => c.id === 'body'); return this.getLockPoint(); }
      return f.pos;
    }
    const p = d.lockPoint(this.lock.id);
    if (!p) { this.lock = d.lockCandidates().find((c) => c.id === 'body'); return this.lock ? d.lockPoint('body') : null; }
    return p;
  }

  computeAim(out) {
    const ctx = this.ctx;
    const lp = this.getLockPoint();
    if (lp) return out.copy(lp);
    ctx.rig.aimRay(_aimO, _aimD);
    // 从奇魔猪身边开始算，避免打到镜头和它之间的东西
    const skip = Math.max(0, _v.subVectors(this.pos, _aimO).dot(_aimD) - 1.0);
    _aimO.addScaledVector(_aimD, skip);
    // 准星附近的浮游炮和导弹自动吸附
    let best = null, bestA = 0.045;
    const consider = (p) => { _v.subVectors(p, _aimO); const d = _v.length(); if (d < 2 || d > 120) return; const a = Math.acos(clamp(_v.dot(_aimD) / d, -1, 1)); if (a < bestA) { bestA = a; best = p; } };
    for (const f of ctx.dragon.funnels.list) if (f.alive && f.state === 'hover') consider(f.pos);
    for (const m of ctx.projectiles.missiles) consider(m.pos);
    if (best) return out.copy(best);
    const end = _v2.copy(_aimO).addScaledVector(_aimD, 220);
    const hit = ctx.projectiles.traceShot(_aimO, end, 0.05);
    return out.copy(hit ? hit.point : end);
  }

  canAct() { return this.alive && (this.state === 'normal' || this.state === 'dash'); }

  update(dt, input, controls) {
    const ctx = this.ctx, rig = ctx.rig;
    this.t += dt; this.stateT += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.fireCd -= dt; this.dashCd -= dt; this.aimHold -= dt;
    this.bazookaCd = Math.max(0, this.bazookaCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.jumpT += dt;
    if (this.t - this.lastShot > 0.65) this.ammo = Math.min(this.maxAmmo, this.ammo + dt / 0.4);
    const regen = this.ctx.game.difficulty.regen || 0;
    if (regen && this.alive && this.t - this.lastHurt > 7) this.hp = Math.min(this.maxHp, this.hp + regen * dt);

    if (!this.alive) { this.updateDead(dt); this.animate(dt); return; }

    // ---- 输入 ----
    let mx = 0, mz = 0;
    if (controls) { mx = input.axis('KeyA', 'KeyD'); mz = input.axis('KeyS', 'KeyW'); }
    // 镜头前方 f = (sin yaw, 0, cos yaw)，右方 r = (-cos yaw, 0, sin yaw)
    const fx = Math.sin(rig.yaw), fz = Math.cos(rig.yaw);
    const wish = _wish.set(fx * mz - fz * mx, 0, fz * mz + fx * mx);
    if (wish.lengthSq() > 1) wish.normalize();
    const wishLen = wish.length();

    const shielding = controls && input.btn(2) && this.state === 'normal';
    this.shieldT = damp(this.shieldT, shielding ? 1 : 0, shielding ? 16 : 10, dt);
    const lockPt = this.getLockPoint();
    this.aiming = this.state === 'normal' && (this.aimHold > 0 || (controls && input.btn(0)) || !!lockPt) && !shielding;
    if (this.aiming || shielding || this.state === 'bazooka' || this.state === 'lastshot') this.computeAim(this.aimPoint);

    // ---- 朝向 ----
    if (this.state === 'normal' || this.state === 'bazooka' || this.state === 'lastshot') {
      let ty = null;
      if (this.aiming || shielding || this.state !== 'normal') ty = Math.atan2(this.aimPoint.x - this.pos.x, this.aimPoint.z - this.pos.z);
      // 最后射击：身体往左转一点，让目标落在右前方，举起的步枪伸向外侧，不挡脸
      if (this.state === 'lastshot') ty += 0.6;
      else if (wishLen > 0.1) ty = Math.atan2(wish.x, wish.z);
      if (ty !== null) this.yaw = dampAngle(this.yaw, ty, this.state === 'normal' ? 14 : 20, dt);
    }

    // ---- 水平速度 ----
    if (this.state === 'normal') {
      const speed = shielding ? 3.6 : 8.2;
      const acc = this.grounded ? 14 : 4.5;
      this.vel.x = damp(this.vel.x, wish.x * speed, acc, dt);
      this.vel.z = damp(this.vel.z, wish.z * speed, acc, dt);
    } else if (this.state === 'dash') {
      if (this.stateT > 0.3) { this.state = 'normal'; this.vel.x *= 0.45; this.vel.z *= 0.45; }
    } else if (this.state === 'slash') {
      if (this.lunge && this.lunge.t > 0) {
        this.lunge.t -= dt;
        this.vel.x = this.lunge.v.x; this.vel.z = this.lunge.v.z; this.vel.y = this.lunge.v.y;
      } else { this.vel.x = damp(this.vel.x, 0, 10, dt); this.vel.z = damp(this.vel.z, 0, 10, dt); }
    } else {
      this.vel.x = damp(this.vel.x, 0, this.state === 'down' ? 3 : 6, dt);
      this.vel.z = damp(this.vel.z, 0, this.state === 'down' ? 3 : 6, dt);
    }

    // ---- 跳跃与背包推进 ----
    this.boosting = false;
    if (controls && (this.state === 'normal' || this.state === 'slash')) {
      if (input.hit('Space') && this.grounded && this.state === 'normal') {
        this.vel.y = 9.5; this.grounded = false; this.jumpT = 0;
        this.squash.kick(1.4);
      } else if (input.down('Space') && !this.grounded && this.jumpT > 0.16 && this.boost > 0 && !this.overheat && this.state === 'normal') {
        this.boosting = true;
        this.vel.y = Math.min(this.vel.y + 36 * dt, 6.5);
        this.boost -= 23 * dt;
        if (this.boost <= 0) { this.boost = 0; this.overheat = true; ctx.hud.toast('推进器过热', 'warn'); }
      }
    }
    const gravityOn = !(this.state === 'dash' && this.stateT < 0.26) && !(this.state === 'slash' && !this.grounded && this.stateT < 0.3) && this.state !== 'lastshot';
    if (gravityOn) this.vel.y -= 25 * dt;
    else if (this.state === 'lastshot' || this.state === 'slash') this.vel.y = damp(this.vel.y, 0, 12, dt);
    if (this.grounded && !this.boosting && this.state !== 'dash') this.boost = Math.min(100, this.boost + dt * (this.overheat ? 26 : 40));
    else if (!this.boosting && this.state !== 'dash') this.boost = Math.min(100, this.boost + dt * 6);
    if (this.overheat && this.boost >= 35) this.overheat = false;

    // ---- 冲刺闪避 ----
    if (controls && (input.hit('ShiftLeft') || input.hit('ShiftRight')) && (this.state === 'normal' || (this.state === 'slash' && this.stateT > 0.2))
      && this.boost >= 14 && !this.overheat && this.dashCd <= 0) {
      const d = wishLen > 0.1 ? _v2.copy(wish).normalize() : _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.startDash(d);
    }

    // ---- 武器 ----
    if (controls) {
      if (this.state === 'normal' && !shielding && input.btn(0) && this.fireCd <= 0 && this.ammo >= 1) this.fireRifle();
      if (input.hit('KeyF') || input.hit('KeyE')) this.pressSlash();
      if (input.hit('KeyQ') && this.state === 'normal' && this.bazookaCd <= 0) this.startBazooka();
      if (input.hit('KeyR') && this.special >= 100 && this.canAct()) this.startLastShot();
      if (input.hit('Tab') || input.btnHit(1)) this.toggleLock();
    }
    if (this.state === 'slash') this.updateSlash(dt);
    else if (this.state === 'bazooka') this.updateBazooka(dt);
    else if (this.state === 'lastshot') this.updateLastShot(dt);
    else if (this.state === 'stun' && this.stateT > 0.3) this.state = 'normal';
    else if (this.state === 'down' && this.stateT > 1.0) { this.state = 'normal'; this.iframes = Math.max(this.iframes, 0.5); }

    this.move(dt);
    this.animate(dt);
    ctx.world.setPusher(0, this.pos.x, this.pos.z, 1.3);
    ctx.audio.setThruster(this.boosting ? 1 : this.state === 'dash' ? 0.8 : 0);
  }

  // ---------- 移动与碰撞 ----------
  move(dt) {
    const world = this.ctx.world, p = this.pos, v = this.vel;
    const nx = p.x + v.x * dt, nz = p.z + v.z * dt;
    const ok = (x, z) => world.groundAt(x, z) <= p.y + 0.6;
    if (ok(nx, nz)) { p.x = nx; p.z = nz; }
    else if (ok(nx, p.z)) { p.x = nx; v.z *= 0.5; }
    else if (ok(p.x, nz)) { p.z = nz; v.x *= 0.5; }
    else { v.x = 0; v.z = 0; }
    // 场地边界（浓雾外是丘陵）
    const r = Math.hypot(p.x, p.z);
    if (r > ARENA_RADIUS) {
      p.x *= ARENA_RADIUS / r; p.z *= ARENA_RADIUS / r;
      const nX = p.x / ARENA_RADIUS, nZ = p.z / ARENA_RADIUS;
      const out = v.x * nX + v.z * nZ;
      if (out > 0) { v.x -= nX * out; v.z -= nZ * out; }
      if (!this._edgeToast || this.t - this._edgeToast > 4) { this._edgeToast = this.t; this.ctx.hud.toast('前方雾太浓了，回到战场', 'warn'); }
    }
    // 巨龙的身体是实心的
    const stand = this.ctx.dragon.resolveCollision(p, this.radius);
    p.y += v.y * dt;
    let g = world.groundAt(p.x, p.z);
    if (stand !== null && stand > g) g = stand;
    if (p.y <= g) {
      if (!this.grounded) {
        const impact = -v.y;
        if (impact > 5) {
          this.squash.kick(-impact * 0.09);
          this.ctx.audio.land(clamp(impact / 14, 0.3, 1.2));
          this.ctx.effects.dust(p, Math.round(clamp(impact, 4, 14)), 0.9);
        }
      }
      p.y = g; if (v.y < 0) v.y = 0;
      this.grounded = true;
    } else if (this.grounded && p.y - g > 0.4) {
      this.grounded = false;
    } else if (this.grounded) {
      p.y = g;
    }
    if (p.y > g + 15) v.y = Math.min(v.y, 0);
  }

  startDash(dir) {
    this.state = 'dash'; this.stateT = 0;
    this.vel.x = dir.x * 25; this.vel.z = dir.z * 25; this.vel.y = Math.max(this.vel.y, this.grounded ? 0 : 0.5);
    this.boost -= 16; this.dashCd = 0.32; this.iframes = 0.28;
    this.yaw = Math.atan2(dir.x, dir.z);
    this.ctx.audio.dash();
    this.ctx.rig.fovKick = 7;
    const fx = this.ctx.effects;
    for (const f of this.model.flames) { f.getWorldPosition(_v3); fx.flash(_v3, new THREE.Color(1, 2, 3.5), 1.4, 0.2); }
    this.lunge = null;
  }

  fireRifle() {
    const ctx = this.ctx;
    this.computeAim(this.aimPoint);
    this.poseWeapons(0.016, true); // 先把枪摆到位，枪口对准
    this.model.rifleMuzzle.getWorldPosition(_muz);
    ctx.projectiles.fireBolt(_muz, this.aimPoint, 55);
    this.ammo -= 1; this.fireCd = 0.19; this.aimHold = 0.75; this.lastShot = this.t; this.recoil = 1;
    this.stats.shots++;
    ctx.effects.flash(_muz, PINK, 1.3, 0.09);
    ctx.effects.light(_muz, new THREE.Color(1, 0.35, 0.7), 18, 0.12, 9);
    ctx.audio.rifle();
  }

  // ---------- 光束剑三段斩 ----------
  pressSlash() {
    if (this.state === 'slash') { if (this.combo < 2 && this.stateT > SLASHES[this.combo].a0) this.comboQueued = true; return; }
    if (this.state !== 'normal' && this.state !== 'dash') return;
    if (this.slashCd && this.t < this.slashCd) return;
    this.beginSlash(0);
  }
  beginSlash(i) {
    const ctx = this.ctx, m = this.model;
    this.state = 'slash'; this.stateT = 0; this.combo = i; this.comboQueued = false; this.slashHits.clear(); this._stopDone = false;
    if (i === 0) { ctx.audio.saberOn(); m.hilts[0].visible = false; }
    m.saber.visible = true; m.rifle.visible = false;
    // 冲向最近的目标
    const target = this.meleeTarget();
    this.lunge = null;
    if (target) {
      _v.subVectors(target, this.pos);
      const dy = _v.y - 1.0; _v.y = 0;
      const d = _v.length();
      this.yaw = Math.atan2(_v.x, _v.z);
      if (d > 2.6) {
        const sp = Math.min(20, (d - 2.2) / 0.16);
        _v.normalize().multiplyScalar(sp);
        this.lunge = { t: 0.16, v: new THREE.Vector3(_v.x, clamp(dy / 0.16, -4, 12) * (this.grounded ? 0 : 1), _v.z) };
      }
    }
    if (!this.grounded) this.vel.y = Math.max(this.vel.y, 0);
  }
  meleeTarget() {
    const ctx = this.ctx;
    const lp = this.getLockPoint();
    if (lp && lp.distanceTo(this.pos) < 11) return ctx.dragon.nearestSurface(this.pos, lp);
    return ctx.dragon.nearestSurface(this.pos, null, 9);
  }
  updateSlash(dt) {
    const ctx = this.ctx, S = SLASHES[this.combo], t = this.stateT;
    const active = t >= S.a0 && t <= S.a1;
    if (t >= S.a0 && !this._swung) { this._swung = true; ctx.audio.saberSwing(S.pitch); ctx.effects.startTrail(); }
    if (active) {
      // 刃的线段（世界坐标）
      this.model.saberBase.getWorldPosition(_v); this.model.saberTip.getWorldPosition(_v2);
      ctx.effects.pushTrail(_v, _v2);
      this.slashHitTest(_v, _v2, S);
    } else if (t > S.a1 && this._swung) {
      ctx.effects.stopTrail();
    }
    if (t > S.a1 && this.comboQueued && this.combo < 2) { this._swung = false; this.beginSlash(this.combo + 1); return; }
    if (t >= S.dur) {
      this._swung = false;
      ctx.effects.stopTrail();
      this.state = 'normal'; this.stateT = 0;
      this.model.saber.visible = false; this.model.rifle.visible = true; this.model.hilts[0].visible = true;
      if (this.combo === 2) this.slashCd = this.t + 0.3;
    }
  }
  slashHitTest(a, b, S) {
    const ctx = this.ctx, dragon = ctx.dragon;
    let hitAny = false;
    const hits = dragon.hitTestBlade(a, b, 0.16);
    for (const h of hits) {
      if (this.slashHits.has(h.part)) continue;
      this.slashHits.add(h.part);
      dragon.damage(h.part, S.dmg, h.point, { source: 'saber', poise: 1.6 });
      ctx.effects.sparks(h.point, _v3.subVectors(h.point, this.pos).normalize(), PINK_SPARK, 18, 11);
      ctx.effects.flash(h.point, PINK, 2.4, 0.14);
      hitAny = true;
    }
    for (const f of dragon.funnels.list) {
      if (!f.alive || this.slashHits.has(f) || (f.state !== 'hover' && f.state !== 'launch')) continue;
      if (segmentSphere(a, b, f.pos, 0.9) >= 0) { this.slashHits.add(f); dragon.funnels.damage(f, 999, f.pos); hitAny = true; }
    }
    for (const m of [...ctx.projectiles.missiles]) {
      if (segmentSphere(a, b, m.pos, 0.8) >= 0) { ctx.projectiles.destroyMissile(m, true); hitAny = true; }
    }
    if (hitAny && !this._stopDone) {
      ctx.effects.hitStop = S.stop;
      ctx.effects.addShake(0.22 + (this.combo === 2 ? 0.2 : 0));
      ctx.audio.saberHit();
      this._stopDone = true;
      this.stats.hits++;
    }
  }

  // ---------- 超级火箭筒 ----------
  startBazooka() {
    this.state = 'bazooka'; this.stateT = 0; this._fired = false;
    this.model.bazooka.visible = true; this.model.rifle.visible = false;
  }
  updateBazooka(dt) {
    const ctx = this.ctx;
    if (!this._fired && this.stateT > 0.24) {
      this._fired = true;
      this.computeAim(this.aimPoint);
      this.poseWeapons(0.016, true);
      this.model.bazookaMuzzle.getWorldPosition(_muz);
      _v.subVectors(this.aimPoint, _muz).normalize();
      ctx.projectiles.fireRocket(_muz, _v);
      ctx.audio.bazooka();
      ctx.effects.flash(_muz, new THREE.Color(3, 2, 1.2), 2.5, 0.15);
      ctx.effects.dust(_v2.copy(_muz).addScaledVector(_v, -1.2), 6, 0.8, { r: 0.6, g: 0.6, b: 0.6 });
      ctx.effects.addShake(0.2);
      this.vel.addScaledVector(_v.setY(0), -3);
      this.recoil = 1.4;
      this.bazookaCd = 5.5;
    }
    if (this.stateT > 0.62) { this.state = 'normal'; this.model.bazooka.visible = false; this.model.rifle.visible = true; }
  }

  // ---------- 招牌动作：最后射击 ----------
  startLastShot() {
    const ctx = this.ctx;
    this.state = 'lastshot'; this.stateT = 0; this._fired = false; this.lsTick = 0;
    this.special = 0;
    this.iframes = 2.4;
    ctx.audio.special();
    ctx.hud.toast('最后射击！', 'pink');
    if (!this.lock) { this.lock = ctx.dragon.lockCandidates().find((c) => c.id === 'head'); }
    ctx.game.cineLastShot();
  }
  updateLastShot(dt) {
    const ctx = this.ctx, fx = ctx.effects;
    const t = this.stateT;
    this.model.rifleMuzzle.getWorldPosition(_muz);
    if (t < 0.8) {
      // 聚能：粉红光点往枪口收
      for (let i = 0; i < 3; i++) {
        _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 2.5));
        fx.add.spawn(_muz.x + _v.x, _muz.y + _v.y, _muz.z + _v.z, -_v.x * 2.5, -_v.y * 2.5, -_v.z * 2.5, 3, 0.8, 2, 0.25, 0.05, 0.4, 1, 0);
      }
    }
    if (!this._fired && t >= 0.8) {
      this._fired = true;
      this._lsSound = ctx.audio.beamFire(_muz);
      fx.addShake(0.6);
    }
    if (this._fired) {
      const bt = t - 0.8;
      _v.subVectors(this.aimPoint, _muz).normalize();
      let len = ctx.world.raycast(_muz, _v, 160, true);
      if (!isFinite(len)) len = 160;
      const k = bt < 0.1 ? bt / 0.1 : bt > 0.85 ? Math.max(0, 1 - (bt - 0.85) / 0.25) : 1;
      const w = (0.9 + Math.sin(bt * 60) * 0.08) * k;
      this.lsCore.visible = this.lsGlow.visible = k > 0.01;
      for (const [m, r] of [[this.lsCore, 0.42 * w], [this.lsGlow, 1.05 * w]]) {
        m.position.copy(_muz); m.quaternion.setFromUnitVectors(Z, _v); m.scale.set(Math.max(r, 0.001), Math.max(r, 0.001), len);
      }
      // 镜头贴近光束时外层光晕调淡，免得整个画面发白
      const cam = ctx.camera.position;
      const along = clamp(_v3.subVectors(cam, _muz).dot(_v), 0, len);
      const camD = _v3.copy(_muz).addScaledVector(_v, along).distanceTo(cam);
      this.lsGlow.material.opacity = 0.5 * clamp((camD - 0.8) / 3, 0.15, 1);
      const end = _v2.copy(_muz).addScaledVector(_v, len);
      if (Math.random() < 0.7) fx.explosion(end, 0.5, { noShake: true, color: { r: 3, g: 0.8, b: 2 } });
      fx.light(_muz, new THREE.Color(1, 0.4, 0.75), 50 * k, 0.1, 18);
      // 伤害：每 0.1 秒结算一次，光束上的所有东西
      this.lsTick -= dt;
      if (this.lsTick <= 0 && bt < 0.95) {
        this.lsTick = 0.1;
        const hits = ctx.dragon.hitTestBlade(_muz, end, 0.5);
        if (hits.length) {
          hits.sort((a, b) => a.t - b.t);
          ctx.dragon.damage(hits[0].part, 135, hits[0].point, { source: 'lastshot', poise: 3 });
        }
        for (const f of ctx.dragon.funnels.list) if (f.alive && f.state !== 'docked' && segmentSphere(_muz, end, f.pos, 1.2) >= 0) ctx.dragon.funnels.damage(f, 999, f.pos);
        for (const m of [...ctx.projectiles.missiles]) if (segmentSphere(_muz, end, m.pos, 1.2) >= 0) ctx.projectiles.destroyMissile(m, true);
      }
      if (bt > 1.15) {
        this.lsCore.visible = this.lsGlow.visible = false;
        if (this._lsSound) { this._lsSound.stop(); this._lsSound = null; }
        this.state = 'normal'; this.stateT = 0; this.iframes = 0.4;
      }
    }
  }

  // ---------- 受伤 ----------
  takeDamage(amount, from, opts = {}) {
    const ctx = this.ctx;
    if (!this.alive) return 'ignored';
    if (this.iframes > 0) {
      if (this.state === 'dash' && this.t - this.dodgeShown > 1.2 && opts.type !== 'beamTick') {
        this.dodgeShown = this.t; ctx.hud.toast('闪避！', 'pink', 0.6); this.addSpecial(4);
      }
      return 'dodged';
    }
    const diff = ctx.game.difficulty.dmg;
    _v.subVectors(from, this.pos); _v.y = 0; _v.normalize();
    const facing = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const blocking = this.shieldT > 0.6 && this.state === 'normal' && opts.blockable !== false && _v.dot(facing) > Math.cos(1.3);
    let knock = opts.knock || 0;
    if (blocking) {
      amount *= opts.blockMult ?? 0.12; knock *= 0.35;
      this.model.shield.getWorldPosition(_v3);
      ctx.effects.sparks(_v3, _v, { r: 3, g: 2.5, b: 1.5 }, 10, 8);
      ctx.effects.flash(_v3, new THREE.Color(2.5, 2.2, 1.8), 1.8, 0.12);
      if (opts.type !== 'beamTick' || Math.random() < 0.3) ctx.audio.block();
      this.addSpecial(2);
    }
    amount *= diff;
    this.hp = Math.max(0, this.hp - amount);
    this.lastHurt = this.t;
    this.stats.dmgBy[opts.type || '?'] = (this.stats.dmgBy[opts.type || '?'] || 0) + amount;
    this.damageTaken += amount;
    if (!blocking) {
      this.hurtFlash = 1;
      this.addSpecial(amount * 0.06);
      if (opts.type !== 'beamTick' || this.state !== 'stun') {
        ctx.audio.hurt();
        ctx.effects.addShake(clamp(amount / 250, 0.15, 0.6));
        ctx.hud.damageFlash(clamp(amount / 150, 0.3, 1));
      }
    }
    if (knock > 0) {
      this.vel.x -= _v.x * knock; this.vel.z -= _v.z * knock;
      if (knock >= 8 && !blocking) { this.vel.y = Math.max(this.vel.y, 6); this.grounded = false; this.setState('down'); }
      else if (knock >= 3 && !blocking && this.state !== 'down' && this.state !== 'lastshot') this.setState('stun');
    }
    if (this.hp <= 0) this.die();
    return blocking ? 'blocked' : 'hit';
  }
  setState(s) {
    if (this.state === 'slash' || this.state === 'bazooka') { this.model.saber.visible = false; this.model.bazooka.visible = false; this.model.rifle.visible = true; this.model.hilts[0].visible = true; this.ctx.effects.stopTrail(); this._swung = false; }
    this.state = s; this.stateT = 0;
  }
  die() {
    this.setState('dead');
    this.deadT = 0;
    this.lock = null;
    this.ctx.audio.setThruster(0);
    this.ctx.effects.explosion(_v.copy(this.pos).setY(this.pos.y + 1), 0.7);
  }
  updateDead(dt) {
    this.deadT += dt;
    this.vel.x = damp(this.vel.x, 0, 3, dt); this.vel.z = damp(this.vel.z, 0, 3, dt);
    this.vel.y -= 25 * dt;
    this.move(dt);
  }

  // ---------- 动画 ----------
  setArm(arm, dir, k, dt) {
    _q.setFromUnitVectors(DOWN, _v3.copy(dir).normalize());
    arm.quaternion.slerp(_q, 1 - Math.exp(-k * dt));
  }
  handPos(arm, shoulder, out) { return out.copy(DOWN).applyQuaternion(arm.quaternion).multiplyScalar(PIG_REACH).add(shoulder); }

  // 武器摆放（身体局部坐标）；instant = 立刻到位（开火那一帧）
  poseWeapons(dt, instant = false) {
    const m = this.model, body = m.body;
    const k = instant ? 1 : 1 - Math.exp(-22 * dt);
    body.updateWorldMatrix(true, false);
    const aimLocal = body.worldToLocal(_v.copy(this.aimPoint));
    const st = this.state;
    if (st === 'lastshot') {
      // 单手把光束步枪斜着高高举向右上方（枪和手臂在头的右上方外侧）
      _v2.set(-0.78, 0.58, 0.3);
      this.setArm(m.armR, _v2, instant ? 1e3 : 14, dt);
      this.handPos(m.armR, SH_R, _v2);
      m.rifle.position.lerp(_v2, k);
      _q2.setFromUnitVectors(Z, _v3.subVectors(aimLocal, _v2).normalize());
      m.rifle.quaternion.slerp(_q2, k);
    } else if (st === 'bazooka') {
      const dir = _v3.subVectors(aimLocal, SH_R).normalize();
      this.setArm(m.armR, _v2.copy(dir).add(new THREE.Vector3(0, -0.6, 0)), instant ? 1e3 : 20, dt);
      const pos = _v2.set(-0.62, 0.62 - this.recoil * 0.05, 0.05 - this.recoil * 0.12);
      m.bazooka.position.lerp(pos, k);
      _q2.setFromUnitVectors(Z, _v3.subVectors(aimLocal, pos).normalize());
      m.bazooka.quaternion.slerp(_q2, k);
    } else if (st === 'slash') {
      const S = SLASHES[this.combo], t = this.stateT;
      let s;
      if (t < S.a0) s = -0.25 * (1 - t / S.a0);
      else if (t <= S.a1) s = easeInOutSine((t - S.a0) / (S.a1 - S.a0));
      else s = 1;
      const bladeDir = S.dir(clamp(s, 0, 1)).clone();
      if (t < S.a0) bladeDir.lerp(_v2.set(-0.6, 0.6, -0.4), 0.5 * (1 - t / S.a0)).normalize();
      const armDir = _v2.copy(bladeDir).multiplyScalar(0.7).add(new THREE.Vector3(0, -0.55, 0.45));
      this.setArm(m.armR, armDir, 45, dt);
      this.handPos(m.armR, SH_R, _v2);
      m.saber.position.copy(_v2);
      m.saber.quaternion.setFromUnitVectors(Z, bladeDir);
    } else if (this.aiming) {
      const dir = _v3.subVectors(aimLocal, SH_R).normalize();
      this.setArm(m.armR, _v2.copy(dir).add(new THREE.Vector3(-0.1, -0.42, 0)), instant ? 1e3 : 22, dt);
      this.handPos(m.armR, SH_R, _v2);
      _v2.z -= this.recoil * 0.06;
      m.rifle.position.lerp(_v2, k);
      _q2.setFromUnitVectors(Z, _v3.subVectors(aimLocal, _v2).normalize());
      m.rifle.quaternion.slerp(_q2, k);
    } else {
      this.handPos(m.armR, SH_R, _v2);
      m.rifle.position.lerp(_v2, k);
      _q2.setFromUnitVectors(Z, _v3.set(-0.12, -0.55, 1).normalize());
      m.rifle.quaternion.slerp(_q2, k);
    }
    // 盾牌：平时挂在左前臂外侧，举盾时挡在胸前（脸露在盾牌上面）
    const s = this.shieldT;
    _v2.set(lerp(0.84, 0.22, s), lerp(0.42, 0.42, s), lerp(0.02, 0.66, s));
    m.shield.position.copy(_v2);
    _q2.setFromEuler(new THREE.Euler(lerp(0.05, -0.12, s), lerp(Math.PI / 2 - 0.15, 0.1, s), lerp(0.08, 0, s)));
    m.shield.quaternion.copy(_q2);
  }

  animate(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const sq = this.squash.update(Math.min(dt, 0.05));
    m.squash.scale.set(1 - sq * 0.55, 1 + sq, 1 - sq * 0.55);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    const walk = this.grounded && this.alive ? clamp(hs / 8, 0, 1) : 0;
    const prev = this.walkPhase;
    if (this.grounded) this.walkPhase += dt * (4 + hs * 1.25);
    if (walk > 0.2 && Math.floor(prev / Math.PI) !== Math.floor(this.walkPhase / Math.PI)) {
      this.ctx.audio.step();
      if (Math.random() < 0.35) this.ctx.effects.dust(this.pos, 1, 0.4);
    }
    const sw = Math.sin(this.walkPhase) * 0.65 * walk;
    const air = !this.grounded && this.alive;
    m.legL.rotation.x = damp(m.legL.rotation.x, air ? -0.4 : sw, 18, dt);
    m.legR.rotation.x = damp(m.legR.rotation.x, air ? 0.2 : -sw, 18, dt);

    const breath = Math.sin(this.t * 2.4) * 0.012;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.075 * walk;
    m.body.position.y = PIG_BODY_PIVOT + bob + breath;
    const fwd = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    const side = this.vel.x * -Math.cos(this.yaw) + this.vel.z * Math.sin(this.yaw);
    let pitch = clamp(fwd * 0.025, -0.15, 0.22), roll = clamp(side * 0.02, -0.15, 0.15) + Math.sin(this.walkPhase) * 0.05 * walk;
    if (this.state === 'dash') pitch = 0.42;
    if (this.boosting) pitch += 0.1;
    if (this.state === 'stun') pitch = -0.25;
    if (this.state === 'down') pitch = -0.9 * Math.min(1, this.stateT * 4) * (1 - clamp((this.stateT - 0.6) * 3, 0, 1));
    if (this.state === 'slash') pitch = this.combo === 2 ? 0.25 : 0.12;
    if (!this.alive) { pitch = -1.45 * Math.min(1, this.deadT * 2.5); roll = 0.2; }
    m.body.rotation.x = damp(m.body.rotation.x, pitch, 10, dt);
    m.body.rotation.z = damp(m.body.rotation.z, roll, 10, dt);
    m.head.rotation.x = damp(m.head.rotation.x, -pitch * 0.25 + Math.sin(this.walkPhase * 2) * 0.02 * walk, 8, dt);

    // 手臂
    const swing = Math.sin(this.walkPhase) * 0.55 * walk;
    let dL = _v.set(0.38, -0.92, 0.05 - swing), dR = _v2.set(-0.38, -0.92, 0.05 + swing);
    if (air) { dL.set(0.65, -0.55, 0.1); dR.set(-0.65, -0.55, 0.1); }
    if (this.boosting || this.state === 'dash') { dL.set(0.45, -0.75, -0.45); dR.set(-0.45, -0.75, -0.45); }
    if (!this.alive) { dL.set(0.9, -0.2, 0.2); dR.set(-0.9, -0.2, 0.2); }
    if (this.shieldT > 0.05) dL.lerp(_v3.set(0.2, -0.35, 1), this.shieldT);
    this.setArm(m.armL, dL, 16, dt);
    const rightBusy = this.aiming || this.state === 'slash' || this.state === 'bazooka' || this.state === 'lastshot';
    if (!rightBusy) this.setArm(m.armR, dR, 16, dt);
    this.poseWeapons(dt);

    // 背包推进火（只从背包喷口喷出来）
    const thrust = this.boosting ? 1 : this.state === 'dash' ? 1.3 : (air && this.vel.y > 2 ? 0.5 : 0);
    for (const f of m.flames) {
      f.visible = thrust > 0.01;
      if (f.visible) { const s = thrust * (0.85 + Math.random() * 0.35); f.scale.set(1, s * (this.state === 'dash' ? 1.6 : 1), 1); f.rotation.x = this.state === 'dash' ? 1.1 : 0.35; }
    }
    m.thrusterLight.intensity = thrust * (2.5 + Math.random() * 1.5);
    if (thrust > 0 && Math.random() < 0.5) {
      const f = m.flames[Math.random() < 0.5 ? 0 : 1];
      f.getWorldPosition(_v3);
      this.ctx.effects.add.spawn(_v3.x, _v3.y - 0.2, _v3.z, rand(-0.5, 0.5), -rand(3, 6), rand(-0.5, 0.5), 0.8, 1.6, 3.2, 0.3, 0.05, 0.25, 0.8, 2, 0);
    }
    // 受击闪光
    const fl = this.hurtFlash;
    for (const mat of m.flashMats) mat.emissive.setRGB(fl * 0.9, fl * 0.25, fl * 0.3);
  }
}
