// 浮游炮：平时停靠在背上像龙的背鳍；开火时全部脱离机体。
// 照你对《小猫骑士》浮游炮的意见：和目标保持距离、远近高低不规则地散开（不排成一圈）、
// 轮流开火（一门开火、停一下、再换一门），每一炮之前有瞄准线，留出闪避的空当。
import * as THREE from 'three';
import { rand, clamp, segmentSphere, segmentSegmentDistance, closestPointOnSegment } from './util.js';
import { glowMaterial } from './materials.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const TIP_IDLE = new THREE.Color(0.3, 2.2, 0.9);
const GREEN_SPARK = { r: 0.6, g: 3.0, b: 1.2 };

export class Funnels {
  constructor(ctx, model) {
    this.ctx = ctx;
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2); // 沿 +Z 从 0 到 1
    this.list = model.funnelMeshes.map((fm, i) => {
      const tele = new THREE.Mesh(beamGeo, glowMaterial(0.25, 1.6, 0.7, 0.0));
      const core = new THREE.Mesh(beamGeo, glowMaterial(2.6, 4.5, 3.0, 1.0));
      const glow = new THREE.Mesh(beamGeo, glowMaterial(0.3, 2.4, 1.0, 0.55));
      for (const m of [tele, core, glow]) { m.visible = false; m.frustumCulled = false; ctx.scene.add(m); }
      return {
        i, group: fm.group, tip: fm.tip, tipMat: fm.tipMat, jet: fm.jet, muzzle: fm.muzzle, slot: fm.slot,
        state: 'docked', hp: 110, alive: true, t: 0,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), anchor: new THREE.Vector3(), anchorT: 0, wob: rand(0, 10),
        shot: null, aimPoint: new THREE.Vector3(), aimDir: new THREE.Vector3(), beamLen: 0,
        tele, core, glow, spin: 0,
      };
    });
    this.deployed = false;
    this.timer = 0;
    this.nextShot = 0;
    this.rate = 1;
  }

  get aliveCount() { return this.list.filter((f) => f.alive).length; }
  get dockedCount() { return this.list.filter((f) => f.alive && f.state === 'docked').length; }
  get active() { return this.list.some((f) => f.alive && f.state !== 'docked'); }

  deploy(duration = 14) {
    const ctx = this.ctx;
    let k = 0;
    for (const f of this.list) {
      if (!f.alive || f.state !== 'docked') continue;
      f.state = 'launch'; f.t = -k * 0.07; k++;
      f.slot.getWorldQuaternion(_q);
      f.vel.set(0, 0, 1).applyQuaternion(_q).multiplyScalar(13);
      f.vel.y += 5;
      f.anchorT = 0;
      f.shot = null;
    }
    this.deployed = k > 0;
    this.timer = duration;
    this.nextShot = 1.4;
    return k;
  }

  recall() {
    this.deployed = false;
    for (const f of this.list) if (f.alive && (f.state === 'hover' || f.state === 'launch')) { f.state = 'return'; this.endShot(f); }
  }

  pickAnchor(f) {
    // 远近、高低都不一样：半径 8~19，高度 1.5~10，角度随机（不排成一圈）
    const p = this.ctx.player;
    const a = rand(0, Math.PI * 2);
    const r = rand(8, 19);
    f.anchor.set(Math.sin(a) * r, rand(1.5, 10), Math.cos(a) * r);
    // 别落到奇魔猪和巨龙之间正中的那条线上挡住视线太久：稍微偏一点
    f.anchorT = rand(2.2, 4.6);
    void p;
  }

  startShot(f) {
    const p = this.ctx.player;
    f.shot = { phase: 'aim', t: 0 };
    p.capsule(_a, _b);
    f.aimPoint.lerpVectors(_a, _b, 0.5);
    this.ctx.audio.funnelCharge(f.pos);
  }
  endShot(f) {
    f.shot = null;
    f.tele.visible = false; f.core.visible = false; f.glow.visible = false;
  }

  update(dt, phase = 1) {
    const ctx = this.ctx, p = ctx.player, fx = ctx.effects, world = ctx.world;
    if (this.deployed) {
      this.timer -= dt;
      if (this.timer <= 0) this.recall();
      this.nextShot -= dt;
      if (this.nextShot <= 0 && p.alive) {
        const cands = this.list.filter((f) => f.alive && f.state === 'hover' && !f.shot && f.t > 0.5);
        if (cands.length) {
          const f = cands[Math.floor(Math.random() * cands.length)];
          this.startShot(f);
          const base = phase >= 3 ? rand(0.4, 0.7) : rand(0.6, 1.05);
          this.nextShot = base / this.rate;
          if (phase >= 2 && Math.random() < 0.18) this.nextShot = 0.28;
        } else this.nextShot = 0.2;
      }
    }
    for (const f of this.list) {
      if (f.state === 'docked') continue;
      f.t += dt;
      if (f.state === 'launch') {
        if (f.t < 0) continue;
        if (f.group.parent !== ctx.scene) {
          ctx.scene.attach(f.group);
          f.pos.copy(f.group.position);
          ctx.audio.funnelLaunch(f.pos);
          fx.flash(f.pos, new THREE.Color(0.4, 2.2, 1.0), 1.2, 0.15);
        }
        f.vel.multiplyScalar(Math.exp(-1.6 * dt));
        f.pos.addScaledVector(f.vel, dt);
        f.jet.material.opacity = 0.85;
        if (f.t > 0.6) { f.state = 'hover'; f.t = 0; this.pickAnchor(f); }
      } else if (f.state === 'hover') {
        f.anchorT -= dt;
        if (f.anchorT <= 0 && !f.shot) this.pickAnchor(f);
        _a.copy(p.pos).add(f.anchor);
        _a.y = Math.max(_a.y, world.heightAt(_a.x, _a.z) + 1.5);
        _a.x += Math.sin(f.t * 1.3 + f.wob) * 0.8; _a.y += Math.sin(f.t * 1.9 + f.wob * 2) * 0.5; _a.z += Math.cos(f.t * 1.1 + f.wob) * 0.8;
        // 弹簧阻尼移动；瞄准和开火时慢下来
        const k = f.shot ? 1.2 : 5.0, c = f.shot ? 4.0 : 3.2;
        _b.subVectors(_a, f.pos).multiplyScalar(k).addScaledVector(f.vel, -c);
        f.vel.addScaledVector(_b, dt);
        const sp = f.vel.length();
        if (sp > 24) f.vel.multiplyScalar(24 / sp);
        f.pos.addScaledVector(f.vel, dt);
        f.jet.material.opacity = 0.35 + Math.min(0.6, sp / 24);
      } else if (f.state === 'return') {
        f.slot.getWorldPosition(_a);
        _b.subVectors(_a, f.pos);
        const d = _b.length();
        const sp = Math.min(26, 4 + d * 3);
        f.pos.addScaledVector(_b.normalize(), Math.min(d, sp * dt));
        f.jet.material.opacity = 0.8;
        if (d < 0.35) {
          f.slot.attach(f.group);
          f.state = 'dock';
          f.t = 0;
          continue;
        }
      } else if (f.state === 'dock') {
        // 回到停靠位
        const k = 1 - Math.exp(-10 * dt);
        f.group.position.lerp(_a.set(0, 0, 0), k);
        f.group.quaternion.slerp(_q.identity(), k);
        f.jet.material.opacity *= 0.9;
        if (f.t > 0.5) { f.group.position.set(0, 0, 0); f.group.quaternion.identity(); f.state = 'docked'; f.jet.material.opacity = 0; }
        continue;
      } else if (f.state === 'dead') {
        f.vel.y -= 18 * dt;
        f.pos.addScaledVector(f.vel, dt);
        f.spin += dt * 9;
        f.group.rotation.set(f.spin, f.spin * 0.7, 0);
        f.group.position.copy(f.pos);
        if (Math.random() < 0.6) fx.smoke.spawn(f.pos.x, f.pos.y, f.pos.z, 0, 0.5, 0, 0.15, 0.15, 0.15, 0.4, 1.6, 1.2, 0.6, 1, -0.3);
        if (f.pos.y < world.heightAt(f.pos.x, f.pos.z) + 0.2 || f.t > 4) {
          fx.explosion(f.pos, 0.6);
          ctx.audio.explosion(f.pos, 0.5);
          f.group.visible = false;
          f.state = 'gone';
        }
        continue;
      } else continue;

      f.group.position.copy(f.pos);
      // 朝向：开火时炮口（尖端）对准瞄准点，其余时候大致朝着奇魔猪
      if (f.shot) {
        _c.subVectors(f.aimPoint, f.pos).normalize();
      } else {
        p.capsule(_c, _d); _c.lerp(_d, 0.5).sub(f.pos).normalize();
        _c.lerp(_d.copy(f.vel).normalize(), Math.min(0.5, f.vel.length() / 40)).normalize();
      }
      _q.setFromUnitVectors(Z, _c);
      f.group.quaternion.slerp(_q, 1 - Math.exp(-(f.shot ? 18 : 6) * dt));

      // 开火流程：瞄准线 → 细光束 → 冷却
      if (f.shot) {
        const s = f.shot;
        s.t += dt;
        f.muzzle.getWorldPosition(_a);
        if (s.phase === 'aim') {
          if (s.t < 0.3) { p.capsule(_b, _d); f.aimPoint.lerp(_b.lerp(_d, 0.5), 1 - Math.exp(-8 * dt)); }
          f.aimDir.subVectors(f.aimPoint, _a).normalize();
          const len = Math.min(70, world.raycast(_a, f.aimDir, 70, true));
          this.placeBeam(f.tele, _a, f.aimDir, len, 0.025);
          f.tele.visible = true;
          f.tele.material.opacity = 0.12 + 0.5 * (s.t / 0.5);
          f.tipMat.color.copy(TIP_IDLE).multiplyScalar(1 + s.t * 4 + Math.sin(s.t * 40) * 0.5);
          if (s.t >= 0.5) {
            s.phase = 'fire'; s.t = 0;
            f.tele.visible = false;
            f.beamLen = len;
            this.placeBeam(f.core, _a, f.aimDir, len, 0.055);
            this.placeBeam(f.glow, _a, f.aimDir, len, 0.15);
            f.core.visible = true; f.glow.visible = true;
            ctx.audio.funnelShot(_a);
            fx.flash(_a, new THREE.Color(0.6, 3, 1.3), 1.4, 0.12);
            const end = _b.copy(_a).addScaledVector(f.aimDir, len);
            if (len < 69) { fx.sparks(end, _c.copy(f.aimDir).negate(), GREEN_SPARK, 8, 7); fx.scorch(end, world.normalAt(end.x, end.z, _d), 0.9, 6); }
            // 命中判定
            p.capsule(_c, _d);
            const dist = segmentSegmentDistance(_a, end, _c, _d);
            if (dist < p.radius + 0.12 && p.alive) p.takeDamage(50, _a, { type: 'funnel', knock: 3, blockable: true });
          }
        } else if (s.phase === 'fire') {
          const k = 1 - s.t / 0.14;
          f.core.material.opacity = Math.max(0, k);
          f.glow.material.opacity = Math.max(0, k) * 0.55;
          if (s.t >= 0.14) { s.phase = 'cool'; s.t = 0; f.core.visible = false; f.glow.visible = false; }
        } else if (s.phase === 'cool') {
          f.tipMat.color.lerp(TIP_IDLE, 1 - Math.exp(-6 * dt));
          if (s.t > 0.45) { this.endShot(f); f.anchorT = Math.min(f.anchorT, rand(0.2, 0.8)); }
        }
      } else {
        f.tipMat.color.lerp(TIP_IDLE, 1 - Math.exp(-6 * dt));
      }
    }
  }

  placeBeam(mesh, from, dir, len, r) {
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(Z, dir);
    mesh.scale.set(r, r, Math.max(0.01, len));
  }

  hitTestSegment(p0, p1, r) {
    let best = null;
    for (const f of this.list) {
      if (!f.alive || f.state === 'docked' || f.state === 'dock' || f.state === 'dead' || f.state === 'gone') continue;
      const t = segmentSphere(p0, p1, f.pos, 0.75 + r);
      if (t >= 0 && (!best || t < best.t)) best = { t, funnel: f };
    }
    return best;
  }

  damage(f, amount, point) {
    if (!f.alive) return;
    f.hp -= amount;
    this.ctx.hud.hitMarker(false);
    if (f.hp <= 0) this.kill(f);
  }
  splash(p, R, dmg) {
    for (const f of this.list) {
      if (!f.alive || f.state === 'docked' || f.state === 'dock') continue;
      if (f.pos.distanceTo(p) < R) this.damage(f, dmg, f.pos);
    }
  }
  kill(f) {
    f.alive = false;
    this.endShot(f);
    if (f.group.parent !== this.ctx.scene) { this.ctx.scene.attach(f.group); f.pos.copy(f.group.position); }
    f.state = 'dead'; f.t = 0;
    f.vel.set(rand(-3, 3), rand(2, 6), rand(-3, 3));
    f.tipMat.color.setRGB(0.05, 0.05, 0.05);
    f.jet.material.opacity = 0;
    this.ctx.effects.explosion(f.pos, 0.55, { color: { r: 1.2, g: 2.8, b: 1.4 } });
    this.ctx.audio.explosion(f.pos, 0.5);
    this.ctx.dragon.onFunnelDestroyed(f);
  }

  // 最近的已展开浮游炮（锁定用）
  nearestTo(point, maxDist = 60) {
    let best = null, bd = maxDist;
    for (const f of this.list) {
      if (!f.alive || (f.state !== 'hover' && f.state !== 'launch')) continue;
      const d = f.pos.distanceTo(point);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  reset() {
    for (const f of this.list) {
      this.endShot(f);
      f.alive = true; f.hp = 110; f.state = 'docked'; f.t = 0;
      f.group.visible = true;
      if (f.group.parent !== f.slot) f.slot.add(f.group);
      f.group.position.set(0, 0, 0); f.group.quaternion.identity(); f.group.rotation.set(0, 0, 0);
      f.tipMat.color.copy(TIP_IDLE); f.jet.material.opacity = 0;
    }
    this.deployed = false;
  }
}
