// 特效：粒子池（火花、火球、烟、尘土）、闪光、灯光池、焦痕、冲击波、光束剑轨迹、震屏
import * as THREE from 'three';
import { makeSoftDotTexture, makeSmokeTexture, makeScorchTexture } from './materials.js';
import { rand, clamp } from './util.js';

const particleVert = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor; varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  vColor = aColor; vAlpha = aAlpha;
  #include <fog_vertex>
}`;
const particleFrag = /* glsl */`
uniform sampler2D uTex;
varying vec3 vColor; varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class ParticlePool {
  constructor(scene, max, { additive = false, texture, fog = false }) {
    this.max = max; this.count = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.col2 = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos); this.geo.setAttribute('aColor', this.aCol);
    this.geo.setAttribute('aSize', this.aSize); this.geo.setAttribute('aAlpha', this.aAlpha);
    this.geo.setDrawRange(0, 0);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null }, uScale: { value: 400 } }]);
    uniforms.uTex.value = texture;
    this.mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: particleVert, fragmentShader: particleFrag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, size0, size1, life, alpha = 1, drag = 1, grav = 0, r2 = r, g2 = g, b2 = b) {
    let i = this.count;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.count++;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.col2[i3] = r2; this.col2[i3 + 1] = g2; this.col2[i3 + 2] = b2;
    this.life[i] = life; this.age[i] = 0; this.size0[i] = size0; this.size1[i] = size1;
    this.alpha0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt, wind) {
    let n = this.count;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // 把最后一个挪过来
        n--;
        if (i !== n) this.copy(n, i);
        i--; continue;
      }
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i3] *= k; this.v[i3 + 1] = this.v[i3 + 1] * k - this.grav[i] * dt; this.v[i3 + 2] *= k;
      if (wind && this.grav[i] < 0) { this.v[i3] += wind.x * dt * 2.2; this.v[i3 + 2] += wind.y * dt * 2.2; }
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
    }
    this.count = n;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, t = this.age[i] / this.life[i];
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      C[i3] = this.col[i3] + (this.col2[i3] - this.col[i3]) * t;
      C[i3 + 1] = this.col[i3 + 1] + (this.col2[i3 + 1] - this.col[i3 + 1]) * t;
      C[i3 + 2] = this.col[i3 + 2] + (this.col2[i3 + 2] - this.col[i3 + 2]) * t;
      S[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      A[i] = this.alpha0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    this.geo.setDrawRange(0, n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }
  copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.p[t3 + k] = this.p[f3 + k]; this.v[t3 + k] = this.v[f3 + k];
      this.col[t3 + k] = this.col[f3 + k]; this.col2[t3 + k] = this.col2[f3 + k];
    }
    this.life[to] = this.life[from]; this.age[to] = this.age[from]; this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.alpha0[to] = this.alpha0[from]; this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
  }
  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

