// 巨龙形 MA 的行为：四足步态（两段 IK）、尾巴链条、脖子瞄准、各种攻击、部位破坏、阶段变化
import * as THREE from 'three';
import { buildDragon, DRAGON } from './dragonModel.js';
import { Funnels } from './funnels.js';
import { clamp, lerp, damp, rand, wrapAngle, approachAngle, dampAngle, smoothstep, easeInOutSine, easeOutCubic,
  segmentSphere, segmentSegmentDistance, solveTwoBone, orientBone, closestPointOnSegment } from './util.js';
import { glowMaterial, GREEN } from './materials.js';
import { ARENA_RADIUS } from './world.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _f = new THREE.Vector3(), _g = new THREE.Vector3(), _h = new THREE.Vector3(), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const MULT = { head: 1.5, muzzle: 1.6, neck: 1.1, body: 1.0, leg: 0.8, tail: 0.7, wing: 0.4, bayL: 0.55, bayR: 0.55 };
const GREEN_SPARK = { r: 0.6, g: 3.0, b: 1.2 };
const RING_DIM = new THREE.Color(0.1, 0.8, 0.35);
const CORE_DIM = new THREE.Color(0.2, 1.4, 0.6);
const DEAD_DIM = new THREE.Color(0.01, 0.03, 0.02);

export class Dragon {
  constructor(ctx) {
    this.ctx = ctx;
    this.m = buildDragon();
    ctx.scene.add(this.m.group);
    this.funnels = new Funnels(ctx, this.m);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.baseMaxHp = 9000;
    this.legs = this.m.legs.map((L) => ({
      ...L, cur: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, stepping: false,
      hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(), override: null, overrideW: 0,
    }));
    this.tailJoints = Array.from({ length: DRAGON.tailLens.length + 2 }, () => new THREE.Vector3());
    this.bays = this.m.wings.map((w) => ({ ...w, hp: 900, maxHp: 900, broken: false, open: 0, openTarget: 0, droop: 0 }));
    this.buildHitboxes();
    this.buildBeam();
    this.reset(new THREE.Vector3(0, 0, 16), Math.PI);
  }

  buildHitboxes() {
    const m = this.m, boxes = [];
    const B = (part, node, x, y, z, r, solid = true) => boxes.push({ part, node, off: new THREE.Vector3(x, y, z), r, solid, pos: new THREE.Vector3() });
    B('head', m.head, 0, 0.25, 0.9, 0.95); B('head', m.head, 0, 0.05, 2.2, 0.62);
    B('muzzle', m.head, 0, -0.3, 1.3, 0.5, false);
    m.neck.forEach((n) => B('neck', n, 0, 0.1, 0.36, 0.78));
    B('body', m.body, 0, 0.2, 2.0, 1.75); B('body', m.body, 0, 0.1, -0.3, 1.6); B('body', m.body, 0, 0.15, -2.4, 1.7);
    for (const s of [-1, 1]) { B('body', m.body, s * 1.78, 0.1, 2.05, 1.0); B('body', m.body, s * 1.66, 0, -2.35, 1.0); }
    this.bays.forEach((w, i) => {
      const part = i === 0 ? 'bayL' : 'bayR';
      B(part, w.pod, 0, 0, 0.8, 0.85, false); B(part, w.pod, 0, 0, -0.8, 0.85, false);
      B('wing', w.blades, 0, 1.6, -1.2, 1.0, false);
    });
    for (const L of m.legs) { B('leg', L.upper, 0, -0.85, 0, 0.75); B('leg', L.lower, 0, -0.8, 0, 0.6); }
    m.tail.forEach((t) => B('tail', t.group, 0, -t.len / 2, 0, t.r + 0.12));
    B('tail', m.blade, 0, -0.8, 0, 0.55);
    this.boxes = boxes;
    this.tailBoxes = boxes.filter((b) => b.part === 'tail');
  }

