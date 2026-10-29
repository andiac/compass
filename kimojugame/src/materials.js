// 共享材质与程序生成的贴图（不依赖任何外部图片）
import * as THREE from 'three';
import { mulberry32 } from './util.js';

// ---- 3D 元祖高达奇魔猪：照设定稿取样的配色，做成缎面塑料 ----
export const PIG_COLORS = {
  white: 0xf1f0ec,
  blue: 0x1d56a6,
  yellow: 0xe3b12a,
  red: 0xc0362f,
  gray: 0x6a7378,      // 背包
  darkGray: 0x363f43,  // 光束步枪
  black: 0x1f1e1b,     // 印上去的五官
};

function plastic(color, roughness = 0.42, clearcoat = 0.35) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.32 });
}

export function makePigMaterials() {
  return {
    white: plastic(PIG_COLORS.white, 0.4, 0.4),
    blue: plastic(PIG_COLORS.blue, 0.36),
    yellow: plastic(PIG_COLORS.yellow, 0.36),
    red: plastic(PIG_COLORS.red, 0.36),
    gray: plastic(PIG_COLORS.gray, 0.5, 0.15),
    darkGray: new THREE.MeshStandardMaterial({ color: PIG_COLORS.darkGray, roughness: 0.45, metalness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: PIG_COLORS.black, roughness: 0.35, metalness: 0 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x2a4a5e, roughness: 0.1, metalness: 0.6 }),
    nose: null, // 鼻子贴图材质在 makeNoseMaterial 里
  };
}

// 浮雕脸的鼻子：白色塑料片上印一圈粗黑线和两个空心竖椭圆鼻孔（圈里是白色，不是黑洞）
export function makeNoseMaterial(aspect /* 宽/高 */) {
  const W = 512, H = Math.round(512 / aspect);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f1f0ec'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1f1e1b';
  g.lineCap = 'round';
  // 外圈粗黑线：贴着鼻片边缘
  const t = W * 0.05;
  g.lineWidth = t;
  g.beginPath();
  g.ellipse(W / 2, H / 2, W / 2 - t * 0.75 - W * 0.025, H / 2 - t * 0.75 - H * 0.03, 0, 0, Math.PI * 2);
  g.stroke();
  // 两个空心竖椭圆鼻孔
  g.lineWidth = W * 0.036;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(W / 2 + s * W * 0.185, H / 2 + H * 0.01, W * 0.095, H * 0.2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.32 });
}

