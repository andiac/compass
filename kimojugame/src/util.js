// 通用数学工具、噪声、碰撞检测
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const approachAngle = (a, b, maxStep) => a + clamp(wrapAngle(b - a), -maxStep, maxStep);
export const approach = (a, b, maxStep) => a + clamp(b - a, -maxStep, maxStep);
// 朝向角：与模型约定一致，yaw = 0 时面朝 +Z
export const yawOf = (dx, dz) => Math.atan2(dx, dz);

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D Perlin 噪声（地形用）
export class Noise2D {
  constructor(seed = 1) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  static grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  }
  noise(x, y) {
    const fx = Math.floor(x), fy = Math.floor(y);
    const X = fx & 255, Y = fy & 255;
    x -= fx; y -= fy;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
    const p = this.perm, g = Noise2D.grad;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    return lerp(lerp(g(aa, x, y), g(ba, x - 1, y), u), lerp(g(ab, x, y - 1), g(bb, x - 1, y - 1), u), v);
  }
  fbm(x, y, oct = 4, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.noise(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
}

// 3D 值噪声（岩石形状用）
export class Noise3D {
  constructor(seed = 7) {
    const rng = mulberry32(seed);
    this.v = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) this.v[i] = rng() * 2 - 1;
  }
  h(x, y, z) { return this.v[((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 4095]; }
  noise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const h = (a, b, c) => this.h(xi + a, yi + b, zi + c);
    const x00 = lerp(h(0, 0, 0), h(1, 0, 0), u), x10 = lerp(h(0, 1, 0), h(1, 1, 0), u);
    const x01 = lerp(h(0, 0, 1), h(1, 0, 1), u), x11 = lerp(h(0, 1, 1), h(1, 1, 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }
  fbm(x, y, z, oct = 4) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.noise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
}

// ---------- 碰撞 ----------
const _d = new THREE.Vector3(), _m = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

// 线段 p0→p1 与球体的第一个交点参数 t∈[0,1]，没有交点返回 -1
export function segmentSphere(p0, p1, c, r) {
  _d.subVectors(p1, p0);
  _m.subVectors(p0, c);
  const a = _d.dot(_d);
  const b = _m.dot(_d);
  const cc = _m.dot(_m) - r * r;
  if (cc <= 0) return 0; // 起点就在球内
  if (a < 1e-9) return -1;
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

// 射线（原点 o，单位方向 dir）与竖直椭球（水平半径 r、竖直半径 ry）的最近交点距离，没有返回 Infinity
export function rayEllipsoid(o, dir, c, r, ry) {
  const k = r / ry;
  const ox = o.x - c.x, oy = (o.y - c.y) * k, oz = o.z - c.z;
  const dx = dir.x, dy = dir.y * k, dz = dir.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = ox * dx + oy * dy + oz * dz;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return 0;
  const disc = b * b - a * cc;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 ? t : Infinity;
}

// 点到线段的最近点
export function closestPointOnSegment(p, a, b, out) {
  _a.subVectors(b, a);
  const len2 = _a.lengthSq();
  let t = len2 > 1e-9 ? _b.subVectors(p, a).dot(_a) / len2 : 0;
  t = clamp(t, 0, 1);
  return out.copy(a).addScaledVector(_a, t);
}

// 两条线段之间的最近距离（胶囊体判定用）
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
export function segmentSegmentDistance(p1, q1, p2, q2) {
  _u.subVectors(q1, p1); _v.subVectors(q2, p2); _w.subVectors(p1, p2);
  const a = _u.dot(_u), b = _u.dot(_v), c = _v.dot(_v), d = _u.dot(_w), e = _v.dot(_w);
  const D = a * c - b * b;
  let sc, sN, sD = D, tc, tN, tD = D;
  if (D < 1e-8) { sN = 0; sD = 1; tN = e; tD = c; }
  else {
    sN = b * e - c * d; tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
  else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
  sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
  tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;
  const dx = _w.x + sc * _u.x - tc * _v.x, dy = _w.y + sc * _u.y - tc * _v.y, dz = _w.z + sc * _u.z - tc * _v.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 用三个基向量（x 右、y 上、z 前）设置朝向
const _mat = new THREE.Matrix4();
export function quatFromBasis(x, y, z, out) {
  _mat.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_mat);
}

// 让一个“骨骼”组从 from 指向 to：组的局部 -Y 指向骨骼方向，局部 +Z 尽量对齐 forwardHint
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
export function orientBone(obj, from, to, forwardHint) {
  _by.subVectors(from, to).normalize(); // +Y 指回起点
  _bz.copy(forwardHint).addScaledVector(_by, -forwardHint.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z);
  _bz.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  quatFromBasis(_bx, _by, _bz, obj.quaternion);
  obj.position.copy(from);
}

// 两段 IK：给定根部 a、目标 c、两段长度和弯曲方向 pole，求中间关节
const _ik1 = new THREE.Vector3(), _ik2 = new THREE.Vector3();
export function solveTwoBone(a, c, l1, l2, pole, outJoint, outEnd) {
  _ik1.subVectors(c, a);
  let d = _ik1.length();
  const maxD = l1 + l2 - 1e-3, minD = Math.abs(l1 - l2) + 1e-3;
  const dir = _ik1.multiplyScalar(1 / Math.max(d, 1e-6));
  d = clamp(d, minD, maxD);
  outEnd.copy(a).addScaledVector(dir, d);
  const x = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _ik2.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (_ik2.lengthSq() < 1e-6) _ik2.set(0, 1, 0);
  _ik2.normalize();
  outJoint.copy(a).addScaledVector(dir, x).addScaledVector(_ik2, h);
}

// 简单弹簧（挤压回弹）
export class Spring {
  constructor(k = 120, c = 9) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  kick(v) { this.v += v; }
  update(dt) {
    const steps = Math.ceil(dt / 0.008);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * this.x - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
}
