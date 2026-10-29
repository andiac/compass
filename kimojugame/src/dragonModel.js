// 巨龙形 MA（照 kitty_drama 定稿 M1_i / M2_c / M3_c）：四足、嘴里是翠绿色高能光束主炮、
// 两只翅膀上各有一个长条导弹舱（一排四块舱盖）、背脊两列背鳍一样的浮游炮、长分节尾巴末端尖刃。
// 地面到头顶 ≈ 6（奇魔猪的 3 倍）。面朝 +Z。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeDragonMaterials, boxProjectUV } from './materials.js';

export const DRAGON = {
  bodyH: 3.2,
  legs: [
    { name: 'FL', x: 1.62, y: -0.55, z: 2.15, front: true, side: 1 },
    { name: 'FR', x: -1.62, y: -0.55, z: 2.15, front: true, side: -1 },
    { name: 'RL', x: 1.55, y: -0.6, z: -2.35, front: false, side: 1 },
    { name: 'RR', x: -1.55, y: -0.6, z: -2.35, front: false, side: -1 },
  ],
  l1: 1.7, l2: 1.65, ankle: 0.35,
  tailLens: [0.95, 0.9, 0.85, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6],
  tailRadius: [0.58, 0.54, 0.5, 0.45, 0.41, 0.37, 0.33, 0.29, 0.25],
};

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const rbox = (w, h, d, r = 0.1, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

function taperedBox(w, h, d, wFront, hFront, yShiftFront = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getZ(i) + d / 2) / d;
    p.setX(i, p.getX(i) * THREE.MathUtils.lerp(1, wFront / w, t));
    p.setY(i, p.getY(i) * THREE.MathUtils.lerp(1, hFront / h, t) + yShiftFront * t);
  }
  g.computeVertexNormals();
  return g;
}

function extrudeShape(pts, depth, bevel = 0.03) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

// 把同一个组里的静态零件按材质合并成少量网格，减少绘制调用
class Builder {
  constructor(parent, armorMat) { this.parent = parent; this.armorMat = armorMat; this.buckets = new Map(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
    return this.addMatrix(geo, mat, new THREE.Matrix4().compose(_p, _q, _s));
  }
  addQuat(geo, mat, pos, quat, scale = 1) {
    _s.setScalar(scale);
    return this.addMatrix(geo, mat, new THREE.Matrix4().compose(pos, quat, _s));
  }
  addMatrix(geo, mat, m) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(m);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    return this;
  }
  finish(shadow = true) {
    const meshes = [];
    for (const [mat, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (mat === this.armorMat) boxProjectUV(merged, 3.4);
      const m = new THREE.Mesh(merged, mat);
      const glowy = mat.isMeshBasicMaterial;
      m.castShadow = shadow && !glowy; m.receiveShadow = !glowy;
      this.parent.add(m);
      meshes.push(m);
    }
    this.buckets.clear();
    return meshes;
  }
}

export function buildDragon() {
  const M = makeDragonMaterials();
  const group = new THREE.Group(); group.name = 'dragonMA';
  const body = new THREE.Group(); body.rotation.order = 'YXZ'; group.add(body);
  const B = new Builder(body, M.armor);

  // ---------- 躯干：流线型的厚重 MA 装甲 ----------
  B.add(rbox(3.3, 2.8, 3.0, 0.65, 3), M.armor, 0, 0.2, 1.9);
  B.add(rbox(2.9, 2.5, 2.4, 0.6, 3), M.armor, 0, 0.05, -0.25);
  B.add(rbox(3.1, 2.6, 2.7, 0.65, 3), M.armor, 0, 0.15, -2.35);
  B.add(taperedBox(2.3, 1.9, 0.7, 1.3, 1.5), M.armor, 0, -0.3, 3.35, 0.28, 0, 0);
  // 前腿上方的大圆肩甲、后腿外侧的护甲
  const sph = new THREE.SphereGeometry(1, 20, 14);
  for (const s of [-1, 1]) {
    B.add(sph, M.armor, s * 1.78, 0.1, 2.05, 0, 0, s * 0.12, 0.72, 1.05, 1.18);
    B.add(rbox(0.25, 1.2, 1.5, 0.08), M.armor, s * 2.38, 0.3, 2.1, 0, 0, s * 0.1);
    B.add(sph, M.armor, s * 1.66, -0.05, -2.35, 0, 0, s * 0.08, 0.68, 0.98, 1.22);
    // 侧面的液压管和装甲缝能量线
    B.add(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 8), M.piston, s * 1.46, -0.75, -0.15, Math.PI / 2, 0, 0);
    B.add(new THREE.BoxGeometry(0.03, 0.045, 1.5), M.glowDim, s * 1.465, 0.42, -0.25);
    B.add(new THREE.BoxGeometry(0.03, 0.045, 0.8), M.glowDim, s * 1.465, -0.15, -0.6);
    // 后胯的推进器喷口
    B.add(new THREE.CylinderGeometry(0.3, 0.26, 0.8, 16), M.frame, s * 0.85, 0.55, -3.75, Math.PI / 2, 0, 0);
    B.add(new THREE.CircleGeometry(0.2, 16), M.glowDim, s * 0.85, 0.55, -4.16, 0, Math.PI, 0);
  }
  // 背上的鳞片状装甲
  for (let i = 0; i < 6; i++) {
    B.add(rbox(2.35 - i * 0.12, 0.36, 1.3, 0.14), M.armor, 0, 1.56 + Math.sin(i * 0.9) * 0.05, 3.0 - i * 1.15, 0.12, 0, 0);
  }
  // 腹部的金属骨架
  B.add(rbox(2.0, 0.6, 5.6, 0.2), M.frame, 0, -1.25, 0.1);
  B.finish();