// ---- 巨龙形 MA：深炮铁灰 + 暗金描边 + 装甲缝里的翠绿能量线 ----
export function makePanelTextures(seed = 3) {
  const rng = mulberry32(seed);
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = e.height = S;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);

  g.fillStyle = '#5a6570'; g.fillRect(0, 0, S, S);
  // 细微的涂装颗粒
  for (let i = 0; i < 9000; i++) {
    const v = rng();
    g.fillStyle = v < 0.5 ? `rgba(20,26,32,${0.05 + rng() * 0.06})` : `rgba(160,175,190,${0.03 + rng() * 0.04})`;
    g.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 3);
  }
  const panels = [];
  const split = (x, y, w, h, depth) => {
    const stop = depth > 4 || (w < 140 && h < 140) || (depth > 1 && rng() < 0.22);
    if (stop) { panels.push([x, y, w, h]); return; }
    if (w > h) { const s = Math.round(w * (0.3 + rng() * 0.4)); split(x, y, s, h, depth + 1); split(x + s, y, w - s, h, depth + 1); }
    else { const s = Math.round(h * (0.3 + rng() * 0.4)); split(x, y, w, s, depth + 1); split(x, y + s, w, h - s, depth + 1); }
  };
  split(0, 0, S, S, 0);
  for (const [x, y, w, h] of panels) {
    const tone = rng();
    g.fillStyle = tone < 0.5 ? `rgba(15,20,26,${0.05 + rng() * 0.12})` : `rgba(140,155,170,${0.03 + rng() * 0.07})`;
    g.fillRect(x + 3, y + 3, w - 6, h - 6);
    // 分件线
    g.strokeStyle = 'rgba(10,13,16,0.62)'; g.lineWidth = 3; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.strokeStyle = 'rgba(200,215,230,0.06)'; g.lineWidth = 2; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
    // 暗金色细描边
    if (rng() < 0.35) { g.strokeStyle = 'rgba(160,128,62,0.75)'; g.lineWidth = 2.5; g.strokeRect(x + 9, y + 9, w - 18, h - 18); }
    // 刻线
    if (rng() < 0.4) {
      g.strokeStyle = 'rgba(10,13,16,0.7)'; g.lineWidth = 2;
      g.beginPath();
      if (w > h) { const yy = y + h * (0.3 + rng() * 0.4); g.moveTo(x + 14, yy); g.lineTo(x + w * (0.4 + rng() * 0.5), yy); }
      else { const xx = x + w * (0.3 + rng() * 0.4); g.moveTo(xx, y + 14); g.lineTo(xx, y + h * (0.4 + rng() * 0.5)); }
      g.stroke();
    }
    // 螺丝
    if (rng() < 0.45) {
      g.fillStyle = 'rgba(25,30,36,0.8)';
      for (const [px, py] of [[x + 14, y + 14], [x + w - 14, y + 14], [x + 14, y + h - 14], [x + w - 14, y + h - 14]]) {
        g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
      }
    }
    // 装甲缝里的翠绿能量线（发光贴图）
    if (rng() < 0.16) {
      ge.strokeStyle = '#fff'; ge.lineWidth = 5;
      g.strokeStyle = 'rgba(60,200,120,0.9)'; g.lineWidth = 4;
      ge.beginPath(); g.beginPath();
      const side = Math.floor(rng() * 4);
      const pts = side === 0 ? [[x + 8, y + 3], [x + w - 8, y + 3]] : side === 1 ? [[x + 8, y + h - 3], [x + w - 8, y + h - 3]]
        : side === 2 ? [[x + 3, y + 8], [x + 3, y + h - 8]] : [[x + w - 3, y + 8], [x + w - 3, y + h - 8]];
      for (const ctx of [g, ge]) { ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke(); }
    }
    // 磨损掉漆：边角的亮色小划痕
    if (rng() < 0.5) {
      g.strokeStyle = 'rgba(190,195,200,0.35)'; g.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) {
        const px = x + rng() * w, py = rng() < 0.5 ? y + 4 + rng() * 6 : y + h - 4 - rng() * 6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + (rng() - 0.5) * 18, py + (rng() - 0.5) * 4); g.stroke();
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.anisotropy = 8;
  return { map, emissiveMap };
}

export const GREEN = new THREE.Color(0.25, 1.0, 0.55);

export function makeDragonMaterials() {
  const { map, emissiveMap } = makePanelTextures();
  const armor = new THREE.MeshStandardMaterial({
    color: 0xffffff, map, emissiveMap, emissive: new THREE.Color(0.2, 1.0, 0.5), emissiveIntensity: 1.6,
    metalness: 0.62, roughness: 0.48,
  });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b3036, metalness: 0.8, roughness: 0.38 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x7c6844, metalness: 0.85, roughness: 0.32 });
  const piston = new THREE.MeshStandardMaterial({ color: 0xa9afb4, metalness: 0.9, roughness: 0.22 });
  const charred = new THREE.MeshStandardMaterial({ color: 0x1c1d1e, metalness: 0.4, roughness: 0.85, map });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.6, 1.0), toneMapped: true });
  const glowDim = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.9, 0.38) });
  return { armor, frame, bronze, piston, charred, glow, glowDim };
}

// 把任意几何体按法线主轴做盒投影 UV，使装甲贴图在不同大小的零件上密度一致
export function boxProjectUV(geometry, tile = 2.2) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  if (!nor) geometry.computeVertexNormals();
  const n = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
    uv[i * 2] = u / tile + 0.37; uv[i * 2 + 1] = v / tile + 0.61;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// ---- 特效贴图 ----
export function makeSoftDotTexture(size = 64, hard = 0.0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(Math.max(0.05, hard), 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function makeSmokeTexture(size = 128, seed = 11) {
  const rng = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const r = size * (0.12 + rng() * 0.2);
    const a = rng() * Math.PI * 2, d = rng() * size * 0.22;
    const x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function makeMistTexture(size = 256, seed = 5) {
  const rng = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  for (let i = 0; i < 60; i++) {
    const r = size * (0.08 + rng() * 0.22);
    const x = size * (0.2 + rng() * 0.6), y = size * (0.3 + rng() * 0.4);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.13)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
  }
  // 边缘渐隐
  const mask = g.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = mask; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeScorchTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(12,10,8,0.95)');
  grd.addColorStop(0.45, 'rgba(25,20,15,0.7)');
  grd.addColorStop(1, 'rgba(30,25,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// 发光叠加材质（颜色可以超过 1，交给泛光）
export function glowMaterial(r, g, b, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(r, g, b), transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
}