  buildBeam() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.beam = new THREE.Group();
    this.beamCore = new THREE.Mesh(geo, glowMaterial(3.4, 5.5, 4.0, 1));
    this.beamGlow = new THREE.Mesh(geo, glowMaterial(0.35, 3.0, 1.2, 0.5));
    this.beamHaze = new THREE.Mesh(geo, glowMaterial(0.15, 1.2, 0.5, 0.2));
    for (const b of [this.beamCore, this.beamGlow, this.beamHaze]) { b.frustumCulled = false; this.beam.add(b); }
    this.beam.visible = false;
    this.ctx.scene.add(this.beam);
  }

  reset(pos, yaw) {
    const diff = this.ctx.game ? this.ctx.game.difficulty : { hp: 1 };
    this.maxHp = Math.round(this.baseMaxHp * (diff.hp || 1));
    this.hp = this.maxHp;
    this.pos.copy(pos); this.pos.y = this.ctx.world.heightAt(pos.x, pos.z);
    this.yaw = yaw; this.vel.set(0, 0, 0);
    this.state = 'idle'; this.action = null; this.phase = 1;
    this.idleT = 2.5; this.cool = { beam: 0, missiles: 3, funnels: 14, claw: 0, stomp: 3, tail: 0, charge: 6, burst: 0 };
    this.poise = 0; this.poiseMax = 900; this.staggerT = 0;
    this.flashT = 0; this.t = 0; this.deadT = 0; this.alive = true; this.intro = true;
    this.finalBoom = false; this.boomT = 0; this.glowBoost = 0; this.turning = false; this.lastGroup = -1;
    this.headYaw = 0; this.headPitch = 0; this.headRaise = 0; this.jaw = 0.3; this.jawTarget = 0.3;
    this.pose = { rear: 0, crouch: 0, roll: 0, tailSweep: 0, tailStiff: 0, lean: 0 };
    this.interrupt = 0;
    this.shock = null;
    this.beamCtl = null;
    this.glowLevel = 1;
    this.lastFootSound = 0;
    this.roarPush = 0;
    this.m.hipFlames.forEach((f) => (f.visible = false));
    this.beam.visible = false;
    for (const b of this.bays) {
      b.hp = b.maxHp; b.broken = false; b.open = 0; b.openTarget = 0; b.droop = 0;
      b.hatches.forEach((h) => { h.visible = true; h.rotation.z = 0; });
      b.podMeshes.forEach((pm) => { if (pm.userData.origMat) pm.material = pm.userData.origMat; });
      b.group.rotation.z = 0;
    }
    this.funnels.reset();
    const M = this.m.materials;
    M.armor.emissiveIntensity = 1.6; M.armor.color.setScalar(1);
    M.glow.color.setRGB(0.35, 2.6, 1.0); M.glowDim.color.setRGB(0.12, 0.9, 0.38);
    this.m.rings.forEach((r) => r.material.color.copy(RING_DIM));
    this.m.core.material.color.setRGB(0.2, 1.4, 0.6);
    this.m.mouthLight.intensity = 0;
    this.m.body.rotation.set(0, yaw, 0);
    this.placeBody(0.016);
    this.m.group.updateMatrixWorld(true);
    // 脚和尾巴直接放到位
    for (const L of this.legs) { this.footHome(L, L.cur); L.from.copy(L.cur); L.to.copy(L.cur); L.stepping = false; L.override = null; L.overrideW = 0; }
    this.m.tailBase.getWorldPosition(this.tailJoints[0]);
    const back = _a.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    for (let i = 1; i < this.tailJoints.length; i++) this.tailJoints[i].copy(this.tailJoints[i - 1]).addScaledVector(back, i <= DRAGON.tailLens.length ? DRAGON.tailLens[i - 1] : 1.4);
    this.updateLegs(0.016); this.updateTail(0.016); this.updateNeck(0.016);
    this.m.group.updateMatrixWorld(true);
    this.updateBoxes();
  }

  get forward() { return _h.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // ---------- 碰撞盒 ----------
  updateBoxes() { for (const b of this.boxes) b.pos.copy(b.off).applyMatrix4(b.node.matrixWorld); }
  boxFor(part) { return this.boxes.find((b) => b.part === part); }

  hitTestSegment(p0, p1, r) {
    if (!this.alive) return null;
    let best = null;
    for (const b of this.boxes) {
      if (b.part.startsWith('bay') && this.bays[b.part === 'bayL' ? 0 : 1].broken) continue;
      const t = segmentSphere(p0, p1, b.pos, b.r + r);
      if (t >= 0 && (!best || t < best.t)) best = { t, part: b.part, box: b };
    }
    if (best) best.point = new THREE.Vector3().lerpVectors(p0, p1, best.t);
    return best;
  }
  hitTestBlade(a, b, r) {
    if (!this.alive) return [];
    const res = new Map();
    for (const box of this.boxes) {
      if (box.part.startsWith('bay') && this.bays[box.part === 'bayL' ? 0 : 1].broken) continue;
      closestPointOnSegment(box.pos, a, b, _a);
      const d = _a.distanceTo(box.pos);
      if (d < box.r + r) {
        const t = a.distanceTo(_a) / Math.max(1e-6, a.distanceTo(b));
        const prev = res.get(box.part);
        if (!prev || t < prev.t) res.set(box.part, { part: box.part, t, point: _a.clone().lerp(box.pos, 0.4) });
      }
    }
    return [...res.values()];
  }
  splashDamage(p, R, dmg, source) {
    let best = null, bd = Infinity;
    for (const b of this.boxes) {
      const d = b.pos.distanceTo(p) - b.r;
      if (d < bd) { bd = d; best = b; }
    }
    if (best && bd < R) this.damage(best.part, dmg * (1 - Math.max(0, bd) / R), p, { source, poise: 1.5 });
  }
  // 把奇魔猪推出巨龙的身体；如果它站在巨龙身上，返回站立高度
  resolveCollision(pos, radius) {
    if (!this.alive && this.deadT > 3) { /* 倒下后仍然是实心的 */ }
    let stand = null;
    for (const b of this.boxes) {
      if (!b.solid) continue;
      for (const h of [0.6, 1.4]) {
        _a.set(pos.x, pos.y + h, pos.z).sub(b.pos);
        const d = _a.length(), min = radius + b.r;
        if (d >= min || d < 1e-5) continue;
        _a.divideScalar(d);
        if (_a.y > 0.72 && h === 0.6) {
          const hd = Math.hypot(pos.x - b.pos.x, pos.z - b.pos.z);
          const top = b.pos.y + Math.sqrt(Math.max(0, min * min - hd * hd)) - 0.6;
          if (stand === null || top > stand) stand = top;
        } else {
          const hl = Math.hypot(_a.x, _a.z) || 1;
          const push = min - d;
          pos.x += (_a.x / hl) * push; pos.z += (_a.z / hl) * push;
        }
      }
    }
    return stand;
  }
  nearestSurface(from, near, maxDist = 12) {
    let best = null, bd = Infinity;
    for (const b of this.boxes) {
      if (!b.solid && b.part !== 'muzzle' && !b.part.startsWith('bay')) continue;
      if (near && b.pos.distanceTo(near) > 3.5) continue;
      const d = b.pos.distanceTo(from) - b.r;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best || bd > maxDist) return null;
    return _g.subVectors(from, best.pos).normalize().multiplyScalar(best.r).add(best.pos).clone();
  }
  lockCandidates() {
    const list = [
      { kind: 'part', id: 'head', pos: this.boxes[0].pos, label: '头部' },
      { kind: 'part', id: 'body', pos: this.boxFor('body').pos, label: '躯干' },
    ];
    this.bays.forEach((b, i) => { if (!b.broken) list.push({ kind: 'part', id: i === 0 ? 'bayL' : 'bayR', pos: this.boxFor(i === 0 ? 'bayL' : 'bayR').pos, label: i === 0 ? '左翼导弹舱' : '右翼导弹舱' }); });
    return list;
  }
  lockPoint(id) {
    if (id === 'bayL' || id === 'bayR') { if (this.bays[id === 'bayL' ? 0 : 1].broken) return null; }
    const b = id === 'head' ? this.boxes[0] : this.boxFor(id);
    return b ? b.pos : null;
  }

  // ---------- 伤害 ----------
  damage(part, amount, point, opts = {}) {
    if (!this.alive || this.intro) return;
    const ctx = this.ctx;
    let mult = MULT[part] ?? 1;
    const a = this.action;
    if ((part === 'muzzle' || part === 'head') && a && a.type === 'beam' && a.phase === 'charge') {
      this.interrupt += amount * (part === 'muzzle' ? 2 : 1.2);
      ctx.hud.setInterrupt(this.interrupt / this.interruptNeed);
      if (this.interrupt >= this.interruptNeed) this.interruptBeam();
    }
    if (this.state === 'stagger' && (part === 'head' || part === 'muzzle')) mult *= 1.5;
    if (part === 'bayL' || part === 'bayR') {
      const bay = this.bays[part === 'bayL' ? 0 : 1];
      if (!bay.broken) { bay.hp -= amount; if (bay.hp <= 0) this.breakBay(bay, part); }
    }
    const dmg = amount * mult;
    this.hp = Math.max(0, this.hp - dmg);
    const weak = part === 'head' || part === 'muzzle';
    this.poise += amount * (opts.poise ?? 1) * (weak ? 1.4 : 0.6);
    this.flashT = 0.07;
    ctx.player.addSpecial(dmg * 0.022);
    ctx.hud.hitMarker(weak || part.startsWith('bay'));
    ctx.hud.damageNumber(point, Math.round(dmg), weak);
    if (opts.source === 'rifle') ctx.player.stats.hits++;
    if (this.hp <= 0) { this.die(); return; }
    if (this.phase === 1 && this.hp < this.maxHp * 0.6) this.enterPhase(2);
    else if (this.phase === 2 && this.hp < this.maxHp * 0.3) this.enterPhase(3);
    if (this.poise >= this.poiseMax && this.state !== 'stagger' && !(a && a.noStagger)) this.startStagger(2.6, '巨龙失去平衡！');
  }

  breakBay(bay, part) {
    const ctx = this.ctx;
    bay.broken = true; bay.openTarget = 0;
    bay.hatches.forEach((h) => (h.visible = false));
    for (const pm of bay.podMeshes) if (pm.material === this.m.materials.armor) { pm.userData.origMat = pm.material; pm.material = this.m.materials.charred; }
    bay.pod.getWorldPosition(_a);
    ctx.effects.explosion(_a, 2.4);
    ctx.audio.partBreak(_a);
    ctx.hud.toast(part === 'bayL' ? '左翼导弹舱 击破！' : '右翼导弹舱 击破！', 'gold');
    ctx.hud.flashPart(part);
    this.hp = Math.max(1, this.hp - 400);
    this.startStagger(2.2, null);
    ctx.player.addSpecial(15);
  }
  onFunnelDestroyed() {
    this.ctx.hud.toast(`浮游炮 击坠！ 剩余 ${this.funnels.aliveCount}`, 'gold', 0.9);
    this.ctx.player.addSpecial(3);
  }

  enterPhase(p) {
    this.phase = p;
    this.cancelAction();
    this.startAction('roar', { phaseMsg: p });
  }

  startStagger(dur, msg) {
    this.cancelAction();
    this.state = 'stagger'; this.staggerT = dur;
    this.poise = 0; this.poiseMax *= 1.3;
    if (msg) this.ctx.hud.toast(msg, 'gold');
    this.ctx.audio.stomp(this.pos, true);
  }

  interruptBeam() {
    const ctx = this.ctx;
    this.m.muzzleTip.getWorldPosition(_a);
    ctx.effects.explosion(_a, 2.0, { color: { r: 1.5, g: 3.5, b: 1.8 } });
    ctx.audio.partBreak(_a);
    ctx.hud.toast('主炮中断！', 'gold');
    ctx.hud.setInterrupt(-1);
    this.hp = Math.max(1, this.hp - 250);
    ctx.player.addSpecial(12);
    this.startStagger(3.0, null);
  }

  die() {
    const ctx = this.ctx;
    this.alive = false;
    this.cancelAction();
    this.state = 'dead'; this.deadT = 0;
    for (const f of this.funnels.list) if (f.alive && f.state !== 'docked') this.funnels.kill(f);
    this.funnels.deployed = false;
    ctx.hud.setInterrupt(-1);
    ctx.game.onDragonDefeated();
  }

  // ---------- 行动 ----------
  cancelAction() {
    const a = this.action;
    if (!a) return;
    if (this.beamCtl) { this.beamCtl.charge?.stop(); this.beamCtl.fire?.stop(); this.beamCtl = null; }
    this.beam.visible = false;
    this.m.hipFlames.forEach((f) => (f.visible = false));
    for (const b of this.bays) b.openTarget = 0;
    for (const L of this.legs) if (L.override) { L.override = null; }
    this.pose.rear = 0; this.headRaise = 0; this.jawTarget = 0.3; this.pose.tailStiff = 0;
    this.ctx.hud.setInterrupt(-1);
    this.ctx.hud.warn(null);
    this.action = null;
  }

  startAction(type, data = {}) {
    this.action = { type, t: 0, phase: 'start', ...data };
    const a = this.action, ctx = this.ctx;
    switch (type) {
      case 'beam':
        a.phase = 'raise'; a.noStagger = false;
        this.interrupt = 0; this.interruptNeed = 300 * (1 + (this.phase - 1) * 0.25);
        a.fireDur = this.phase >= 3 || a.burst ? 1.9 : this.phase === 2 ? 1.5 : 1.3;
        a.sweep = this.phase >= 3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        ctx.hud.warn(a.burst ? '⚠ 全武装齐射' : '⚠ 主炮蓄能 —— 射击发光的炮口可以打断', 'green');
        if (a.burst) { this.funnels.deploy(15); this.cool.funnels = 24; }
        break;
      case 'missiles': a.phase = 'open'; a.fired = 0; a.perWing = this.phase === 1 ? 4 : 6; a.next = 0; break;
      case 'funnels': a.phase = 'prep'; break;
      case 'claw': {
        _a.subVectors(ctx.player.pos, this.pos);
        const localX = _a.x * Math.cos(this.yaw) - _a.z * Math.sin(this.yaw);
        a.side = localX >= 0 ? 1 : -1; a.leg = this.legs[a.side > 0 ? 0 : 1]; a.phase = 'windup'; a.hit = false;
        break;
      }
      case 'stomp': a.phase = 'rear'; a.hit = false; break;
      case 'tail': {
        _a.subVectors(ctx.player.pos, this.pos);
        const localX = _a.x * Math.cos(this.yaw) - _a.z * Math.sin(this.yaw);
        a.side = localX >= 0 ? 1 : -1; a.phase = 'windup'; a.hit = false;
        break;
      }
      case 'charge': a.phase = 'windup'; a.hit = false; a.speed = 0; break;
      case 'roar':
        a.phase = 'roar'; a.noStagger = true;
        break;
    }
  }

  chooseAction() {
    const ctx = this.ctx, p = ctx.player;
    _a.subVectors(p.pos, this.pos); _a.y = 0;
    const dist = _a.length();
    const ang = Math.abs(wrapAngle(Math.atan2(_a.x, _a.z) - this.yaw));
    const air = p.pos.y - ctx.world.heightAt(p.pos.x, p.pos.z) > 3.5;
    const w = {};
    if (dist < 8.5 && ang < 0.9) { w.claw = 3; w.stomp = 2; }
    if (dist < 11 && ang > 1.9) w.tail = 5;
    if (dist < 13 && ang >= 0.9 && ang <= 1.9) { w.tail = 1.5; w.stomp = 1.6; }
    if (dist >= 7 && ang < 0.75) w.beam = 2.1;
    if (dist >= 8 && this.bays.some((b) => !b.broken)) w.missiles = 2.2;
    if (dist >= 13 && dist < 48 && ang < 0.45) w.charge = 1.5;
    if (this.funnels.dockedCount >= 3 && !this.funnels.active) w.funnels = this.phase === 1 ? 1.3 : 2.8;
    if (air) { w.beam = (w.beam || 0) + 1.2; if (w.missiles) w.missiles += 1.2; if (w.claw) w.claw *= 0.3; if (w.stomp) w.stomp *= 0.2; }
    if (this.phase === 3 && this.cool.burst <= 0 && dist > 8 && ang < 0.8) w.burst = 4;
    for (const k of Object.keys(w)) if (this.cool[k] > 0) delete w[k];
    const keys = Object.keys(w);
    if (!keys.length) return false;
    let total = keys.reduce((s, k) => s + w[k], 0), r = Math.random() * total;
    let pickK = keys[0];
    for (const k of keys) { r -= w[k]; if (r <= 0) { pickK = k; break; } }
    const diffCd = ctx.game.difficulty.cd;
    const CD = { beam: 7, missiles: 6.5, funnels: 22, claw: 2.6, stomp: 5.5, tail: 3, charge: 7.5, burst: 26 };
    this.cool[pickK] = CD[pickK] * diffCd;
    if (pickK === 'burst') { this.cool.beam = Math.max(this.cool.beam, 5); this.startAction('beam', { burst: true }); ctx.hud.toast('全武装齐射！', 'green'); }
    else this.startAction(pickK);
    return true;
  }

  updateAction(dt) {
    const a = this.action, ctx = this.ctx, p = ctx.player, fx = ctx.effects;
    a.t += dt;
    const t = a.t;
    switch (a.type) {
      case 'beam': {
        this.m.muzzleTip.getWorldPosition(_a);
        if (a.phase === 'raise') {
          this.headRaise = smoothstep(0, 0.5, t) * 0.75; this.jawTarget = 0.75;
          if (t > 0.5) { a.phase = 'charge'; a.t = 0; this.beamCtl = { charge: ctx.audio.beamCharge(_a, 1.5) }; ctx.audio.warning(); }
        } else if (a.phase === 'charge') {
          this.headRaise = (1 - smoothstep(0.6, 1.3, t)) * 0.75;
          this.jawTarget = 0.85;
          const k = t / 1.5;
          this.m.rings.forEach((r, i) => {
            const on = smoothstep(i * 0.22, i * 0.22 + 0.25, k);
            r.material.color.setRGB(0.1 + on * 1.4, 0.8 + on * 5.0, 0.35 + on * 2.2);
          });
          this.m.core.material.color.setRGB(0.2 + k * 3, 1.4 + k * 6, 0.6 + k * 3);
          this.m.mouthLight.intensity = k * 45;
          // 聚能粒子
          for (let i = 0; i < 3; i++) {
            _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 3.5));
            fx.add.spawn(_a.x + _b.x, _a.y + _b.y, _a.z + _b.z, -_b.x * 2.6, -_b.y * 2.6, -_b.z * 2.6, 0.5, 3, 1.2, 0.35, 0.05, 0.38, 1, 0);
          }
          if (a.burst && t > 0.2 && a.fired === undefined) { a.fired = 0; a.perWing = 4; a.next = 0; for (const b of this.bays) if (!b.broken) b.openTarget = 1; }
          if (a.burst && a.fired !== undefined) this.fireMissileSalvo(a, dt);
          if (t > 1.5) {
            a.phase = 'fire'; a.t = 0;
            this.beamCtl.charge?.stop();
            this.beamCtl.fire = ctx.audio.beamFire(_a);
            ctx.hud.warn(null); ctx.hud.setInterrupt(-1);
            this.beam.visible = true;
            fx.addShake(0.5);
            ctx.world.skyUniforms.uFlash.value = 1;
            a.tick = 0; a.scorch = 0;
          }
        } else if (a.phase === 'fire') {
          this.jawTarget = 0.9;
          if (a.burst && a.fired !== undefined) this.fireMissileSalvo(a, dt);
          this.updateBeamFire(dt, a);
          if (t > a.fireDur) {
            a.phase = 'recover'; a.t = 0;
            this.beam.visible = false;
            this.beamCtl?.fire?.stop(); this.beamCtl = null;
            for (const b of this.bays) b.openTarget = 0;
          }
        } else if (a.phase === 'recover') {
          this.jawTarget = 0.3;
          const k = 1 - t / 0.8;
          this.m.rings.forEach((r) => r.material.color.lerp(RING_DIM, 1 - Math.exp(-5 * dt)));
          this.m.core.material.color.lerp(CORE_DIM, 1 - Math.exp(-5 * dt));
          this.m.mouthLight.intensity = Math.max(0, k) * 10;
          if (Math.random() < 0.5) fx.smoke.spawn(_a.x, _a.y, _a.z, rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5), 0.6, 0.65, 0.62, 0.5, 2.5, 1.4, 0.4, 1, -0.5);
          if (t > 0.8) this.endAction();
        }
        break;
      }
      case 'missiles': {
        if (a.phase === 'open') {
          for (const b of this.bays) if (!b.broken) b.openTarget = 1;
          if (t > 0.7) { a.phase = 'fire'; a.t = 0; }
        } else if (a.phase === 'fire') {
          if (this.fireMissileSalvo(a, dt)) { a.phase = 'close'; a.t = 0; for (const b of this.bays) b.openTarget = 0; }
        } else if (a.phase === 'close' && t > 0.6) this.endAction();
        break;
      }
      case 'funnels': {
        this.pose.lean = -0.08 * Math.sin(Math.min(1, t / 0.6) * Math.PI);
        this.glowBoost = Math.sin(Math.min(1, t / 0.8) * Math.PI);
        if (a.phase === 'prep' && t > 0.6) {
          a.phase = 'go';
          const n = this.funnels.deploy(this.phase >= 2 ? 16 : 13);
          if (n) ctx.hud.toast('浮游炮展开！', 'green', 1.0);
        }
        if (t > 1.1) { this.glowBoost = 0; this.endAction(); }
        break;
      }
      case 'claw': {
        const L = a.leg, s = a.side;
        let target;
        if (a.phase === 'windup') {
          const k = easeInOutSine(Math.min(1, t / 0.55));
          target = _b.set(s * 2.1, lerp(0.4, 2.4, k), lerp(2.7, 2.2, k));
          this.pose.roll = -s * 0.1 * k;
          if (t > 0.55) { a.phase = 'swipe'; a.t = 0; ctx.audio.saberSwing(0.5); }
        } else if (a.phase === 'swipe') {
          const k = easeOutCubic(Math.min(1, t / 0.24));
          target = _b.set(lerp(s * 2.6, -s * 1.0, k), lerp(1.8, 0.7, k), lerp(3.4, 4.6, k));
          this.pose.roll = lerp(-s * 0.1, s * 0.12, k);
          // 判定：爪子的球
          L.foot.getWorldPosition(_c);
          if (!a.hit && p.alive) {
            p.capsule(_d, _e);
            closestPointOnSegment(_c, _d, _e, _f);
            if (_f.distanceTo(_c) < 1.3 + p.radius) { a.hit = true; p.takeDamage(150, _c, { type: 'claw', knock: 10, blockable: true, blockMult: 0.2 }); }
          }
          if (Math.random() < 0.6) fx.add.spawn(_c.x, _c.y, _c.z, rand(-1, 1), rand(0, 1), rand(-1, 1), 1.2, 1.2, 1.2, 0.4, 0.05, 0.25, 0.5, 2, 0);
          if (t > 0.24) { a.phase = 'recover'; a.t = 0; }
        } else {
          const k = Math.min(1, t / 0.45);
          target = _b.set(lerp(-s * 1.0, s * 1.9, k), lerp(0.7, 0.1, k), lerp(4.6, 2.9, k));
          this.pose.roll = lerp(s * 0.12, 0, k);
          if (t > 0.45) { L.override = null; this.pose.roll = 0; ctx.effects.dust(L.cur, 6, 1.2); ctx.audio.stomp(L.cur); this.endAction(); break; }
        }
        L.override = this.bodyLocalToWorldFlat(target, L.override || new THREE.Vector3());
        break;
      }
      case 'stomp': {
        const front = [this.legs[0], this.legs[1]];
        if (a.phase === 'rear') {
          const k = easeInOutSine(Math.min(1, t / 0.9));
          this.pose.rear = k; this.headRaise = k * 0.5; this.jawTarget = 0.6;
          front.forEach((L, i) => { L.override = this.bodyLocalToWorldFlat(_b.set((i ? -1 : 1) * 1.8, 0.4 + k * 3.2, 2.6 + k * 0.9), L.override || new THREE.Vector3()); });
          if (t > 0.9) { a.phase = 'slam'; a.t = 0; }
        } else if (a.phase === 'slam') {
          const k = Math.min(1, t / 0.16);
          this.pose.rear = 1 - k * k; this.headRaise = 0.5 * (1 - k);
          front.forEach((L, i) => { L.override = this.bodyLocalToWorldFlat(_b.set((i ? -1 : 1) * 1.85, (1 - k) * 3.6, 3.5), L.override || new THREE.Vector3()); });
          if (t > 0.16) {
            a.phase = 'recover'; a.t = 0;
            _c.copy(this.legs[0].override).add(this.legs[1].override).multiplyScalar(0.5);
            _c.y = ctx.world.heightAt(_c.x, _c.z);
            this.shock = { c: _c.clone(), r: 1.5, hit: false };
            fx.ring(_c, 1, 18, 1.0, new THREE.Color(1.6, 1.4, 1.1));
            fx.dust(_c, 26, 2.6); fx.debris(_c, 24, 9);
            fx.addShake(0.8);
            ctx.audio.stomp(_c, true);
            ctx.audio.explosion(_c, 0.8);
            for (const L of front) { L.override = null; L.cur.y = ctx.world.heightAt(L.cur.x, L.cur.z); }
          }
        } else if (t > 0.8) { this.jawTarget = 0.3; this.endAction(); }
        break;
      }
      case 'tail': {
        const s = a.side;
        if (a.phase === 'windup') {
          this.pose.tailSweep = s * 0.7 * easeInOutSine(Math.min(1, t / 0.5)); this.pose.tailStiff = 0.5;
          this.pose.roll = s * 0.05;
          if (t > 0.5) { a.phase = 'sweep'; a.t = 0; ctx.audio.saberSwing(0.4); }
        } else if (a.phase === 'sweep') {
          const k = easeOutCubic(Math.min(1, t / 0.42));
          this.pose.tailSweep = lerp(s * 0.7, -s * 2.5, k); this.pose.tailStiff = 1;
          if (!a.hit && p.alive) {
            p.capsule(_d, _e);
            for (const b of this.tailBoxes) {
              closestPointOnSegment(b.pos, _d, _e, _f);
              if (_f.distanceTo(b.pos) < b.r + p.radius + 0.25) { a.hit = true; p.takeDamage(140, b.pos, { type: 'tail', knock: 10, blockable: true, blockMult: 0.2 }); break; }
            }
          }
          if (t > 0.42) { a.phase = 'recover'; a.t = 0; }
        } else {
          const k = Math.min(1, t / 0.6);
          this.pose.tailSweep = lerp(-s * 2.5, 0, easeInOutSine(k)); this.pose.tailStiff = 1 - k; this.pose.roll = 0;
          if (t > 0.6) this.endAction();
        }
        break;
      }
      case 'charge': {
        const fwd = this.forward;
        if (a.phase === 'windup') {
          this.pose.crouch = smoothstep(0, 0.5, t) * 0.5; this.headRaise = -0.35 * smoothstep(0, 0.5, t);
          this.turnToward(p.pos, 2.2, dt);
          this.m.hipFlames.forEach((f) => { f.visible = true; f.scale.setScalar(0.4 + t * 0.5 + Math.random() * 0.15); });
          if (t > 0.3 && t - dt <= 0.3) ctx.audio.roar(this.pos);
          if (t > 0.9) { a.phase = 'run'; a.t = 0; a.speed = 8; }
        } else if (a.phase === 'run') {
          a.speed = Math.min(22, a.speed + 40 * dt);
          if (t < 0.35) this.turnToward(p.pos, 0.8, dt);
          this.vel.copy(fwd).multiplyScalar(a.speed);
          this.m.hipFlames.forEach((f) => { f.visible = true; f.scale.setScalar(1 + Math.random() * 0.3); });
          if (Math.random() < 0.7) { const L = this.legs[Math.floor(Math.random() * 4)]; fx.dust(L.cur, 1, 1.2); }
          if (!a.hit && p.alive) {
            p.capsule(_d, _e);
            for (const b of this.boxes) {
              if (b.part !== 'head' && b.part !== 'body' && b.part !== 'neck') continue;
              closestPointOnSegment(b.pos, _d, _e, _f);
              if (_f.distanceTo(b.pos) < b.r + p.radius) { a.hit = true; p.takeDamage(170, _c.copy(b.pos).addScaledVector(fwd, -2), { type: 'charge', knock: 13, blockable: true, blockMult: 0.25 }); break; }
            }
          }
          // 撞上岩石
          _c.copy(this.pos).addScaledVector(fwd, 4.2);
          for (const r of ctx.world.rocks) {
            if (Math.hypot(_c.x - r.x, _c.z - r.z) < r.r * 0.95 + 0.8) {
              fx.explosion(_c.setY(_c.y + 2), 1.2); fx.debris(_c, 30, 10); ctx.audio.stomp(_c, true);
              this.vel.set(0, 0, 0);
              this.m.hipFlames.forEach((f) => (f.visible = false));
              this.damage('head', 180, _c, { poise: 0 });
              this.startStagger(2.0, '巨龙撞上了岩石！');
              return;
            }
          }
          if (t > 1.5) { a.phase = 'brake'; a.t = 0; }
        } else {
          a.speed = Math.max(0, a.speed - 40 * dt);
          this.vel.copy(fwd).multiplyScalar(a.speed);
          this.pose.crouch = 0.5 * (1 - t / 0.5); this.headRaise = -0.35 * (1 - t / 0.5);
          this.m.hipFlames.forEach((f) => (f.visible = false));
          if (t > 0.5) { this.pose.crouch = 0; this.headRaise = 0; this.endAction(); }
        }
        break;
      }
      case 'roar': {
        this.headRaise = smoothstep(0, 0.35, t) * 0.9 * (1 - smoothstep(1.8, 2.3, t));
        this.jawTarget = t < 1.9 ? 1.0 : 0.3;
        if (t > 0.3 && !a.roared) {
          a.roared = true;
          ctx.audio.roar(this.pos);
          ctx.world.gustBoost = 1.6;
          fx.addShake(0.6);
          if (a.phaseMsg === 2) ctx.hud.toast('第二阶段：浮游炮全开', 'green', 2.2);
          if (a.phaseMsg === 3) { ctx.hud.toast('第三阶段：狂暴！小心全武装齐射', 'green', 2.4); this.cool.burst = 3; }
          this.m.muzzleTip.getWorldPosition(_c);
          fx.ring(_c.setY(ctx.world.heightAt(_c.x, _c.z)), 2, 30, 1.2, new THREE.Color(0.4, 1.6, 0.8));
        }
        if (a.roared && t < 1.5 && p.alive) {
          _c.subVectors(p.pos, this.pos); _c.y = 0;
          const d = _c.length();
          if (d < 26) p.vel.addScaledVector(_c.normalize(), (1 - d / 26) * 14 * dt);
        }
        if (t > 2.4) { this.endAction(); if (a.after) a.after(); }
        break;
      }
    }
  }

  fireMissileSalvo(a, dt) {
    const ctx = this.ctx;
    const live = this.bays.filter((b) => !b.broken);
    if (!live.length) return true;
    a.next -= dt;
    while (a.next <= 0 && a.fired < a.perWing * live.length) {
      a.next += 0.085;
      const bay = live[a.fired % live.length];
      bay.pod.updateWorldMatrix(true, false);
      const zLocal = rand(-1.1, 1.1);
      _a.set(bay.side * 0.6, rand(-0.1, 0.25), zLocal).applyMatrix4(bay.pod.matrixWorld);
      _b.set(bay.side, 0.9, rand(-0.3, 0.3)).transformDirection(bay.pod.matrixWorld);
      _b.y = Math.abs(_b.y) + 0.6;
      ctx.projectiles.launchMissile(_a, _b.normalize(), { dmg: 42, turn: this.phase >= 3 ? 2.8 : 2.4 });
      ctx.audio.missileLaunch(_a);
      ctx.effects.flash(_a, new THREE.Color(3, 1.8, 0.8), 1.2, 0.1);
      ctx.effects.smoke.spawn(_a.x, _a.y, _a.z, _b.x * 2, _b.y * 2, _b.z * 2, 0.8, 0.8, 0.82, 0.6, 2.5, 1.2, 0.6, 1.5, -0.3);
      a.fired++;
    }
    return a.fired >= a.perWing * live.length;
  }

  updateBeamFire(dt, a) {
    const ctx = this.ctx, fx = ctx.effects, p = ctx.player, world = ctx.world;
    // 炮口位置和方向 = 头的朝向
    const mw = this.m.muzzle.matrixWorld;
    const o = _a.setFromMatrixPosition(mw);
    const dir = _b.set(mw.elements[8], mw.elements[9], mw.elements[10]).normalize();
    let len = world.raycast(o, dir, 140, true);
    if (!isFinite(len)) len = 140;
    // 打中奇魔猪时光束停在它身上（举盾时停在盾牌前）
    let hitPlayer = false;
    if (p.alive) {
      p.capsule(_d, _e);
      const endTmp = _c.copy(o).addScaledVector(dir, len);
      const dist = segmentSegmentDistance(o, endTmp, _d, _e);
      if (dist < p.radius + 0.55) {
        hitPlayer = true;
        _f.copy(_d).lerp(_e, 0.5).sub(o);
        len = Math.max(1, Math.min(len, _f.dot(dir) - p.radius * 0.8));
      }
    }
    const w = 1 + Math.sin(this.t * 50) * 0.06;
    const k = Math.min(1, a.t / 0.08) * (a.t > a.fireDur - 0.15 ? Math.max(0, (a.fireDur - a.t) / 0.15) : 1);
    // 镜头离光束很近时，把外层光晕调淡，免得整个画面发白
    const cam = ctx.camera.position;
    const camSeg = closestPointOnSegment(cam, o, _g.copy(o).addScaledVector(dir, len), _h);
    const near = smoothstep(0.8, 4.5, camSeg.distanceTo(cam));
    this.beam.position.copy(o);
    this.beam.quaternion.setFromUnitVectors(Z, dir);
    this.beamCore.scale.set(0.3 * w * k + 0.001, 0.3 * w * k + 0.001, len);
    this.beamGlow.scale.set(0.72 * w * k + 0.001, 0.72 * w * k + 0.001, len);
    this.beamHaze.scale.set(1.4 * k + 0.001, 1.4 * k + 0.001, len);
    this.beamGlow.material.opacity = 0.42 * (0.35 + 0.65 * near);
    this.beamHaze.material.opacity = 0.14 * near;
    this.m.mouthLight.intensity = 60;
    const end = _c.copy(o).addScaledVector(dir, len);
    // 打在地面上：冒烟的长沟（焦痕密，爆炸稀）
    a.scorch -= dt; a.boom = (a.boom ?? 0) - dt;
    if (a.scorch <= 0 && (len < 139 || hitPlayer)) {
      a.scorch = 0.05;
      const gy = world.heightAt(end.x, end.z);
      if (end.y - gy < 1.5) fx.scorch(_d.set(end.x, gy, end.z), world.normalAt(end.x, end.z, _e), 2.6, 14);
      fx.debris(end, 4, 7);
      fx.dust(end, 1, 1.8, { r: 0.35, g: 0.38, b: 0.32 });
      for (let i = 0; i < 4; i++) fx.add.spawn(end.x, end.y, end.z, rand(-6, 6), rand(1, 8), rand(-6, 6), 0.8, 3, 1.4, 0.3, 0.05, rand(0.2, 0.45), 1, 2, 12);
    }
    if (a.boom <= 0 && (len < 139 || hitPlayer)) {
      a.boom = 0.16;
      fx.explosion(end, 0.38, { noShake: true, color: { r: 0.7, g: 2.2, b: 1.0 } });
      fx.light(end, new THREE.Color(0.3, 1, 0.5), 40, 0.18, 18);
    }
    fx.addShake(0.02);
    // 伤害：每 0.1 秒一次
    a.tick -= dt;
    if (a.tick <= 0 && hitPlayer) {
      a.tick = 0.1;
      p.takeDamage(22, o, { type: 'beamTick', knock: 1.6, blockable: true, blockMult: 0.15 });
    }
    // 慢慢扫向目标（第三阶段会横扫）
    if (a.sweep) a.sweepOff = (a.sweepOff ?? -0.55 * a.sweep) + a.sweep * dt * 0.6;
  }

  endAction() {
    this.action = null;
    const diffCd = this.ctx.game.difficulty.cd;
    const base = this.phase === 3 ? rand(0.6, 1.3) : this.phase === 2 ? rand(0.9, 1.7) : rand(1.2, 2.2);
    this.idleT = base * diffCd;
  }

  turnToward(target, rate, dt) {
    const desired = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw = approachAngle(this.yaw, desired, rate * dt);
  }

  // 身体局部坐标（只算偏航，不算俯仰）→ 世界坐标，y 是离地高度
  bodyLocalToWorldFlat(local, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    out.set(this.pos.x + local.x * c + local.z * s, 0, this.pos.z - local.x * s + local.z * c);
    out.y = this.ctx.world.heightAt(out.x, out.z) + local.y;
    return out;
  }
  footHome(L, out) {
    const lead = this.vel.length() > 0.3 ? 0.42 : 0;
    this.bodyLocalToWorldFlat(_e.set(L.x * 1.17, 0, L.z + (L.front ? 0.45 : 0.05)), out);
    out.x += this.vel.x * lead; out.z += this.vel.z * lead;
    out.y = this.ctx.world.heightAt(out.x, out.z);
    return out;
  }

  // ---------- 每帧 ----------
  update(dt, battle) {
    const ctx = this.ctx, p = ctx.player, world = ctx.world;
    this.t += dt;
    for (const k of Object.keys(this.cool)) this.cool[k] -= dt;
    this.flashT = Math.max(0, this.flashT - dt);

    if (this.state === 'dead') this.updateDeath(dt);
    else if (this.state === 'stagger') {
      this.staggerT -= dt;
      this.pose.crouch = damp(this.pose.crouch, 0.85, 6, dt);
      this.headRaise = damp(this.headRaise, -0.55, 6, dt);
      this.jawTarget = 0.6;
      this.vel.multiplyScalar(Math.exp(-4 * dt));
      if (Math.random() < 0.25) { const b = this.boxes[Math.floor(Math.random() * this.boxes.length)]; ctx.effects.sparks(b.pos, UP, GREEN_SPARK, 4, 6); }
      if (this.staggerT <= 0) { this.state = 'idle'; this.idleT = 0.6; this.pose.crouch = 0; }
    } else if (battle && !this.intro) {
      if (this.action) {
        this.updateAction(dt);
        // 行动中也可以慢慢转身
        if (this.action && (this.action.type === 'beam')) {
          const rate = this.action.phase === 'fire' ? 0.3 : 0.9;
          this.turnToward(p.pos, rate, dt);
        }
        if (this.action && this.action.type !== 'charge') this.vel.multiplyScalar(Math.exp(-5 * dt));
      } else {
        this.locomotion(dt);
        this.idleT -= dt;
        if (this.idleT <= 0 && p.alive && this.aiEnabled) { if (!this.chooseAction()) this.idleT = 0.3; }
      }
    } else {
      this.vel.multiplyScalar(Math.exp(-4 * dt));
    }

    // 位置
    this.pos.addScaledVector(this.vel, dt);
    this.keepInBounds();
    this.pos.y = world.heightAt(this.pos.x, this.pos.z);

    // 冲击波
    if (this.shock) {
      const s = this.shock;
      s.r += 18 * dt;
      if (!s.hit && p.alive) {
        const d = Math.hypot(p.pos.x - s.c.x, p.pos.z - s.c.z);
        const onGround = p.pos.y - world.heightAt(p.pos.x, p.pos.z) < 0.6;
        if (onGround && Math.abs(d - s.r) < 1.0) { s.hit = true; p.takeDamage(110, s.c, { type: 'shock', knock: 7, blockable: true, blockMult: 0.3 }); }
      }
      if (s.r > 18) this.shock = null;
    }

    this.updateFunnels(dt);
    this.updateBays(dt);
    this.placeBody(dt);
    this.m.group.updateMatrixWorld(true);
    this.updateNeck(dt);
    this.m.body.updateMatrixWorld(true);
    this.updateLegs(dt);
    this.updateTail(dt);
    this.m.group.updateMatrixWorld(true);
    this.updateBoxes();
    this.updateMaterials(dt);
    // 踩草
    this.legs.forEach((L, i) => world.setPusher(1 + i, L.cur.x, L.cur.z, 1.8));
    world.setPusher(5, this.pos.x, this.pos.z, 3.2);
  }

  updateFunnels(dt) { this.funnels.rate = this.ctx.game.difficulty.cd < 1 ? 1.25 : 1; this.funnels.update(dt, this.phase); }

  locomotion(dt) {
    const ctx = this.ctx, p = ctx.player;
    _a.subVectors(p.pos, this.pos); _a.y = 0;
    const dist = _a.length();
    const desired = Math.atan2(_a.x, _a.z);
    const err = Math.abs(wrapAngle(desired - this.yaw));
    const turnRate = this.phase === 3 ? 1.3 : 0.95;
    this.yaw = approachAngle(this.yaw, desired, turnRate * dt);
    const walk = this.phase === 3 ? 4.6 : 3.5;
    let sp = 0;
    if (dist > 22) sp = walk; else if (dist > 12) sp = walk * 0.6; else if (dist < 5) sp = -1.2;
    if (err > 0.8) sp *= 0.25;
    const fwd = this.forward;
    _b.copy(fwd).multiplyScalar(sp);
    // 绕开岩石
    for (const r of ctx.world.rocks) {
      _c.set(this.pos.x - r.x, 0, this.pos.z - r.z);
      const d = _c.length(), min = r.r + 5;
      if (d < min) _b.addScaledVector(_c.normalize(), (1 - d / min) * 4);
    }
    this.vel.lerp(_b, 1 - Math.exp(-3 * dt));
    this.turning = err > 0.15;
  }

  keepInBounds() {
    const r = Math.hypot(this.pos.x, this.pos.z), max = ARENA_RADIUS - 6;
    if (r > max) { this.pos.x *= max / r; this.pos.z *= max / r; }
    for (const rk of this.ctx.world.rocks) {
      const dx = this.pos.x - rk.x, dz = this.pos.z - rk.z, d = Math.hypot(dx, dz), min = rk.r + 2.4;
      if (d < min && d > 1e-3) { this.pos.x = rk.x + (dx / d) * min; this.pos.z = rk.z + (dz / d) * min; }
    }
  }

  placeBody(dt) {
    const world = this.ctx.world, b = this.m.body;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // 用前后左右四个点的地形算身体的俯仰和横滚
    const hF = world.heightAt(this.pos.x + s * 2.3, this.pos.z + c * 2.3), hB = world.heightAt(this.pos.x - s * 2.3, this.pos.z - c * 2.3);
    const hL = world.heightAt(this.pos.x + c * 1.6, this.pos.z - s * 1.6), hR = world.heightAt(this.pos.x - c * 1.6, this.pos.z + s * 1.6);
    const ground = (hF + hB + hL + hR) / 4;
    const tPitch = -Math.atan2(hF - hB, 4.6) * 0.8, tRoll = Math.atan2(hL - hR, 3.2) * 0.6;
    const rearA = this.pose.rear * 0.5;
    const breath = Math.sin(this.t * 1.3) * 0.05;
    const walkBob = Math.abs(Math.sin(this.t * 6)) * Math.min(1, this.vel.length() / 10) * 0.12;
    const targetY = ground + DRAGON.bodyH - this.pose.crouch * 0.9 + Math.sin(rearA) * 2.3 + breath + walkBob;
    if (this.state === 'dead') { /* 由 updateDeath 控制高度 */ }
    else b.position.set(this.pos.x, targetY, this.pos.z);
    if (this.state !== 'dead') {
      b.position.x -= s * Math.sin(rearA) * 0.8; b.position.z -= c * Math.sin(rearA) * 0.8;
      b.rotation.y = this.yaw;
      b.rotation.x = damp(b.rotation.x, tPitch - rearA + this.pose.crouch * 0.12 + this.pose.lean, 8, dt);
      b.rotation.z = damp(b.rotation.z, tRoll + this.pose.roll, 6, dt);
    }
  }

  updateNeck(dt) {
    const ctx = this.ctx, m = this.m;
    // 瞄准点：奇魔猪的身体中间（开主炮时慢慢扫过去）
    const p = ctx.player;
    _a.copy(p.pos); _a.y += 1.0;
    if (this.intro) _a.copy(m.neckBase.getWorldPosition(_b)).addScaledVector(this.forward, 20).setY(_b.y + Math.sin(this.t * 0.5) * 2);
    m.body.updateMatrixWorld(true);
    const local = m.body.worldToLocal(_b.copy(_a));
    local.sub(m.neckBase.position);
    // 头在脖子根部前上方约 (0, 1.0, 2.6)，按头的位置估算俯仰
    let yawT = Math.atan2(local.x, local.z);
    let pitchT = Math.atan2(local.y - 1.0, Math.max(1.5, Math.hypot(local.x, local.z) - 2.6));
    const a = this.action;
    if (a && a.type === 'beam' && a.phase === 'fire' && a.sweep) yawT += a.sweepOff || 0;
    yawT = clamp(yawT, -1.15, 1.15);
    pitchT = clamp(pitchT, -0.65, 0.85);
    const firing = a && a.type === 'beam' && a.phase === 'fire';
    const rate = firing ? (a.sweep ? 0.7 : 0.34) : 2.2;
    this.headYaw = approachAngle(this.headYaw, yawT, rate * dt);
    this.headPitch = approachAngle(this.headPitch, pitchT, rate * dt);
    const pitch = this.headPitch + this.headRaise;
    for (let i = 0; i < m.neck.length; i++) {
      m.neck[i].rotation.y = this.headYaw / m.neck.length;
      m.neck[i].rotation.x = (-pitch + 0.05) / m.neck.length;
    }
    // 下颚
    this.jaw = damp(this.jaw, this.jawTarget, 10, dt);
    m.jaw.rotation.x = this.jaw * 0.6;
    if (this.intro && this.state !== 'dead') m.jaw.rotation.x = 0.2 + Math.sin(this.t * 1.7) * 0.05;
  }

  updateLegs(dt) {
    const ctx = this.ctx, world = ctx.world, body = this.m.body;
    const speed = this.vel.length();
    const stepDur = clamp(0.5 - speed * 0.016, 0.2, 0.5);
    const fwd = _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const stepping = this.legs.some((L) => L.stepping);
    const dead = this.state === 'dead';
    // 需不需要迈步：对角线两条腿一组（左前+右后、右前+左后）
    if (!stepping && !dead) {
      const groups = [[0, 3], [1, 2]];
      let best = -1, bestNeed = 0;
      groups.forEach((g, gi) => {
        let need = 0;
        for (const i of g) {
          const L = this.legs[i];
          if (L.override) continue;
          this.footHome(L, _a);
          need = Math.max(need, Math.hypot(_a.x - L.cur.x, _a.z - L.cur.z));
        }
        if (gi === this.lastGroup) need *= 0.8;
        if (need > bestNeed) { bestNeed = need; best = gi; }
      });
      const thresh = speed > 0.5 || this.turning ? 0.9 : 0.4;
      if (best >= 0 && bestNeed > thresh) {
        this.lastGroup = best;
        for (const i of groups[best]) {
          const L = this.legs[i];
          if (L.override) continue;
          L.stepping = true; L.t = 0; L.from.copy(L.cur); this.footHome(L, L.to);
        }
      }
    }
    for (const L of this.legs) {
      if (L.override) {
        L.cur.lerp(L.override, 1 - Math.exp(-25 * dt));
        L.stepping = false;
      } else if (L.stepping) {
        L.t += dt / stepDur;
        const k = Math.min(1, L.t);
        const e = easeInOutSine(k);
        L.cur.lerpVectors(L.from, L.to, e);
        L.cur.y = lerp(L.from.y, L.to.y, e) + Math.sin(Math.PI * k) * (0.55 + speed * 0.04);
        if (k >= 1) {
          L.stepping = false; L.cur.copy(L.to);
          if (this.t - this.lastFootSound > 0.08) { this.lastFootSound = this.t; ctx.audio.stomp(L.cur, false); }
          ctx.effects.dust(L.cur, 3, 1.0);
          const cd = ctx.camera.position.distanceTo(L.cur);
          ctx.effects.addShake(clamp(0.12 * (1 - cd / 30), 0, 0.12));
        }
      } else if (!dead) {
        L.cur.y = damp(L.cur.y, world.heightAt(L.cur.x, L.cur.z), 12, dt);
      }
      // 两段 IK
      L.hip.set(L.x, L.y, L.z).applyMatrix4(body.matrixWorld);
      _a.copy(L.cur); _a.y += DRAGON.ankle;
      _b.copy(fwd).multiplyScalar(L.front ? -1 : 1).addScaledVector(UP, L.front ? -0.1 : 0.2);
      solveTwoBone(L.hip, _a, DRAGON.l1, DRAGON.l2, _b, L.knee, L.ankle);
      orientBone(L.upper, L.hip, L.knee, fwd);
      orientBone(L.lower, L.knee, L.ankle, fwd);
      L.foot.position.copy(L.ankle);
      _q.setFromAxisAngle(UP, this.yaw);
      L.foot.quaternion.copy(_q);
      if (L.override) L.foot.rotateX(-0.5);
    }
  }

  updateTail(dt) {
    const ctx = this.ctx, world = ctx.world, J = this.tailJoints, lens = DRAGON.tailLens, radii = DRAGON.tailRadius;
    this.m.tailBase.getWorldPosition(J[0]);
    const n = lens.length;
    const stiff = lerp(9, 30, this.pose.tailStiff);
    for (let i = 1; i < J.length; i++) {
      const len = i <= n ? lens[i - 1] : 1.4;
      const f = i / (n + 1);
      const sway = Math.sin(this.t * 1.7 - i * 0.55) * 0.28 * f + Math.sin(this.t * 0.6) * 0.1;
      const yawOff = this.pose.tailSweep * (0.55 + 0.45 * f) + sway;
      const ya = this.yaw + Math.PI + yawOff;
      _a.set(Math.sin(ya), -0.46 + f * 0.5 - this.pose.tailStiff * 0.3, Math.cos(ya)).normalize();
      _b.copy(J[i - 1]).addScaledVector(_a, len);
      J[i].lerp(_b, 1 - Math.exp(-stiff * dt));
      _c.subVectors(J[i], J[i - 1]).normalize();
      J[i].copy(J[i - 1]).addScaledVector(_c, len);
      const r = i <= n ? radii[i - 1] : 0.3;
      const gy = world.heightAt(J[i].x, J[i].z) + r;
      if (J[i].y < gy) J[i].y = gy;
    }
    for (let i = 0; i < n; i++) orientBone(this.m.tail[i].group, J[i], J[i + 1], UP);
    orientBone(this.m.blade, J[n], J[n + 1], UP);
  }

  updateBays(dt) {
    const fx = this.ctx.effects;
    for (const b of this.bays) {
      const prev = b.open;
      b.open = damp(b.open, b.openTarget, 8, dt);
      b.hatches.forEach((h, i) => {
        const k = clamp(b.open * 1.6 - i * 0.15, 0, 1);
        h.rotation.z = b.side * 1.25 * easeInOutSine(k);
      });
      if (b.openTarget > 0.5 && prev < 0.15 && b.open >= 0.15) { b.pod.getWorldPosition(_a); this.ctx.audio.hatch(_a); }
      if (b.broken) {
        b.droop = damp(b.droop, 0.35, 2, dt);
        b.group.rotation.z = -b.side * b.droop;
        if (this.state !== 'dead' || this.deadT < 6) {
          b.firePoint.getWorldPosition(_a);
          if (Math.random() < 0.8) fx.add.spawn(_a.x + rand(-0.4, 0.4), _a.y + rand(-0.3, 0.3), _a.z + rand(-1, 1), rand(-0.5, 0.5), rand(1, 2.5), rand(-0.5, 0.5), 3, 1.4, 0.4, 0.6, 1.4, 0.45, 0.9, 1, -1, 1.5, 0.3, 0.05);
          if (Math.random() < 0.5) fx.smoke.spawn(_a.x, _a.y + 0.3, _a.z, rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), 0.12, 0.12, 0.12, 0.8, 3.2, 2.4, 0.55, 0.8, -0.4);
        }
      }
    }
  }

  updateMaterials(dt) {
    const M = this.m.materials;
    const base = this.state === 'dead' ? Math.max(0, 1 - this.deadT / 3) * 1.6 : this.phase === 3 ? 2.9 + Math.sin(this.t * 6) * 0.6 : this.phase === 2 ? 2.2 : 1.6;
    const target = base + (this.glowBoost || 0) * 2;
    M.armor.emissiveIntensity = damp(M.armor.emissiveIntensity, target, 4, dt);
    const g = M.armor.emissiveIntensity / 1.6;
    M.glow.color.setRGB(0.35 * g, 2.6 * g, 1.0 * g);
    M.glowDim.color.setRGB(0.12 * g, 0.9 * g, 0.38 * g);
    M.armor.color.setScalar(1 + this.flashT * 7);
    // 不在开主炮时，炮口的聚能环慢慢暗回去
    const beamOn = this.action && this.action.type === 'beam' && this.action.phase !== 'recover';
    if (!beamOn && this.state !== 'dead') {
      const k = 1 - Math.exp(-4 * dt);
      this.m.rings.forEach((r) => r.material.color.lerp(RING_DIM, k));
      this.m.core.material.color.lerp(CORE_DIM, k);
      if (!(this.action && this.action.type === 'beam')) this.m.mouthLight.intensity = damp(this.m.mouthLight.intensity, 0, 4, dt);
    }
  }

  updateDeath(dt) {
    const ctx = this.ctx, fx = ctx.effects, b = this.m.body, world = ctx.world;
    this.deadT += dt;
    const t = this.deadT;
    this.vel.multiplyScalar(Math.exp(-3 * dt));
    // 接连爆炸
    this.boomT = (this.boomT ?? 0) - dt;
    if (t < 3.2 && this.boomT <= 0) {
      this.boomT = rand(0.12, 0.3);
      const box = this.boxes[Math.floor(Math.random() * this.boxes.length)];
      fx.explosion(_a.copy(box.pos).add(_b.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))), rand(0.8, 1.6));
      ctx.audio.explosion(box.pos, 1);
    }
    if (t > 3.2 && !this.finalBoom) {
      this.finalBoom = true;
      fx.explosion(this.boxes[0].pos, 3.2);
      fx.explosion(this.boxFor('body').pos, 3.5);
      ctx.audio.partBreak(this.boxFor('body').pos);
      ctx.world.skyUniforms.uFlash.value = 0.6;
      fx.addShake(1.2);
    }
    if (t > 3.3 && Math.random() < 0.3) { const box = this.boxes[Math.floor(Math.random() * 12)]; fx.smoke.spawn(box.pos.x, box.pos.y, box.pos.z, rand(-0.3, 0.3), rand(1, 2), rand(-0.3, 0.3), 0.1, 0.1, 0.1, 1.2, 5, 4, 0.5, 0.6, -0.5); }
    // 腿软下去，身体趴到地上，头垂下
    const k = easeInOutSine(clamp((t - 0.6) / 2.4, 0, 1));
    const ground = world.heightAt(this.pos.x, this.pos.z);
    b.position.set(this.pos.x, ground + lerp(DRAGON.bodyH, 1.55, k) + Math.sin(t * 20) * 0.03 * (1 - k), this.pos.z);
    b.rotation.y = this.yaw;
    b.rotation.x = damp(b.rotation.x, 0.12 * k, 4, dt);
    b.rotation.z = damp(b.rotation.z, 0.18 * k, 3, dt);
    this.headRaise = lerp(0, -0.9, k);
    this.jawTarget = 0.5;
    for (const L of this.legs) {
      L.override = null;
      // 脚往外滑，腿趴开
      this.bodyLocalToWorldFlat(_c.set(L.x * (1.17 + k * 0.5), 0, L.z + (L.front ? 0.45 + k * 0.8 : 0.05 - k * 0.6)), _d);
      L.cur.lerp(_d, 1 - Math.exp(-3 * dt));
      L.cur.y = world.heightAt(L.cur.x, L.cur.z);
    }
    this.m.rings.forEach((r) => r.material.color.lerp(DEAD_DIM, 1 - Math.exp(-2 * dt)));
    this.m.core.material.color.lerp(DEAD_DIM, 1 - Math.exp(-2 * dt));
    this.m.mouthLight.intensity = 0;
  }
}
