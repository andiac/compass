// 场景：起雾的阴天高地草原（照 kitty_drama 的 S1–S5 场景图），一直刮大风，草一直往一边倒
import * as THREE from 'three';
import { Noise2D, Noise3D, mulberry32, smoothstep, clamp, rayEllipsoid } from './util.js';
import { makeMistTexture } from './materials.js';

export const ARENA_RADIUS = 92;
const SKY = {
  top: new THREE.Color('#5f6c76'),
  horizon: new THREE.Color('#a5aeb3'),
  bottom: new THREE.Color('#7d8784'),
  cloudLight: new THREE.Color('#c6ccd0'),
  cloudDark: new THREE.Color('#4c5760'),
};

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFrag = /* glsl */`
uniform float uTime; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform vec3 uCloudLight; uniform vec3 uCloudDark; uniform vec2 uWind; uniform float uFlash;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
  col = mix(col, uBottom, smoothstep(0.02, -0.25, h));
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.16);
    vec2 w = uWind * uTime * 0.014;
    float n = fbm(uv * 1.2 + w);
    float n2 = fbm(uv * 2.9 - w * 1.6 + 4.0);
    float c = smoothstep(0.38, 0.72, n * 0.72 + n2 * 0.38);
    vec3 cc = mix(uCloudLight, uCloudDark, smoothstep(0.42, 0.82, n2));
    col = mix(col, cc, c * smoothstep(0.0, 0.2, h) * 0.9);
  }
  col += vec3(0.25, 1.0, 0.5) * uFlash * 0.25;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.noise = new Noise2D(1337);
    this.noise3 = new Noise3D(4242);
    this.windDir = new THREE.Vector2(0.26, -1).normalize(); // 风从巨龙那边（+Z）吹向奇魔猪的出生点
    this.windStrength = 1.0;
    this.gustBoost = 0;
    this.time = 0;
    this.rocks = [];
    this.raycaster = new THREE.Raycaster();
    this.scene.fog = new THREE.FogExp2(SKY.horizon.clone(), 0.0105);
    this.baseFog = 0.0105;
    this.buildSky();
    this.buildTerrain();
    this.buildHeightTexture();
    this.buildRocks();
    this.buildLights();
    this.buildMist();
    this.buildStreaks();
    this.grassUniforms = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 30 },
      uWind: { value: this.windDir.clone() }, uWindStrength: { value: 1 }, uGust: { value: 0 },
      uHeight: { value: this.heightTex }, uHeightInfo: { value: new THREE.Vector4(this.hMin, this.hMin, this.hSize, 0) },
      uPushers: { value: Array.from({ length: 6 }, () => new THREE.Vector3(9999, 9999, 0.1)) },
    };
  }

  // ---------- 地形 ----------
  heightAt(x, z) {
    const n = this.noise;
    const r = Math.sqrt(x * x + z * z);
    let h = n.fbm(x * 0.011, z * 0.011, 4) * 5.0 + n.noise(x * 0.045 + 3.1, z * 0.045 - 1.7) * 0.6;
    const arena = smoothstep(62, 140, r);
    h *= 0.32 + 0.68 * arena;
    h += arena * arena * (17 + 11 * n.fbm(x * 0.005 + 9.3, z * 0.005 - 3.1, 3));
    return h;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
  // 含岩石顶面的地面高度
  groundAt(x, z) {
    let h = this.heightAt(x, z);
    for (const r of this.rocks) {
      const dx = x - r.x, dz = z - r.z;
      if (dx * dx + dz * dz > r.bound * r.bound) continue;
      this.raycaster.ray.origin.set(x, r.y + r.ry * 2 + 5, z);
      this.raycaster.ray.direction.set(0, -1, 0);
      this.raycaster.far = r.ry * 4 + 10;
      const hit = this.raycaster.intersectObject(r.mesh, false)[0];
      if (hit && hit.point.y > h) h = hit.point.y;
    }
    return h;
  }
  // 射线和地形/岩石的第一个交点距离（没有则 Infinity）
  raycast(origin, dir, maxDist = 200, withRocks = true) {
    let best = Infinity;
    if (withRocks) for (const r of this.rocks) {
      const t = rayEllipsoid(origin, dir, r.center, r.r * 0.92, r.ry * 0.92);
      if (t < best) best = t;
    }
    const step = 1.0;
    let prevT = 0, prevD = origin.y - this.heightAt(origin.x, origin.z);
    if (prevD < 0) return 0;
    const lim = Math.min(maxDist, best);
    for (let t = step; t <= lim + step; t += step) {
      const tt = Math.min(t, lim);
      const x = origin.x + dir.x * tt, y = origin.y + dir.y * tt, z = origin.z + dir.z * tt;
      const d = y - this.heightAt(x, z);
      if (d < 0) {
        let a = prevT, b = tt;
        for (let i = 0; i < 6; i++) {
          const m = (a + b) / 2;
          const dm = origin.y + dir.y * m - this.heightAt(origin.x + dir.x * m, origin.z + dir.z * m);
          if (dm < 0) b = m; else a = m;
        }
        return Math.min(best, (a + b) / 2);
      }
      prevT = tt; prevD = d;
      if (tt >= lim) break;
    }
    return best <= maxDist ? best : Infinity;
  }
  // 点是否在岩石里（投射物用）
  insideRock(p, pad = 0) {
    for (const r of this.rocks) {
      const dx = (p.x - r.center.x) / (r.r * 0.92 + pad), dy = (p.y - r.center.y) / (r.ry * 0.92 + pad), dz = (p.z - r.center.z) / (r.r * 0.92 + pad);
      if (dx * dx + dy * dy + dz * dz < 1) return r;
    }
    return null;
  }

  buildTerrain() {
    const SIZE = 900, SEG = 300;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const half = SIZE / 2;
    const remap = (v) => Math.sign(v) * Math.pow(Math.abs(v) / half, 1.9) * half; // 中间密、外面疏
    for (let i = 0; i < pos.count; i++) {
      const x = remap(pos.getX(i)), z = remap(pos.getZ(i));
      pos.setXYZ(i, x, this.heightAt(x, z), z);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const uvs = new Float32Array(pos.count * 2);
    const cDark = new THREE.Color('#2b4220'), cMid = new THREE.Color('#41602a'), cLight = new THREE.Color('#62803a');
    const cDry = new THREE.Color('#6f7448'), cRock = new THREE.Color('#6b6c64'), c = new THREE.Color();
    const n = this.noise;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n1 = n.fbm(x * 0.05 + 11, z * 0.05 - 7, 3), n2 = n.fbm(x * 0.017 - 5, z * 0.017 + 2, 3);
      c.copy(cDark).lerp(cMid, clamp(0.55 + n1 * 0.9, 0, 1));
      c.lerp(cLight, smoothstep(0.1, 0.55, n2));
      c.lerp(cDry, smoothstep(0.35, 0.7, n.noise(x * 0.03 + 40, z * 0.03)) * 0.5);
      const slope = 1 - nor.getY(i);
      c.lerp(cRock, smoothstep(0.12, 0.3, slope) * 0.85);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      uvs[i * 2] = x / 7; uvs[i * 2 + 1] = z / 7;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    // 细节贴图：草根和泥土的斑驳
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, 256, 256);
    const rng = mulberry32(17);
    for (let i = 0; i < 2600; i++) {
      const v = 120 + rng() * 135 | 0;
      g.fillStyle = `rgba(${v},${v},${(v * 0.9) | 0},0.5)`;
      g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 4, 1 + rng() * 8);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.96, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  buildHeightTexture() {
    const N = 384;
    this.hMin = -165; this.hSize = 330;
    const data = new Uint16Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = this.hMin + ((i + 0.5) / N) * this.hSize, z = this.hMin + ((j + 0.5) / N) * this.hSize;
      data[j * N + i] = THREE.DataUtils.toHalfFloat(this.heightAt(x, z));
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTex = tex;
  }

  // ---------- 风吹的草：围着镜头焦点循环摆放的实例化草丛 ----------
  buildGrass(q) {
    if (this.grass) {
      this.scene.remove(this.grass);
      this.grass.geometry.dispose(); this.grass.material.dispose();
      this.grass = null;
    }
    const R = q.grassRadius, density = q.grassDensity;
    this.grassUniforms.uRadius.value = R;
    const rng = mulberry32(99);
    // 一丛 5 片草叶
    const pos = [], nor = [], col = [], uv = [], idx = [];
    const levels = [0, 0.32, 0.62, 0.86, 1.0], widths = [0.055, 0.047, 0.032, 0.014, 0.0];
    const cBase = new THREE.Color('#1d3213'), cTip = new THREE.Color('#7e9a46'), c = new THREE.Color();
    for (let b = 0; b < 5; b++) {
      const a = rng() * Math.PI * 2, r = rng() * 0.2;
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      const yaw = rng() * Math.PI * 2, cx = Math.cos(yaw), sx = Math.sin(yaw);
      const h = 0.38 + rng() * 0.32, lean = 0.05 + rng() * 0.12, la = rng() * Math.PI * 2;
      const tint = 0.8 + rng() * 0.35;
      const start = pos.length / 3;
      for (let k = 0; k < levels.length; k++) {
        const t = levels[k], w = widths[k] * (0.85 + rng() * 0.3);
        const bend = lean * t * t;
        const bx = ox + Math.cos(la) * bend, bz = oz + Math.sin(la) * bend, by = t * h;
        const sides = w > 0 ? [-1, 1] : [0];
        for (const s of sides) {
          pos.push(bx + cx * w * s, by, bz + sx * w * s);
          nor.push(-sx * 0.35, 1, cx * 0.35);
          c.copy(cBase).lerp(cTip, Math.pow(t, 0.8)).multiplyScalar(tint);
          col.push(c.r, c.g, c.b);
          uv.push(s * 0.5 + 0.5, t);
        }
      }
      // 三角形：4 层两两相连，最后一层是尖端
      for (let k = 0; k < 3; k++) {
        const i0 = start + k * 2;
        idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
      }
      const tip = start + 8;
      idx.push(start + 6, start + 7, tip);
    }
    const base = new THREE.BufferGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    base.dispose();
    const cell = Math.sqrt(1 / density);
    const cells = Math.ceil((2 * R) / cell);
    const count = cells * cells;
    const offsets = new Float32Array(count * 4), tints = new Float32Array(count * 3);
    let k = 0;
    const n = this.noise;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const x = -R + (i + rng()) * cell, z = -R + (j + rng()) * cell;
      const patch = n.fbm(x * 0.09 + 3, z * 0.09 - 8, 2);
      offsets[k * 4] = x; offsets[k * 4 + 1] = z; offsets[k * 4 + 2] = rng() * Math.PI * 2;
      offsets[k * 4 + 3] = clamp(0.75 + patch * 0.6 + rng() * 0.35, 0.45, 1.5);
      const tv = 0.85 + rng() * 0.25;
      tints[k * 3] = tv * (0.95 + patch * 0.15); tints[k * 3 + 1] = tv; tints[k * 3 + 2] = tv * (0.9 - patch * 0.1);
      k++;
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    geo.instanceCount = count;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.grassUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
          attribute vec4 aOffset; attribute vec3 aTint;
          uniform float uTime; uniform vec3 uCenter; uniform float uRadius; uniform vec2 uWind; uniform float uWindStrength; uniform float uGust;
          uniform sampler2D uHeight; uniform vec4 uHeightInfo; uniform vec3 uPushers[6];`)
        .replace('#include <begin_vertex>', /* glsl */`
          vec2 rel = mod(aOffset.xy - uCenter.xz + uRadius, 2.0 * uRadius) - uRadius;
          vec2 wp = uCenter.xz + rel;
          float fade = 1.0 - smoothstep(uRadius * 0.7, uRadius, length(rel));
          float sc = aOffset.w * fade;
          float cs = cos(aOffset.z), sn = sin(aOffset.z);
          vec3 lp = position * vec3(0.8 + 0.2 * sc, sc, 0.8 + 0.2 * sc);
          lp.xz = mat2(cs, -sn, sn, cs) * lp.xz;
          float hf = uv.y;
          float ph = uTime * 1.7 + wp.x * 0.11 + wp.y * 0.07;
          float gust = 0.6 + 0.28 * sin(ph) + 0.14 * sin(uTime * 3.9 + wp.x * 0.37 - wp.y * 0.23) + uGust;
          vec2 off = uWind * (uWindStrength * gust * hf * hf * 0.42 * sc);
          for (int i = 0; i < 6; i++) {
            vec2 d = wp - uPushers[i].xy; float dl = length(d); float pr = uPushers[i].z;
            if (dl < pr && dl > 0.001) off += (d / dl) * (1.0 - dl / pr) * hf * 0.45 * sc;
          }
          lp.xz += off;
          lp.y -= dot(off, off) * 0.9 * hf;
          float gh = texture2D(uHeight, (wp - uHeightInfo.xy) / uHeightInfo.z).r;
          vec3 transformed = vec3(wp.x + lp.x, gh + lp.y - 0.02, wp.y + lp.z);
          vColor.rgb *= aTint;
        `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
    };
    this.grass = new THREE.Mesh(geo, mat);
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = !!q.grassShadows;
    this.scene.add(this.grass);
  }

  setPusher(i, x, z, r) { const p = this.grassUniforms.uPushers.value[i]; p.set(x, z, r); }

  // ---------- 岩石：出生点的岩石高地 + 散落的掩体 ----------
  makeRockGeometry(r, ry, seed, detail, rough) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    const n3 = this.noise3;
    const sq = 0.85 + (seed % 7) * 0.05;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + rough * n3.fbm(x * 1.5 + seed, y * 1.5 - seed * 0.3, z * 1.5 + seed * 0.7, 4) + 0.05 * n3.noise(x * 6 + seed, y * 6, z * 6);
      let yy = y;
      if (yy > 0.55) yy = 0.55 + (yy - 0.55) * 0.55; // 顶部压平一点
      p.setXYZ(i, x * d * r, yy * d * ry, z * d * r * sq);
    }
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    const colors = new Float32Array(p.count * 3);
    const cA = new THREE.Color('#7a7a72'), cB = new THREE.Color('#58594f'), cMoss = new THREE.Color('#4c5e2b'), cLichen = new THREE.Color('#9a9a7e'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const v = n3.fbm(x * 0.6 + seed, y * 0.6, z * 0.6, 3);
      c.copy(cA).lerp(cB, clamp(0.5 + v * 1.2, 0, 1));
      const up = nor.getY(i);
      c.lerp(cMoss, smoothstep(0.45, 0.85, up) * clamp(0.6 + n3.noise(x * 0.9, y * 0.9 + 3, z * 0.9) * 0.8, 0, 1));
      if (n3.noise(x * 2.5 + 7, y * 2.5, z * 2.5) > 0.55) c.lerp(cLichen, 0.5);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }

  buildRocks() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: false });
    const defs = [{ x: -4, z: -31, r: 6.4, ry: 4.6, sink: 1.7, detail: 4, rough: 0.16 }];
    const rng = mulberry32(2024);
    const segA = new THREE.Vector2(-4, -31), segB = new THREE.Vector2(0, 16);
    let tries = 0;
    while (defs.length < 12 && tries++ < 400) {
      const a = rng() * Math.PI * 2, d = 20 + rng() * 64;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const p = new THREE.Vector2(x, z);
      // 离出生点到巨龙的连线远一点
      const ab = segB.clone().sub(segA), t = clamp(p.clone().sub(segA).dot(ab) / ab.lengthSq(), 0, 1);
      if (p.distanceTo(segA.clone().addScaledVector(ab, t)) < 11) continue;
      const r = 1.7 + rng() * 2.6;
      if (defs.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 7)) continue;
      defs.push({ x, z, r, ry: r * (0.7 + rng() * 0.45), sink: r * 0.35, detail: 3, rough: 0.24 });
    }
    // 远处丘陵上的装饰岩石（不参与碰撞）
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, d = 110 + rng() * 70;
      defs.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 4 + rng() * 7, ry: 3 + rng() * 5, sink: 2, detail: 2, rough: 0.3, deco: true });
    }
    defs.forEach((def, i) => {
      const geo = this.makeRockGeometry(def.r, def.ry, i * 13 + 5, def.detail, def.rough);
      const mesh = new THREE.Mesh(geo, mat);
      const gy = this.heightAt(def.x, def.z) - def.sink;
      mesh.position.set(def.x, gy, def.z);
      mesh.rotation.y = rng() * Math.PI * 2;
      mesh.castShadow = !def.deco; mesh.receiveShadow = true;
      this.scene.add(mesh);
      mesh.updateMatrixWorld(true);
      if (!def.deco) this.rocks.push({ x: def.x, z: def.z, y: gy, r: def.r, ry: def.ry, bound: def.r * 1.4, center: new THREE.Vector3(def.x, gy, def.z), mesh });
    });
    this.spawnRock = this.rocks[0];
  }

  // ---------- 天空、灯光、环境反射 ----------
  buildSky() {
    this.skyUniforms = {
      uTime: { value: 0 }, uTop: { value: SKY.top }, uHorizon: { value: SKY.horizon }, uBottom: { value: SKY.bottom },
      uCloudLight: { value: SKY.cloudLight }, uCloudDark: { value: SKY.cloudDark }, uWind: { value: new THREE.Vector2(0.26, -1).normalize() },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildLights() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight(0xc8d6e2, 0x4a5a3c, 1.35);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xe9eef2, 2.1);
    this.sunOffset = new THREE.Vector3(-34, 62, -22);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -42; cam.right = 42; cam.top = 42; cam.bottom = -42; cam.near = 1; cam.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
  }

  buildEnvironment(renderer) {
    // 用同一片阴天的天空做环境反射，让塑料和金属的高光跟场景一致
    const envScene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.skyUniforms, uTime: { value: 13 } }, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: 0x3a4a2c }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -6;
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.035);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 1.0;
    pmrem.dispose();
  }

  setShadowQuality(size) {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  // ---------- 雾和风 ----------
  buildMist() {
    const tex = makeMistTexture();
    this.mist = [];
    this.mistGroup = new THREE.Group();
    this.scene.add(this.mistGroup);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xd5dce0, transparent: true, opacity: 0, depthWrite: false, fog: true });
      const s = new THREE.Sprite(m);
      s.userData = { base: 0.07 + Math.random() * 0.1, size: 16 + Math.random() * 22, rise: Math.random() * 4 };
      s.scale.setScalar(s.userData.size);
      this.mistGroup.add(s);
      this.mist.push(s);
    }
    this.mistCount = 28;
    this._mistInit = false;
  }
  placeMist(s, focus, upwind) {
    const r = upwind ? 55 + Math.random() * 15 : Math.random() * 65;
    const a = upwind ? Math.atan2(-this.windDir.x, -this.windDir.y) + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
    // 注意：atan2 返回的角度对应 (sin, cos)
    const x = focus.x + Math.sin(a) * r, z = focus.z + Math.cos(a) * r;
    s.position.set(x, this.heightAt(x, z) + 1.5 + s.userData.rise, z);
  }

  buildStreaks() {
    const N = 90;
    this.streakData = [];
    const pos = new Float32Array(N * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false, fog: true });
    this.streaks = new THREE.LineSegments(geo, mat);
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);
    for (let i = 0; i < N; i++) this.streakData.push({ p: new THREE.Vector3(9999, 0, 0), len: 1.5 + Math.random() * 2.5, sp: 16 + Math.random() * 10, ph: Math.random() * 10 });
  }

  setMistCount(n) { this.mistCount = n; this.mist.forEach((s, i) => (s.visible = i < n)); }

  update(dt, focus, camera) {
    this.time += dt;
    const t = this.time;
    this.gustBoost = Math.max(0, this.gustBoost - dt * 0.9);
    const gust = 0.22 * Math.sin(t * 0.37) + 0.16 * Math.sin(t * 0.93 + 1.3) + this.gustBoost;
    const gu = this.grassUniforms;
    gu.uTime.value = t; gu.uCenter.value.copy(focus); gu.uGust.value = gust; gu.uWindStrength.value = this.windStrength;
    this.skyUniforms.uTime.value = t;
    this.skyUniforms.uFlash.value = Math.max(0, this.skyUniforms.uFlash.value - dt * 2.5);
    this.sky.position.copy(camera.position);
    // 阴影跟着焦点走，按阴影贴图的像素对齐，避免闪烁
    const snap = 84 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).add(this.sunOffset);

    // 雾团随风飘
    const wind3x = this.windDir.x, wind3z = this.windDir.y;
    for (let i = 0; i < this.mistCount; i++) {
      const s = this.mist[i];
      if (!this._mistInit) this.placeMist(s, focus, false);
      const sp = 3.2 * (1 + gust);
      s.position.x += wind3x * sp * dt; s.position.z += wind3z * sp * dt;
      const dx = s.position.x - focus.x, dz = s.position.z - focus.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 72) this.placeMist(s, focus, true);
      const camD = s.position.distanceTo(camera.position);
      s.material.opacity = s.userData.base * smoothstep(8, 26, camD) * (1 - smoothstep(55, 72, dist));
    }
    this._mistInit = true;

    // 风的细线
    const arr = this.streaks.geometry.attributes.position.array;
    const cp = camera.position;
    for (let i = 0; i < this.streakData.length; i++) {
      const s = this.streakData[i];
      const sp = s.sp * (1 + gust * 0.8);
      s.p.x += wind3x * sp * dt; s.p.z += wind3z * sp * dt;
      s.p.y += Math.sin(t * 2 + s.ph) * dt * 0.6;
      const dx = s.p.x - cp.x, dz = s.p.z - cp.z;
      if (Math.abs(dx) > 28 || Math.abs(dz) > 28 || s.p.y < this.heightAt(s.p.x, s.p.z) - 0.5) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 26;
        s.p.set(cp.x + Math.cos(a) * r - wind3x * 18, 0, cp.z + Math.sin(a) * r - wind3z * 18);
        s.p.y = this.heightAt(s.p.x, s.p.z) + 0.3 + Math.random() * 5;
      }
      arr[i * 6] = s.p.x; arr[i * 6 + 1] = s.p.y; arr[i * 6 + 2] = s.p.z;
      arr[i * 6 + 3] = s.p.x - wind3x * s.len; arr[i * 6 + 4] = s.p.y; arr[i * 6 + 5] = s.p.z - wind3z * s.len;
    }
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }
}