export class Effects {
  constructor(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;
    const dot = makeSoftDotTexture(64, 0.1);
    this.add = new ParticlePool(scene, 4000, { additive: true, texture: dot });
    this.smoke = new ParticlePool(scene, 3000, { additive: false, texture: makeSmokeTexture(), fog: true });
    this.shake = 0;
    this.hitStop = 0;

    // 闪光（贴图精灵）
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      this.flashes.push({ s, t: 0, life: 0.2, size: 1, color: new THREE.Color() });
    }
    // 灯光池：数量固定，避免着色器重新编译
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 16, 2); scene.add(l);
      this.lights.push({ l, t: 0, life: 0.2, peak: 0 });
    }
    // 焦痕
    this.decals = [];
    const scorchMat = new THREE.MeshBasicMaterial({ map: makeScorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0 });
    const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(dg, scorchMat.clone()); m.visible = false; m.renderOrder = 1; scene.add(m);
      this.decals.push({ m, t: 0, life: 10 });
    }
    this.decalIdx = 0;
    // 冲击波
    this.rings = [];
    const rg = new THREE.RingGeometry(0.85, 1, 48, 1); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const m = new THREE.Mesh(rg, mat); m.visible = false; scene.add(m);
      this.rings.push({ m, t: 0, life: 1, r0: 1, r1: 10 });
    }
    // 光束剑的轨迹带
    const TRAIL = 14;
    this.trailN = TRAIL;
    this.trailPts = [];
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TRAIL * 2), 1).setUsage(THREE.DynamicDrawUsage));
    const ti = [];
    for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; ti.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    tg.setIndex(ti);
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(2.6, 0.5, 1.6) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.trail = new THREE.Mesh(tg, this.trailMat);
    this.trail.frustumCulled = false; this.trail.visible = false;
    scene.add(this.trail);
    this.trailActive = false;
  }

  setPointScale(h) {
    this.add.mat.uniforms.uScale.value = h * 0.6;
    this.smoke.mat.uniforms.uScale.value = h * 0.6;
  }

  addShake(a) { this.shake = Math.min(1.6, this.shake + a); }

  flash(pos, color, size = 2, life = 0.18) {
    const f = this.flashes.find((x) => !x.s.visible) || this.flashes[Math.floor(Math.random() * this.flashes.length)];
    f.s.visible = true; f.s.position.copy(pos); f.t = 0; f.life = life; f.size = size;
    f.s.material.color.copy(color);
  }
  light(pos, color, peak = 40, life = 0.25, dist = 16) {
    const L = this.lights.reduce((a, b) => (b.t / b.life >= a.t / a.life ? b : a));
    L.l.position.copy(pos); L.l.color.copy(color); L.l.distance = dist; L.t = 0; L.life = life; L.peak = peak;
  }
  scorch(pos, normal, size = 2, life = 10) {
    const d = this.decals[this.decalIdx]; this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.m.visible = true; d.m.position.copy(pos).addScaledVector(normal, 0.04);
    d.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    d.m.rotateY(Math.random() * Math.PI * 2);
    d.m.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    d.t = 0; d.life = life;
  }
  ring(pos, r0, r1, life, color) {
    const R = this.rings.find((x) => !x.m.visible) || this.rings[0];
    R.m.visible = true; R.m.position.copy(pos); R.m.position.y += 0.15;
    R.t = 0; R.life = life; R.r0 = r0; R.r1 = r1;
    if (color) R.m.material.color.copy(color);
  }

  // ---------- 组合特效 ----------
  sparks(pos, dir, color, n = 12, speed = 10) {
    for (let i = 0; i < n; i++) {
      const vx = dir.x * speed * 0.6 + rand(-1, 1) * speed, vy = dir.y * speed * 0.6 + rand(-0.3, 1.2) * speed, vz = dir.z * speed * 0.6 + rand(-1, 1) * speed;
      this.add.spawn(pos.x, pos.y, pos.z, vx, vy, vz, color.r, color.g, color.b, rand(0.12, 0.25), 0.02, rand(0.2, 0.5), 1, 2.5, 14, color.r * 0.6, color.g * 0.3, color.b * 0.2);
    }
  }
  explosion(pos, scale = 1, opts = {}) {
    const c1 = opts.color || { r: 3.2, g: 1.6, b: 0.5 };
    for (let i = 0; i < 26 * scale; i++) {
      const s = rand(2, 7) * scale;
      const a = Math.random() * Math.PI * 2, e = rand(-0.4, 1);
      const vx = Math.cos(a) * s, vz = Math.sin(a) * s, vy = e * s;
      this.add.spawn(pos.x, pos.y, pos.z, vx, vy, vz, c1.r, c1.g, c1.b, rand(0.8, 1.6) * scale, rand(1.8, 3.2) * scale, rand(0.35, 0.7), 0.9, 3.5, -1, 0.9, 0.2, 0.05);
    }
    for (let i = 0; i < 14 * scale; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.5, 2.5) * scale;
      this.smoke.spawn(pos.x + rand(-0.5, 0.5) * scale, pos.y + rand(0, 0.6) * scale, pos.z + rand(-0.5, 0.5) * scale,
        Math.cos(a) * s, rand(0.8, 3) * scale, Math.sin(a) * s, 0.22, 0.21, 0.2, rand(1.2, 2) * scale, rand(4, 7) * scale, rand(1.6, 3.2), 0.6, 1.2, -0.6, 0.45, 0.45, 0.44);
    }
    this.sparks(pos, new THREE.Vector3(0, 1, 0), { r: 3, g: 1.8, b: 0.6 }, Math.round(14 * scale), 12 * Math.sqrt(scale));
    this.flash(pos, new THREE.Color(3, 1.6, 0.6), 6 * scale, 0.22);
    this.light(pos, new THREE.Color(1, 0.6, 0.25), 60 * scale, 0.35, 14 * Math.sqrt(scale) + 6);
    if (!opts.noShake) {
      const cam = this.ctx.camera.position;
      const d = cam.distanceTo(pos);
      this.addShake(clamp(0.5 * scale * (1 - d / 60), 0, 0.8));
    }
  }
  dust(pos, n = 10, size = 1.5, color = { r: 0.42, g: 0.38, b: 0.3 }) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1, 3.5);
      this.smoke.spawn(pos.x + rand(-0.4, 0.4), pos.y + 0.2, pos.z + rand(-0.4, 0.4), Math.cos(a) * s, rand(0.3, 1.6), Math.sin(a) * s,
        color.r, color.g, color.b, size * rand(0.6, 1.1), size * rand(2, 3.2), rand(0.8, 1.6), 0.55, 2.0, -0.2);
    }
  }
  debris(pos, n = 12, speed = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * speed;
      const g = Math.random() < 0.5;
      this.smoke.spawn(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * s, rand(0.6, 1.4) * speed, Math.sin(a) * s,
        g ? 0.12 : 0.2, g ? 0.2 : 0.15, g ? 0.06 : 0.1, rand(0.08, 0.2), 0.1, rand(0.6, 1.2), 1, 0.6, 18);
    }
  }

  startTrail() { this.trailActive = true; this.trailPts.length = 0; this.trail.visible = true; }
  pushTrail(base, tip) {
    this.trailPts.unshift({ a: base.clone(), b: tip.clone(), t: 0 });
    if (this.trailPts.length > this.trailN) this.trailPts.pop();
  }
  stopTrail() { this.trailActive = false; }

  update(dt, wind) {
    this.add.update(dt, null);
    this.smoke.update(dt, wind);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { f.s.visible = false; continue; }
      f.s.material.opacity = 1 - k;
      f.s.scale.setScalar(f.size * (0.6 + 0.6 * k));
    }
    for (const L of this.lights) {
      L.t += dt;
      const k = Math.min(1, L.t / L.life);
      L.l.intensity = L.peak * (1 - k) * (1 - k);
    }
    for (const d of this.decals) {
      if (!d.m.visible) continue;
      d.t += dt;
      const k = d.t / d.life;
      if (k >= 1) { d.m.visible = false; continue; }
      d.m.material.opacity = 0.85 * Math.min(1, d.t * 6) * (1 - Math.max(0, (k - 0.6) / 0.4));
    }
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.t += dt;
      const k = R.t / R.life;
      if (k >= 1) { R.m.visible = false; continue; }
      const r = R.r0 + (R.r1 - R.r0) * k;
      R.m.scale.set(r, 1, r);
      R.m.material.opacity = 0.8 * (1 - k);
    }
    // 轨迹
    if (this.trailPts.length) {
      for (const p of this.trailPts) p.t += dt;
      if (!this.trailActive) {
        while (this.trailPts.length && this.trailPts[this.trailPts.length - 1].t > 0.12) this.trailPts.pop();
      }
      const pos = this.trail.geometry.attributes.position.array, al = this.trail.geometry.attributes.alpha.array;
      const n = this.trailPts.length;
      for (let i = 0; i < this.trailN; i++) {
        const p = this.trailPts[Math.min(i, n - 1)];
        if (!p) break;
        pos[i * 6] = p.a.x; pos[i * 6 + 1] = p.a.y; pos[i * 6 + 2] = p.a.z;
        pos[i * 6 + 3] = p.b.x; pos[i * 6 + 4] = p.b.y; pos[i * 6 + 5] = p.b.z;
        const a = i < n ? (1 - i / this.trailN) * Math.max(0, 1 - p.t / 0.14) * 0.85 : 0;
        al[i * 2] = a * 0.15; al[i * 2 + 1] = a;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.alpha.needsUpdate = true;
      this.trail.visible = n > 1;
    } else this.trail.visible = false;
  }

  clear() {
    this.add.clear(); this.smoke.clear();
    for (const d of this.decals) d.m.visible = false;
    for (const f of this.flashes) f.s.visible = false;
    for (const R of this.rings) R.m.visible = false;
    for (const L of this.lights) { L.l.intensity = 0; L.t = L.life; }
    this.trailPts.length = 0;
  }
}
