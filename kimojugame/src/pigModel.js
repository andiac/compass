// 3D 元祖高达奇魔猪（照 kitty_drama 定稿 R1_i / R3_d 量出来的比例：耳尖到脚底 = 2.0）
// 面朝 +Z；它的右手在 -X 一侧（拿光束步枪），左手在 +X 一侧（挂盾牌）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makePigMaterials, makeNoseMaterial, glowMaterial } from './materials.js';

const HEAD = { cy: 1.45, rx: 0.70, ry: 0.48, rz: 0.60 };
export const PIG_BODY_PIVOT = 0.3;           // body 组的枢轴高度（胯部）
export const PIG_SHOULDER = { x: 0.6, y: 0.88 }; // 肩关节（绝对高度）
export const PIG_REACH = 0.33;                 // 肩到手心的距离

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.05, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

// 椭球表面上的点（头部局部坐标，正面 z>0）与法线
function headSurface(x, y, out, nOut) {
  const { rx, ry, rz } = HEAD;
  const k = 1 - (x / rx) ** 2 - (y / ry) ** 2;
  const z = rz * Math.sqrt(Math.max(k, 1e-4));
  out.set(x, y, z);
  if (nOut) nOut.set(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
  return out;
}

// 浮雕鼻片：贴着头部曲面、整体微微凸起的横椭圆片，正面印着黑线贴图
function buildNoseGeometry(cx, cy, hw, hh, raise) {
  const rings = 14, segs = 64;
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const profile = (r) => (r < 0.82 ? raise : raise * Math.max(0, Math.cos(Math.min(1, (r - 0.82) / 0.18) * Math.PI / 2)) ** 0.7);
  // 中心点
  headSurface(cx, cy, p, n); p.addScaledVector(n, raise);
  pos.push(p.x, p.y, p.z); uv.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++) {
    const r = i / rings;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * hw * r, y = cy + Math.sin(a) * hh * r;
      headSurface(x, y, p, n); p.addScaledVector(n, profile(r));
      pos.push(p.x, p.y, p.z); uv.push(0.5 + 0.5 * r * Math.cos(a), 0.5 + 0.5 * r * Math.sin(a));
    }
  }
  // 侧壁往头里收，避免缝隙
  const wallStart = pos.length / 3;
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2;
    const x = cx + Math.cos(a) * hw, y = cy + Math.sin(a) * hh;
    headSurface(x, y, p, n); p.addScaledVector(n, -0.03);
    pos.push(p.x, p.y, p.z); uv.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let j = 0; j < segs; j++) {
    const j2 = (j + 1) % segs;
    idx.push(0, 1 + j, 1 + j2);
  }
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      idx.push(a0 + j, b0 + j, b0 + j2, a0 + j, b0 + j2, a0 + j2);
    }
  }
  const rim = 1 + (rings - 1) * segs;
  for (let j = 0; j < segs; j++) {
    const j2 = (j + 1) % segs;
    idx.push(rim + j, wallStart + j, wallStart + j2, rim + j, wallStart + j2, rim + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function extrude(shape, depth, bevel = 0.012) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}
const shapeFrom = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; };

