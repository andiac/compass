// 投射物：奇魔猪的粉红光束弹和火箭弹、巨龙翅膀导弹舱的追踪导弹
import * as THREE from 'three';
import { segmentSphere, closestPointOnSegment, rand, clamp } from './util.js';
import { glowMaterial } from './materials.js';

const Z = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
export const PINK = new THREE.Color(3.2, 0.7, 2.0);
const PINK_SPARK = { r: 3.0, g: 1.0, b: 2.2 };

export class Projectiles {
  constructor(ctx) {
    this.ctx = ctx;
    this.bolts = []; this.rockets = []; this.missiles = [];
    this.pools = { bolt: [], rocket: [], missile: [] };
    // 光束步枪：一次一发短短的粉红光弹（白芯 + 粉红光晕）
    this.boltCoreGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8).rotateX(Math.PI / 2);
    this.boltGlowGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.7, 8).rotateX(Math.PI / 2);
    this.boltCoreMat = glowMaterial(4.5, 2.2, 3.6, 1);
    this.boltGlowMat = glowMaterial(2.4, 0.25, 1.3, 0.5);
    // 导弹
    this.missileBodyGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.62, 10).rotateX(Math.PI / 2);
    this.missileNoseGeo = new THREE.ConeGeometry(0.1, 0.24, 10).rotateX(Math.PI / 2).translate(0, 0, 0.43);
    this.missileFinGeo = new THREE.BoxGeometry(0.02, 0.26, 0.16);
    this.missileMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.55, roughness: 0.4 });
    this.missileNoseMat = new THREE.MeshStandardMaterial({ color: 0x9a2a24, metalness: 0.3, roughness: 0.5 });
    this.exhaustMat = new THREE.SpriteMaterial({ map: ctx.effects.flashes[0].s.material.map, color: new THREE.Color(3.0, 1.5, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    // 火箭弹
    this.rocketGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.8, 12).rotateX(Math.PI / 2);
    this.rocketNoseGeo = new THREE.ConeGeometry(0.15, 0.3, 12).rotateX(Math.PI / 2).translate(0, 0, 0.55);
    this.rocketMat = new THREE.MeshStandardMaterial({ color: 0x55606c, metalness: 0.5, roughness: 0.45 });
    this.rocketExhaustMat = this.exhaustMat.clone(); this.rocketExhaustMat.color = new THREE.Color(1.5, 1.8, 3.2);
  }

  _get(kind) {
    const pool = this.pools[kind];
    if (pool.length) { const m = pool.pop(); m.visible = true; return m; }
    const g = new THREE.Group();
    if (kind === 'bolt') {
      g.add(new THREE.Mesh(this.boltCoreGeo, this.boltCoreMat), new THREE.Mesh(this.boltGlowGeo, this.boltGlowMat));
    } else if (kind === 'missile') {
      const b = new THREE.Mesh(this.missileBodyGeo, this.missileMat); b.castShadow = true;
      g.add(b, new THREE.Mesh(this.missileNoseGeo, this.missileNoseMat));
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(this.missileFinGeo, this.missileMat);
        const a = (i / 4) * Math.PI * 2;
        f.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.24); f.rotation.z = a; g.add(f);
      }
      const ex = new THREE.Sprite(this.exhaustMat); ex.position.z = -0.42; ex.scale.setScalar(0.7); g.add(ex);
      g.userData.ex = ex;
    } else {
      const b = new THREE.Mesh(this.rocketGeo, this.rocketMat); b.castShadow = true;
      g.add(b, new THREE.Mesh(this.rocketNoseGeo, this.rocketMat));
      const ex = new THREE.Sprite(this.rocketExhaustMat); ex.position.z = -0.5; ex.scale.setScalar(1.0); g.add(ex);
      g.userData.ex = ex;
    }
    this.ctx.scene.add(g);
    return g;
  }
  _put(kind, m) { m.visible = false; this.pools[kind].push(m); }

  // ---------- 奇魔猪 ----------
  fireBolt(origin, target, dmg = 55) {
    const dir = new THREE.Vector3().subVectors(target, origin).normalize();
    const mesh = this._get('bolt');
    mesh.position.copy(origin); mesh.quaternion.setFromUnitVectors(Z, dir);
    this.bolts.push({ pos: origin.clone(), prev: origin.clone(), dir, speed: 170, life: 1.0, dmg, mesh });
  }
  fireRocket(origin, dir) {
    const mesh = this._get('rocket');
    mesh.position.copy(origin); mesh.quaternion.setFromUnitVectors(Z, dir);
    this.rockets.push({ pos: origin.clone(), prev: origin.clone(), dir: dir.clone().normalize(), speed: 42, life: 3.2, mesh, smokeT: 0 });
  }

  // ---------- 巨龙 ----------
  launchMissile(origin, dir, opts = {}) {
    const mesh = this._get('missile');
    mesh.position.copy(origin);
    const m = {
      pos: origin.clone(), prev: origin.clone(), vel: dir.clone().normalize().multiplyScalar(opts.speed || 16),
      t: 0, life: opts.life || 6.5, boost: opts.boost || 0.45, turn: opts.turn || 2.6, maxSpeed: opts.maxSpeed || 31,
      dmg: opts.dmg || 80, mesh, smokeT: 0, hp: 1, wobble: rand(0, 10),
    };
    mesh.quaternion.setFromUnitVectors(Z, _a.copy(m.vel).normalize());
    this.missiles.push(m);
    return m;
  }

  // 在一条线段上找最近的命中（导弹 / 浮游炮 / 巨龙 / 岩石 / 地面）
  traceShot(p0, p1, radius, { hitMissiles = true } = {}) {
    const ctx = this.ctx;
    let best = null;
    const consider = (t, kind, obj, extra) => { if (t >= 0 && (!best || t < best.t)) best = { t, kind, obj, ...extra }; };
    if (hitMissiles) for (const m of this.missiles) consider(segmentSphere(p0, p1, m.pos, 0.6 + radius), 'missile', m);
    const fh = ctx.dragon.funnels.hitTestSegment(p0, p1, radius);
    if (fh) consider(fh.t, 'funnel', fh.funnel);
    const dh = ctx.dragon.hitTestSegment(p0, p1, radius);
    if (dh) consider(dh.t, 'dragon', null, { part: dh.part });
    const len = p0.distanceTo(p1);
    _d.subVectors(p1, p0).divideScalar(len || 1);
    const tw = ctx.world.raycast(p0, _d, len, true);
    if (tw <= len) consider(tw / (len || 1), 'world', null);
    if (best) best.point = new THREE.Vector3().lerpVectors(p0, p1, best.t);
    return best;
  }

  impactPink(point, normal) {
    const fx = this.ctx.effects;
    fx.sparks(point, normal, PINK_SPARK, 10, 8);
    fx.flash(point, PINK, 1.6, 0.12);
  }

  update(dt) {
    const ctx = this.ctx, fx = ctx.effects, world = ctx.world, dragon = ctx.dragon, player = ctx.player;

    // 光束弹
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.dir, b.speed * dt);
      b.life -= dt;
      b.mesh.position.copy(b.pos);
      const hit = this.traceShot(b.prev, b.pos, 0.08);
      if (hit) {
        _n.copy(b.dir).negate();
        this.impactPink(hit.point, _n);
        if (hit.kind === 'missile') this.destroyMissile(hit.obj, true);
        else if (hit.kind === 'funnel') dragon.funnels.damage(hit.obj, b.dmg, hit.point);
        else if (hit.kind === 'dragon') { dragon.damage(hit.part, b.dmg, hit.point, { source: 'rifle' }); ctx.audio.boltHit(hit.point); }
        else { fx.dust(hit.point, 3, 0.6); world.normalAt(hit.point.x, hit.point.z, _n); fx.scorch(hit.point, _n, 0.7, 5); }
        this._put('bolt', b.mesh); this.bolts.splice(i, 1);
        continue;
      }
      if (b.life <= 0) { this._put('bolt', b.mesh); this.bolts.splice(i, 1); }
    }

    // 火箭弹
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.prev.copy(r.pos);
      r.speed = Math.min(85, r.speed + 70 * dt);
      r.pos.addScaledVector(r.dir, r.speed * dt);
      r.life -= dt;
      r.mesh.position.copy(r.pos);
      r.mesh.userData.ex.scale.setScalar(0.9 + Math.random() * 0.5);
      r.smokeT -= dt;
      if (r.smokeT <= 0) {
        r.smokeT = 0.012;
        fx.smoke.spawn(r.pos.x - r.dir.x * 0.6, r.pos.y - r.dir.y * 0.6, r.pos.z - r.dir.z * 0.6, rand(-0.3, 0.3), rand(-0.1, 0.4), rand(-0.3, 0.3), 0.78, 0.78, 0.8, 0.4, 2.0, 1.6, 0.55, 1.2, -0.4);
      }
      const hit = this.traceShot(r.prev, r.pos, 0.2);
      if (hit || r.life <= 0) {
        const p = hit ? hit.point : r.pos;
        this.rocketExplode(p, hit);
        this._put('rocket', r.mesh); this.rockets.splice(i, 1);
      }
    }

    // 导弹
    _c.copy(player.pos); _c.y += 1.0;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.t += dt; m.prev.copy(m.pos);
      const speed = m.vel.length();
      _a.copy(m.vel).divideScalar(speed || 1);
      if (m.t < m.boost) {
        m.vel.multiplyScalar(Math.exp(-1.2 * dt));
      } else {
        _b.subVectors(_c, m.pos).normalize();
        // 一点点摆动，让一群导弹的路线错开
        _b.x += Math.sin(m.t * 3 + m.wobble) * 0.08; _b.y += Math.cos(m.t * 2.3 + m.wobble) * 0.06; _b.normalize();
        // 冲过头（目标已经在身后、离得很近）就丢失锁定，直线飞走
        if (!m.lost && _d.subVectors(_c, m.pos).dot(_a) < 0 && _d.length() < 7) m.lost = true;
        const ang = _a.angleTo(_b);
        const maxTurn = m.lost ? 0 : m.turn * dt * (m.t > 3.4 ? 0.2 : 1);
        if (ang > 1e-4) _a.lerp(_b, Math.min(1, maxTurn / ang)).normalize();
        const sp = Math.min(m.maxSpeed, speed + 36 * dt);
        m.vel.copy(_a).multiplyScalar(sp);
      }
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(Z, _a);
      m.mesh.userData.ex.scale.setScalar(0.5 + Math.random() * 0.4);
      m.smokeT -= dt;
      if (m.smokeT <= 0) {
        m.smokeT = 0.018;
        fx.smoke.spawn(m.pos.x - _a.x * 0.45, m.pos.y - _a.y * 0.45, m.pos.z - _a.z * 0.45, rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2), 0.82, 0.82, 0.84, 0.28, 1.5, 1.5, 0.5, 1.0, -0.3);
      }
      // 打中奇魔猪？
      player.capsule(_a, _b);
      closestPointOnSegment(m.pos, _a, _b, _d);
      const dist = _d.distanceTo(m.pos);
      let boom = false;
      if (dist < player.radius + 0.25 && player.alive) {
        player.takeDamage(m.dmg, m.pos, { type: 'missile', knock: 7, blockable: true });
        boom = true;
      } else if (m.t > m.life || m.pos.y < world.heightAt(m.pos.x, m.pos.z) + 0.1 || world.insideRock(m.pos)) {
        boom = true;
        if (dist < 2.6 && player.alive) player.takeDamage(m.dmg * 0.4, m.pos, { type: 'splash', knock: 4, blockable: true });
      }
      if (boom) this.destroyMissile(m, false);
    }
  }

  destroyMissile(m, shotDown) {
    const i = this.missiles.indexOf(m);
    if (i < 0) return;
    this.missiles.splice(i, 1);
    this._put('missile', m.mesh);
    const fx = this.ctx.effects;
    fx.explosion(m.pos, shotDown ? 0.65 : 0.85);
    this.ctx.audio.explosion(m.pos, 0.6);
    const g = this.ctx.world.heightAt(m.pos.x, m.pos.z);
    if (m.pos.y - g < 1.2) { fx.scorch(_n.set(m.pos.x, g, m.pos.z), this.ctx.world.normalAt(m.pos.x, m.pos.z, _b), 2.2); fx.debris(_n, 8, 5); }
    if (shotDown) this.ctx.hud.hitMarker(false);
  }

  rocketExplode(p, hit) {
    const ctx = this.ctx, fx = ctx.effects;
    fx.explosion(p, 1.5);
    ctx.audio.explosion(p, 1.3);
    const R = 3.8;
    // 直接命中
    if (hit && hit.kind === 'dragon') ctx.dragon.damage(hit.part, 380, p, { source: 'bazooka', poise: 2.2 });
    else ctx.dragon.splashDamage(p, R, 160, 'bazooka');
    for (const m of [...this.missiles]) if (m.pos.distanceTo(p) < R) this.destroyMissile(m, true);
    ctx.dragon.funnels.splash(p, R, 200);
    if (hit && hit.kind === 'funnel') ctx.dragon.funnels.damage(hit.obj, 300, p);
    const g = ctx.world.heightAt(p.x, p.z);
    if (p.y - g < 1.5) { fx.scorch(_n.set(p.x, g, p.z), ctx.world.normalAt(p.x, p.z, _b), 3.5); fx.debris(_n, 16, 7); }
  }

  clear() {
    for (const b of this.bolts) this._put('bolt', b.mesh);
    for (const r of this.rockets) this._put('rocket', r.mesh);
    for (const m of this.missiles) this._put('missile', m.mesh);
    this.bolts.length = 0; this.rockets.length = 0; this.missiles.length = 0;
  }
}