  // 推进器的火焰（冲撞时点亮）
  const hipFlames = [];
  const flameGeo = new THREE.ConeGeometry(0.24, 1.8, 12, 1, true); flameGeo.rotateX(-Math.PI / 2); flameGeo.translate(0, 0, -0.9);
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.6, 1.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(s * 0.85, 0.55, -4.15); f.visible = false; body.add(f); hipFlames.push(f);
  }

  // ---------- 脖子：一节一节的装甲环，节间发绿光 ----------
  const neckBase = new THREE.Group(); neckBase.position.set(0, 0.95, 3.25); neckBase.rotation.x = -0.35; body.add(neckBase);
  const neck = [];
  const neckSegGeo = new THREE.CylinderGeometry(0.62, 0.72, 0.72, 14); neckSegGeo.rotateX(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.6, 0.045, 6, 22);
  let parent = neckBase;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group(); seg.position.set(0, 0, i === 0 ? 0 : 0.72); parent.add(seg);
    const nb = new Builder(seg, M.armor);
    const sc = 1 - i * 0.06;
    nb.add(neckSegGeo, M.armor, 0, 0, 0.36, 0, 0, 0, sc, sc, 1);
    nb.add(rbox(0.95, 0.26, 0.62, 0.08), M.armor, 0, 0.6 * sc, 0.34, 0.1, 0, 0, sc, 1, 1);
    nb.add(ringGeo, M.glow, 0, 0, 0.02, 0, 0, 0, sc, sc, 1);
    nb.add(new THREE.ConeGeometry(0.1, 0.45, 6), M.armor, 0, 0.85 * sc, 0.28, -0.5, 0, 0);
    nb.finish();
    neck.push(seg); parent = seg;
  }

  // ---------- 头 ----------
  const head = new THREE.Group(); head.position.set(0, 0, 0.66); head.rotation.x = 0.3; parent.add(head);
  const hb = new Builder(head, M.armor);
  hb.add(taperedBox(1.45, 1.0, 1.35, 1.3, 0.9), M.armor, 0, 0.2, 0.45);
  hb.add(taperedBox(1.2, 0.52, 1.95, 0.68, 0.36, -0.06), M.armor, 0, 0.1, 1.85);
  hb.add(taperedBox(0.5, 0.2, 1.5, 0.25, 0.12), M.armor, 0, 0.42, 1.65, 0.12, 0, 0); // 鼻梁上的冠
  for (const s of [-1, 1]) {
    hb.add(rbox(0.55, 0.16, 0.95, 0.04), M.armor, s * 0.46, 0.64, 1.0, 0.18, s * 0.28, -s * 0.28); // 装甲眉骨
    hb.add(new THREE.BoxGeometry(0.38, 0.075, 0.1), M.glow, s * 0.6, 0.46, 1.17, 0, s * 0.5, -s * 0.32); // 细长的翠绿感应器眼睛
    // 脑后两根长角
    const dir = new THREE.Vector3(s * 0.22, 0.5, -0.84).normalize();
    const hornGeo = new THREE.ConeGeometry(0.17, 2.5, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    hb.addQuat(hornGeo, M.armor, new THREE.Vector3(s * 0.45, 0.72, 0.35).addScaledVector(dir, 1.2), q);
    const dir2 = new THREE.Vector3(s * 0.45, 0.35, -0.82).normalize();
    hb.addQuat(new THREE.ConeGeometry(0.1, 1.1, 8), M.armor, new THREE.Vector3(s * 0.62, 0.35, 0.25).addScaledVector(dir2, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir2));
    // 上排短獠牙
    for (let k = 0; k < 5; k++) {
      const z = 1.25 + k * 0.33, x = s * (0.5 - k * 0.045);
      hb.add(new THREE.ConeGeometry(0.055, 0.24 + (k === 0 ? 0.08 : 0), 6), M.bronze, x, -0.24, z, Math.PI, 0, 0);
    }
  }
  // 主炮的炮口外壳（在嘴里靠后的位置）
  hb.add(new THREE.CylinderGeometry(0.4, 0.46, 0.5, 24).rotateX(Math.PI / 2), M.frame, 0, -0.3, 0.95);
  hb.finish();

  // 主炮炮口：一圈圈聚能环，蓄力时由里往外依次亮起翠绿色
  const muzzle = new THREE.Group(); muzzle.position.set(0, -0.3, 1.21); head.add(muzzle);
  const rings = [];
  const radii = [0.09, 0.17, 0.25, 0.33];
  for (let i = 0; i < radii.length; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.8, 0.35) });
    const r = new THREE.Mesh(new THREE.TorusGeometry(radii[i], 0.026, 8, 40), mat);
    r.position.z = 0.01 + i * 0.005; muzzle.add(r); rings.push(r);
  }
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 0.6) });
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), coreMat); core.position.z = 0.012; muzzle.add(core);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x0d2618, emissive: new THREE.Color(0.05, 0.5, 0.2), roughness: 0.15, metalness: 0.3 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.37, 32), lensMat); lens.position.z = 0.0; muzzle.add(lens);
  const muzzleTip = new THREE.Object3D(); muzzleTip.position.set(0, 0, 0.12); muzzle.add(muzzleTip);
  const mouthLight = new THREE.PointLight(0x40ff8a, 0, 14, 2); mouthLight.position.set(0, -0.3, 1.8); head.add(mouthLight);

  // 下颚（可张合）
  const jaw = new THREE.Group(); jaw.position.set(0, -0.3, 0.45); jaw.rotation.x = 0.3; head.add(jaw);
  const jb = new Builder(jaw, M.armor);
  jb.add(taperedBox(1.05, 0.3, 2.05, 0.58, 0.24), M.armor, 0, -0.28, 1.05);
  jb.add(new THREE.ConeGeometry(0.1, 0.4, 6), M.armor, 0, -0.5, 1.7, Math.PI * 0.62, 0, 0);
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    jb.add(new THREE.ConeGeometry(0.05, 0.2, 6), M.bronze, s * (0.4 - k * 0.04), -0.05, 0.55 + k * 0.32);
  }
  jb.finish();

  // ---------- 翅膀：层叠装甲翼板 + 翼根前半段的长条导弹舱 ----------
  const wings = [];
  for (const s of [1, -1]) {
    const w = new THREE.Group(); w.position.set(s * 1.45, 1.6, 1.1); body.add(w);
    const wb = new Builder(w, M.armor);
    const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(s * 1.15, 0.8, -0.25);
    const len = a.distanceTo(b);
    const strutQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    wb.addQuat(new THREE.CylinderGeometry(0.26, 0.32, len, 10), M.frame, a.clone().lerp(b, 0.5), strutQ);
    wb.add(sph, M.frame, 0, 0, 0, 0, 0, 0, 0.42, 0.42, 0.42);
    wb.finish();

    const pod = new THREE.Group(); pod.position.set(s * 1.35, 0.95, -0.3); w.add(pod);
    const pb = new Builder(pod, M.armor);
    pb.add(rbox(0.95, 1.05, 3.0, 0.2, 3), M.armor, 0, 0, 0);
    pb.add(rbox(0.7, 0.18, 2.6, 0.06), M.armor, 0, 0.6, -0.1);
    for (const y of [0.25, -0.25]) {
      pb.add(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 14).rotateX(Math.PI / 2), M.frame, 0, y, -1.62);
      pb.add(new THREE.CircleGeometry(0.13, 14), M.glowDim, 0, y, -1.84, 0, Math.PI, 0);
    }
    // 舱盖后面整齐排着的小导弹（掀开舱盖才看得到；关着时完全藏在舱盖下面）
    const tipGeo = new THREE.ConeGeometry(0.06, 0.08, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xb03028, roughness: 0.5 });
    const zs = [0.98, 0.33, -0.33, -0.98];
    for (const z of zs) {
      pb.add(new THREE.BoxGeometry(0.02, 0.52, 0.56), M.frame, s * 0.476, 0.05, z);
      for (const dy of [0.18, -0.08]) for (const dz of [-0.13, 0.13]) {
        pb.add(new THREE.CircleGeometry(0.07, 10), M.piston, s * 0.488, dy, z + dz, 0, s * Math.PI / 2, 0);
        pb.add(tipGeo, tipMat, s * 0.495, dy, z + dz, 0, 0, -s * Math.PI / 2);
      }
    }
    pb.finish();
    const hatches = [];
    const hatchGeo = boxProjectUV(rbox(0.07, 0.6, 0.6, 0.025), 2.4);
    for (const z of zs) {
      const hp = new THREE.Group(); hp.position.set(s * 0.53, 0.36, z); pod.add(hp);
      const hm = new THREE.Mesh(hatchGeo, M.armor); hm.position.set(s * 0.035, -0.3, 0); hm.castShadow = true; hp.add(hm);
      hatches.push(hp);
    }
    // 翼板
    const blades = new THREE.Group(); blades.position.set(s * 0.05, 0.45, -0.7); pod.add(blades);
    const bb = new Builder(blades, M.armor);
    // 层叠的装甲翼板：板面朝外侧（侧面看得到整块板），像鸟翼的飞羽一样往后上方展开
    const lens2 = [2.7, 3.3, 3.5, 3.0];
    for (let i = 0; i < 4; i++) {
      const L = lens2[i];
      const g = extrudeShape([[-0.55, 0], [0.5, 0], [0.16, L * 0.9], [-0.02, L], [-0.24, L * 0.72]], 0.1, 0.025);
      g.rotateY(Math.PI / 2); // 形状平面 → 竖直、包含前后方向
      const rx = -(0.3 + i * 0.33), rz = -s * (0.14 + i * 0.09);
      const ox = s * i * 0.09, oz = -i * 0.32;
      bb.add(g, M.armor, ox, 0, oz, rx, 0, rz);
      const tipLocal = new THREE.Vector3(0, L * 0.84, 0).applyEuler(new THREE.Euler(rx, 0, rz)).add(new THREE.Vector3(ox, 0, oz));
      bb.add(new THREE.BoxGeometry(0.13, 0.32, 0.07), M.glow, tipLocal.x, tipLocal.y, tipLocal.z, rx, 0, rz);
    }
    bb.finish();
    const firePoint = new THREE.Object3D(); firePoint.position.set(s * 0.5, 0.2, 0); pod.add(firePoint);
    wings.push({ side: s, group: w, pod, hatches, blades, firePoint, podMeshes: pod.children.filter((c) => c.isMesh) });
  }

  // ---------- 背脊上两列背鳍一样的楔形浮游炮（12 片） ----------
  const funnelGeo = (() => {
    const g = extrudeShape([[-0.44, 0], [0.44, 0], [0.12, 1.15], [-0.04, 1.25]], 0.2, 0.03);
    // 形状 x → 局部 y（沿脊背的底边），形状 y → 局部 z（尖端 = 炮口），挤出方向 → 局部 x（厚度）
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    return boxProjectUV(g, 2.4);
  })();
  const funnelTipGeo = new THREE.OctahedronGeometry(0.085, 0);
  const funnelJetGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const funnelSlots = [];
  const funnelMeshes = [];
  const zsF = [2.35, 1.4, 0.45, -0.5, -1.45, -2.4];
  for (const s of [1, -1]) {
    for (let i = 0; i < zsF.length; i++) {
      const slot = new THREE.Object3D();
      slot.position.set(s * 0.62, 1.86 + Math.sin(i * 0.9) * 0.05, zsF[i]);
      const d = new THREE.Vector3(s * 0.25, 0.86, -0.45).normalize();
      const yv = new THREE.Vector3(0, 0, 1).addScaledVector(d, -d.z).normalize();
      const xv = new THREE.Vector3().crossVectors(yv, d).normalize();
      slot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xv, yv, d));
      body.add(slot);
      funnelSlots.push(slot);
      const f = new THREE.Group();
      const fm = new THREE.Mesh(funnelGeo, M.armor); fm.castShadow = true; f.add(fm);
      const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 0.9) });
      const tip = new THREE.Mesh(funnelTipGeo, tipMat); tip.position.set(0, 0.0, 1.17); f.add(tip);
      const jet = new THREE.Mesh(funnelJetGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      jet.position.set(0, -0.3, 0.05); f.add(jet);
      const muzzlePt = new THREE.Object3D(); muzzlePt.position.set(0, 0, 1.3); f.add(muzzlePt);
      slot.add(f);
      funnelMeshes.push({ group: f, tip, tipMat, jet, muzzle: muzzlePt, slot });
    }
  }

  // ---------- 尾巴根部 ----------
  const tailBase = new THREE.Object3D(); tailBase.position.set(0, 0.45, -3.75); body.add(tailBase);

  // ---------- 四条粗壮的机械腿（世界坐标里由 IK 摆放） ----------
  const legsRoot = new THREE.Group(); group.add(legsRoot);
  const legs = DRAGON.legs.map((L) => {
    const upper = new THREE.Group(), lower = new THREE.Group(), foot = new THREE.Group();
    legsRoot.add(upper, lower, foot);
    const l1 = DRAGON.l1, l2 = DRAGON.l2;
    const ub = new Builder(upper, M.armor);
    ub.add(rbox(1.08, l1 + 0.3, 1.2, 0.3, 3), M.armor, 0, -l1 / 2, 0);
    ub.add(rbox(1.18, l1 * 0.55, 0.5, 0.15), M.armor, 0, -l1 * 0.3, L.front ? -0.5 : 0.5);
    ub.add(new THREE.CylinderGeometry(0.08, 0.08, l1 * 0.75, 8), M.piston, L.side * 0.45, -l1 * 0.5, L.front ? 0.55 : -0.55);
    ub.add(new THREE.SphereGeometry(0.5, 16, 12), M.frame, 0, -l1, 0);
    ub.add(new THREE.BoxGeometry(0.03, l1 * 0.35, 0.05), M.glowDim, L.side * 0.55, -l1 * 0.45, 0.1);
    ub.finish();
    const lb = new Builder(lower, M.armor);
    lb.add(rbox(0.84, l2, 0.95, 0.22, 3), M.armor, 0, -l2 / 2, 0);
    lb.add(rbox(0.92, l2 * 0.72, 0.18, 0.06), M.armor, 0, -l2 * 0.42, L.front ? -0.5 : 0.5);
    lb.add(new THREE.SphereGeometry(0.4, 14, 10), M.frame, 0, -l2, 0);
    lb.add(new THREE.CylinderGeometry(0.07, 0.07, l2 * 0.6, 8), M.piston, L.side * 0.38, -l2 * 0.45, L.front ? 0.5 : -0.5);
    lb.finish();
    const fb = new Builder(foot, M.armor);
    fb.add(rbox(1.15, 0.4, 1.3, 0.14), M.armor, 0, -0.16, 0.15);
    fb.add(rbox(0.9, 0.2, 0.7, 0.08), M.armor, 0, 0.1, 0.05);
    const clawGeo = new THREE.ConeGeometry(0.16, 0.9, 7);
    for (const x of [-0.38, 0, 0.38]) fb.add(clawGeo, M.bronze, x, -0.22, 0.88 + (x === 0 ? 0.1 : 0), Math.PI / 2 + 0.42, 0, x * 0.35);
    fb.add(clawGeo, M.bronze, 0, -0.26, -0.55, -Math.PI / 2 - 0.5, 0, 0, 0.8, 0.7, 0.8);
    fb.finish();
    return { ...L, upper, lower, foot };
  });

  // ---------- 很长的分节尾巴，末端尖刃（世界坐标里由链条模拟摆放） ----------
  const tailRoot = new THREE.Group(); group.add(tailRoot);
  const tail = DRAGON.tailLens.map((len, i) => {
    const seg = new THREE.Group(); tailRoot.add(seg);
    const r = DRAGON.tailRadius[i];
    const tb = new Builder(seg, M.armor);
    tb.add(new THREE.CylinderGeometry(r * 0.92, r, len + 0.12, 10), M.armor, 0, -len / 2, 0);
    tb.add(rbox(r * 1.5, len * 0.8, r * 0.5, 0.05), M.armor, 0, -len * 0.45, r * 0.75);
    if (i % 2 === 0) tb.add(new THREE.ConeGeometry(r * 0.32, r * 1.1, 6), M.armor, 0, -len * 0.3, r * 1.25, 2.2, 0, 0);
    for (const s of [-1, 1]) tb.add(new THREE.SphereGeometry(0.055, 6, 4), M.glow, s * r * 0.9, -len * 0.5, 0);
    tb.finish();
    return { group: seg, len, r };
  });
  const blade = new THREE.Group(); tailRoot.add(blade);
  {
    const g = extrudeShape([[0, 0.12], [0.16, 0], [0.55, -0.45], [0.2, -0.42], [0, -1.65], [-0.2, -0.42], [-0.55, -0.45], [-0.16, 0]], 0.12, 0.03);
    g.rotateY(Math.PI / 2); // 刃面竖直（包含尾巴方向和“上”）
    const bb = new Builder(blade, M.armor);
    bb.add(g, M.armor, 0, 0, 0);
    bb.add(new THREE.BoxGeometry(0.05, 0.9, 0.05), M.glow, 0.08, -0.6, 0);
    bb.add(new THREE.BoxGeometry(0.05, 0.9, 0.05), M.glow, -0.08, -0.6, 0);
    bb.finish();
  }

  return {
    group, body, neckBase, neck, head, jaw, muzzle, muzzleTip, rings, core, lens, mouthLight,
    wings, funnelSlots, funnelMeshes, tailBase, legsRoot, legs, tailRoot, tail, blade, hipFlames,
    materials: M,
  };
}