export function buildPig() {
  const M = makePigMaterials();
  const root = new THREE.Group(); root.name = 'kimoju';
  const squash = new THREE.Group(); root.add(squash);
  const body = new THREE.Group(); body.position.y = PIG_BODY_PIVOT; squash.add(body);
  const Y = (abs) => abs - PIG_BODY_PIVOT; // 绝对高度 → body 局部

  // ---------- 头 ----------
  const head = new THREE.Group(); head.position.set(0, Y(HEAD.cy), 0.02); body.add(head);
  const headGeo = new THREE.SphereGeometry(1, 64, 44);
  const headMesh = mesh(headGeo, M.white, 0, 0, 0, head);
  headMesh.scale.set(HEAD.rx, HEAD.ry, HEAD.rz);

  // 鼻片（印着粗黑外圈和两个空心鼻孔）
  const noseHW = 0.2, noseHH = 0.145, noseCY = -0.084;
  M.nose = makeNoseMaterial(noseHW / noseHH);
  mesh(buildNoseGeometry(0, noseCY, noseHW, noseHH, 0.032), M.nose, 0, 0, 0, head);

  // 两颗印上去的实心小黑点眼睛：在鼻片上缘左右两角的正上方
  const eyeGeo = new THREE.SphereGeometry(0.026, 16, 12);
  const tmpP = new THREE.Vector3(), tmpN = new THREE.Vector3();
  for (const s of [-1, 1]) {
    headSurface(s * 0.146, 0.086, tmpP, tmpN);
    const eye = mesh(eyeGeo, M.black, 0, 0, 0, head);
    eye.position.copy(tmpP).addScaledVector(tmpN, 0.002);
    eye.scale.set(1, 1, 0.35);
    eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpN);
    eye.castShadow = false;
  }

  // 耳朵：纯白塑料的小圆角三角，略向外倾
  const earGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0.125, -0.04), new THREE.Vector2(0.12, 0.02), new THREE.Vector2(0.1, 0.09), new THREE.Vector2(0.07, 0.15),
    new THREE.Vector2(0.038, 0.2), new THREE.Vector2(0.012, 0.225), new THREE.Vector2(0.0, 0.23)], 18);
  for (const s of [-1, 1]) {
    const x = s * 0.38, z = 0.04;
    const y = HEAD.ry * Math.sqrt(1 - (x / HEAD.rx) ** 2 - (z / HEAD.rz) ** 2);
    const n = new THREE.Vector3(x / HEAD.rx ** 2, y / HEAD.ry ** 2, z / HEAD.rz ** 2).normalize();
    n.lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
    const ear = mesh(earGeo, M.white, x, y - 0.01, z, head);
    ear.scale.set(1, 1, 0.62);
    ear.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  }

  // 黄色 V 字天线 + 红宝石，在额头顶上、离眼睛很远
  const ant = new THREE.Group();
  headSurface(0, 0.395, tmpP, tmpN);
  ant.position.copy(tmpP).addScaledVector(tmpN, -0.01);
  ant.rotation.x = -0.32;
  head.add(ant);
  const vShape = shapeFrom([[0, -0.07], [0.1, -0.05], [0.47, 0.37], [0.4, 0.38], [0.06, 0.07], [0, 0.055], [-0.06, 0.07], [-0.4, 0.38], [-0.47, 0.37], [-0.1, -0.05]]);
  mesh(extrude(vShape, 0.04, 0.012), M.yellow, 0, 0, 0, ant);
  const housing = shapeFrom([[-0.085, 0.045], [0.085, 0.045], [0.07, -0.04], [0, -0.1], [-0.07, -0.04]]);
  mesh(extrude(housing, 0.05, 0.01), M.yellow, 0, -0.005, 0.03, ant);
  mesh(new THREE.SphereGeometry(0.042, 20, 14), M.red, 0, -0.012, 0.075, ant).material = new THREE.MeshPhysicalMaterial({ color: 0xd0201e, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });

  // ---------- 躯干（照定稿：蓝胸甲 + 黄领边 + 两个黄散热口 + 正中蓝舱盖；红腹甲；白细腰带 + U 字护板） ----------
  mesh(rbox(1.02, 0.36, 0.62, 0.07), M.blue, 0, Y(0.796), 0, body);
  const collar = mesh(rbox(0.44, 0.06, 0.14, 0.02), M.yellow, 0, Y(0.975), 0.25, body);
  collar.rotation.x = 0.25;
  for (const s of [-1, 1]) {
    mesh(rbox(0.2, 0.12, 0.06, 0.015), M.yellow, s * 0.27, Y(0.70), 0.3, body);
    for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(0.15, 0.016, 0.02), M.black, s * 0.27, Y(0.735 - k * 0.034), 0.333, body).castShadow = false;
  }
  mesh(rbox(0.29, 0.33, 0.14, 0.03), M.blue, 0, Y(0.646), 0.33, body);
  mesh(rbox(0.97, 0.17, 0.58, 0.05), M.red, 0, Y(0.549), 0, body);
  mesh(rbox(1.0, 0.1, 0.6, 0.04), M.white, 0, Y(0.39), 0, body);
  mesh(rbox(0.19, 0.14, 0.05, 0.02), M.white, 0, Y(0.33), 0.305, body);
  const tri = shapeFrom([[-0.06, 0.035], [0.06, 0.035], [0, -0.04]]);
  mesh(extrude(tri, 0.012, 0.004), M.red, 0, Y(0.335), 0.335, body);
  // 腰带下面圆鼓鼓的白肚子
  const belly = mesh(new THREE.SphereGeometry(1, 36, 20), M.white, 0, Y(0.275), 0, body);
  belly.scale.set(0.47, 0.17, 0.31);

  // ---------- 肩膀和手臂：白色大圆肩甲 + 短手臂 + 光滑的白色塑料小圆球手（没有手指） ----------
  const shoulderGeo = new THREE.SphereGeometry(0.135, 28, 20);
  const armGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.22, 16);
  const handGeo = new THREE.SphereGeometry(0.115, 24, 18);
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * PIG_SHOULDER.x, Y(PIG_SHOULDER.y), 0);
    body.add(pivot);
    mesh(shoulderGeo, M.white, 0, 0, 0, pivot);
    const arm = new THREE.Group(); pivot.add(arm);
    mesh(armGeo, M.white, 0, -0.15, 0, arm);
    const hand = mesh(handGeo, M.white, 0, -PIG_REACH, 0, arm);
    return { pivot, arm, hand };
  };
  const R = makeArm(-1), L = makeArm(1);

  // ---------- 腿和红色方头靴子 ----------
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.16, 16);
  const bootGeo = rbox(0.28, 0.12, 0.37, 0.035);
  const makeLeg = (side) => {
    const g = new THREE.Group(); g.position.set(side * 0.2, 0.22, 0); squash.add(g);
    mesh(legGeo, M.white, 0, -0.06, 0, g);
    mesh(bootGeo, M.red, 0, -0.16, 0.03, g);
    return g;
  };
  const legR = makeLeg(-1), legL = makeLeg(1);

  // ---------- 背包：只有胸甲那么宽，两根光束剑剑柄插在上面两角（从正面被大头挡住） ----------
  const pack = new THREE.Group(); pack.position.set(0, Y(0.82), -0.42); body.add(pack);
  mesh(rbox(0.62, 0.5, 0.22, 0.04), M.gray, 0, 0, 0, pack);
  mesh(rbox(0.46, 0.18, 0.08, 0.02), M.gray, 0, 0.06, -0.13, pack);
  const nozzles = [], flames = [];
  const nozzleGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.2, 16);
  // ConeGeometry 尖端朝 +Y：先翻转再下移，让宽的底面在喷口（原点）、尖端朝 -Y
  const flameOuterGeo = new THREE.ConeGeometry(0.1, 0.7, 14, 1, true); flameOuterGeo.rotateX(Math.PI); flameOuterGeo.translate(0, -0.35, 0);
  const flameInnerGeo = new THREE.ConeGeometry(0.05, 0.42, 10, 1, true); flameInnerGeo.rotateX(Math.PI); flameInnerGeo.translate(0, -0.21, 0);
  const flameOuterMat = glowMaterial(0.35, 0.95, 2.1, 0.6);
  const flameInnerMat = glowMaterial(1.5, 1.8, 2.4, 0.85);
  const hiltGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 12);
  const hilts = [];
  for (const s of [-1, 1]) {
    const nz = mesh(nozzleGeo, M.darkGray, s * 0.15, -0.31, -0.03, pack);
    nozzles.push(nz);
    const f = new THREE.Group(); f.position.set(s * 0.15, -0.41, -0.05); f.rotation.x = 0.35; pack.add(f);
    const o = new THREE.Mesh(flameOuterGeo, flameOuterMat), i = new THREE.Mesh(flameInnerGeo, flameInnerMat);
    f.add(o, i); f.visible = false; flames.push(f);
    const h = mesh(hiltGeo, M.white, s * 0.24, 0.33, -0.02, pack);
    h.rotation.z = -s * 0.32; h.rotation.x = -0.18;
    hilts.push(h);
  }
  const thrusterLight = new THREE.PointLight(0x7fc4ff, 0, 4.5, 2);
  thrusterLight.position.set(0, -0.6, -0.2); pack.add(thrusterLight);

  // ---------- 武器 ----------
  // 光束步枪：深灰，圆形瞄准镜，枪口一圈黄（握把在原点，+Z 是枪口方向）
  const rifle = new THREE.Group(); body.add(rifle);
  const rg = new THREE.Group(); rg.scale.setScalar(1.15); rifle.add(rg);
  mesh(rbox(0.1, 0.14, 0.62, 0.02), M.darkGray, 0, 0.05, 0.12, rg);
  const barrel = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 12), M.darkGray, 0, 0.07, 0.6, rg); barrel.rotation.x = Math.PI / 2;
  const ring = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 16), M.yellow, 0, 0.07, 0.78, rg); ring.rotation.x = Math.PI / 2;
  const scope = mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.2, 16), M.darkGray, 0, 0.17, 0.1, rg); scope.rotation.x = Math.PI / 2;
  const lens = mesh(new THREE.CircleGeometry(0.034, 16), M.lens, 0, 0.17, 0.201, rg); lens.castShadow = false;
  mesh(rbox(0.06, 0.15, 0.07, 0.015), M.darkGray, 0, -0.05, 0.0, rg).rotation.x = -0.25;
  mesh(rbox(0.07, 0.11, 0.17, 0.015), M.gray, 0, -0.03, 0.24, rg);
  mesh(rbox(0.08, 0.1, 0.22, 0.02), M.darkGray, 0, 0.03, -0.27, rg);
  const rifleMuzzle = new THREE.Object3D(); rifleMuzzle.position.set(0, 0.07, 0.83); rg.add(rifleMuzzle);

  // 光束剑：白剑柄 + 发光的粉红光刃（+Z 是刃的方向）
  const saber = new THREE.Group(); saber.visible = false; body.add(saber);
  const sh = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 12), M.white, 0, 0, 0.02, saber); sh.rotation.x = Math.PI / 2;
  const bladeCore = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 12, 1, true), glowMaterial(4.0, 2.2, 3.4, 1));
  bladeCore.rotation.x = Math.PI / 2; bladeCore.position.z = 0.85; saber.add(bladeCore);
  const bladeGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 1.48, 12, 1, true), glowMaterial(2.4, 0.3, 1.3, 0.5));
  bladeGlow.rotation.x = Math.PI / 2; bladeGlow.position.z = 0.86; saber.add(bladeGlow);
  const saberBase = new THREE.Object3D(); saberBase.position.z = 0.2; saber.add(saberBase);
  const saberTip = new THREE.Object3D(); saberTip.position.z = 1.55; saber.add(saberTip);
  const saberLight = new THREE.PointLight(0xff5fb0, 0, 5, 2); saberLight.position.z = 0.8; saber.add(saberLight);

  // 盾牌：竖长六角形，红盾面、白宽边、黄色十字星、上端白色小窗（正面 +Z）
  const shield = new THREE.Group(); body.add(shield);
  const outer = [[-0.22, 0.5], [0.22, 0.5], [0.32, 0.24], [0.14, -0.52], [-0.14, -0.52], [-0.32, 0.24]];
  mesh(extrude(shapeFrom(outer), 0.06, 0.015), M.white, 0, 0, 0, shield);
  const inner = outer.map(([x, y]) => [x * 0.78, y * 0.84 + 0.01]);
  mesh(extrude(shapeFrom(inner), 0.02, 0.006), M.red, 0, 0, 0.045, shield);
  const star = shapeFrom([[0, 0.3], [0.032, 0.032], [0.15, 0], [0.032, -0.032], [0, -0.36], [-0.032, -0.032], [-0.15, 0], [-0.032, 0.032]]);
  mesh(extrude(star, 0.012, 0.004), M.yellow, 0, -0.02, 0.064, shield);
  mesh(rbox(0.16, 0.07, 0.02, 0.008), M.white, 0, 0.36, 0.062, shield);

  // 超级火箭筒：深蓝灰粗圆筒（只在开火时出现）
  const bazooka = new THREE.Group(); bazooka.visible = false; body.add(bazooka);
  const bzMat = new THREE.MeshStandardMaterial({ color: 0x3a4658, roughness: 0.45, metalness: 0.4 });
  const tube = mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.25, 20), bzMat, 0, 0.12, 0.2, bazooka); tube.rotation.x = Math.PI / 2;
  const fr = mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.09, 20), bzMat, 0, 0.12, 0.8, bazooka); fr.rotation.x = Math.PI / 2;
  const rr = mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.16, 20, 1, true), bzMat, 0, 0.12, -0.48, bazooka); rr.rotation.x = -Math.PI / 2;
  mesh(rbox(0.06, 0.14, 0.08, 0.015), M.darkGray, 0, -0.02, 0.05, bazooka);
  mesh(rbox(0.06, 0.08, 0.22, 0.015), M.darkGray, 0.13, 0.2, 0.2, bazooka);
  const bazookaMuzzle = new THREE.Object3D(); bazookaMuzzle.position.set(0, 0.12, 0.86); bazooka.add(bazookaMuzzle);

  // 受击闪光：所有塑料材质一起发光
  const flashMats = [M.white, M.blue, M.yellow, M.red, M.gray, M.nose];

  return {
    root, squash, body, head, legL, legR,
    armL: L.arm, armR: R.arm, shoulderL: L.pivot, shoulderR: R.pivot, handL: L.hand, handR: R.hand,
    pack, flames, nozzles, thrusterLight, hilts,
    rifle, rifleMuzzle, saber, saberBase, saberTip, saberLight, bladeCore, bladeGlow, shield, bazooka, bazookaMuzzle,
    materials: M, flashMats,
  };
}
