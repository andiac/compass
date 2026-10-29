// 《奇魔猪 · 巨龙迎击战》主程序：渲染、泛光、游戏流程（标题 → 开场镜头 → 战斗 → 结算）、画质、暂停
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Sfx } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './cameraRig.js';
import { Projectiles } from './projectiles.js';
import { Player } from './player.js';
import { Dragon } from './dragon.js';
import { Hud } from './hud.js';
import { clamp, lerp, smoothstep, easeInOutSine, rand } from './util.js';

const QUALITY = {
  low: { pixelRatio: 1, bloom: false, shadow: 1024, grassRadius: 22, grassDensity: 2.2, grassShadows: false, mist: 16 },
  mid: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25), bloom: true, shadow: 2048, grassRadius: 30, grassDensity: 3.0, grassShadows: false, mist: 26 },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), bloom: true, shadow: 4096, grassRadius: 40, grassDensity: 3.6, grassShadows: true, mist: 36 },
};
const DIFFICULTY = {
  normal: { label: '普通', dmg: 1, cd: 1, hp: 1, regen: 7 },
  hard: { label: '困难', dmg: 1.45, cd: 0.78, hp: 1.2, regen: 0 },
};
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem('kimoju_dragon_' + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('kimoju_dragon_' + k, v); } catch (e) { /* 沙盒里可能不能存 */ } },
};
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

class Game {
  async init() {
    const canvas = $('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3200);
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    const ctx = { game: this, scene, camera, renderer };
    this.ctx = ctx;
    this.difficulty = DIFFICULTY[store.get('diff', 'normal')] || DIFFICULTY.normal;
    this.diffKey = store.get('diff', 'normal');

    await this.step('生成高地草原…');
    ctx.world = new World(ctx);
    ctx.world.buildEnvironment(renderer);
    await this.step('组装奇魔猪和巨龙…');
    ctx.effects = new Effects(ctx);
    ctx.audio = new Sfx();
    ctx.input = new Input(canvas);
    ctx.hud = new Hud(ctx);
    ctx.projectiles = new Projectiles(ctx);
    ctx.player = new Player(ctx);
    ctx.dragon = new Dragon(ctx);
    ctx.rig = new CameraRig(camera, ctx);

    // 后期：泛光只给发光的光束、推进火、炮口
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.qualityKey = params.get('q') || store.get('quality', 'mid');
    if (!QUALITY[this.qualityKey]) this.qualityKey = 'mid';
    await this.step('种草…');
    this.applyQuality(this.qualityKey);
    this.resetBattle();
    this.state = 'title';
    this.titleT = 0;
    this.battleTime = 0;
    this.god = params.get('god') === '1';
    this.bindUI();
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    await this.step('编译着色器…');
    this.precompile();
    $('loading').classList.add('hidden');
    $('title').classList.remove('hidden');
    this.clock = new THREE.Clock();
    this.fpsT = 0; this.fpsN = 0;
    window.__game = this;
    if (params.get('autostart') === '1') this.startBattle(true);
    if (params.get('view')) this.debugView(params.get('view'));
    renderer.setAnimationLoop(() => this.frame());
  }

  step(msg) { $('loading-msg').textContent = msg; return new Promise((r) => setTimeout(r, 30)); }

  precompile() {
    // 把隐藏的东西（光束、闪光、火箭筒……）也先编译一遍，避免第一次出现时卡顿
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn(e); }
    for (const o of hidden) o.visible = false;
  }

  applyQuality(key) {
    const Q = QUALITY[key];
    this.qualityKey = key;
    store.set('quality', key);
    this.Q = Q;
    this.renderer.setPixelRatio(Q.pixelRatio);
    this.composer.setPixelRatio(Q.pixelRatio);
    this.ctx.world.buildGrass(Q);
    this.ctx.world.setShadowQuality(Q.shadow);
    this.ctx.world.setMistCount(Q.mist);
    this.onResize();
    document.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('sel', b.dataset.q === key));
  }

  setDifficulty(key) {
    this.diffKey = key; this.difficulty = DIFFICULTY[key];
    store.set('diff', key);
    document.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('sel', b.dataset.d === key));
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.ctx.effects.setPointScale(h * this.renderer.getPixelRatio());
  }

  bindUI() {
    const ctx = this.ctx;
    $('btn-start').onclick = () => { ctx.audio.init(); ctx.input.requestLock(); this.startBattle(false); };
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart').onclick = () => { ctx.audio.init(); ctx.input.requestLock(); this.retry(); };
    $('btn-title').onclick = () => this.toTitle();
    $('btn-retry').onclick = () => { ctx.audio.init(); ctx.input.requestLock(); this.retry(); };
    $('btn-result-title').onclick = () => this.toTitle();
    document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => this.applyQuality(b.dataset.q)));
    document.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => this.setDifficulty(b.dataset.d)));
    this.setDifficulty(this.diffKey);
    const snd = $('btn-sound');
    const updSnd = () => { snd.textContent = ctx.audio.muted ? '音效：关' : '音效：开'; };
    snd.onclick = () => { ctx.audio.init(); ctx.audio.setMuted(!ctx.audio.muted); updSnd(); };
    updSnd();
    ctx.input.onLockChange = (locked) => {
      if (!locked && this.state === 'battle' && !ctx.rig.cine) this.pause();
    };
    $('c').addEventListener('click', () => {
      if (this.state === 'battle' && !ctx.input.locked && !ctx.input.lockFailed) ctx.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { if (this.state === 'battle') this.pause(); else if (this.state === 'paused') this.resume(); }
      if (e.code === 'KeyM') { ctx.audio.setMuted(!ctx.audio.muted); updSnd(); }
      if (e.code === 'KeyP') $('fps').classList.toggle('hidden');
      if (this.state === 'intro' && (e.code === 'Space' || e.code === 'Enter')) this.skipIntro();
    });
    $('c').addEventListener('mousedown', () => { if (this.state === 'intro') this.skipIntro(); });
  }

  spawnPoint() {
    const r = this.ctx.world.spawnRock;
    const x = r.x + 0.4, z = r.z + 1.2;
    return new THREE.Vector3(x, this.ctx.world.groundAt(x, z), z);
  }

  resetBattle() {
    const ctx = this.ctx;
    ctx.projectiles.clear();
    ctx.effects.clear();
    const sp = this.spawnPoint();
    const dragonPos = new THREE.Vector3(0, 0, 16);
    ctx.player.reset(sp, Math.atan2(dragonPos.x - sp.x, dragonPos.z - sp.z));
    ctx.dragon.reset(dragonPos, Math.atan2(sp.x - dragonPos.x, sp.z - dragonPos.z));
    ctx.dragon.aiEnabled = false;
    ctx.hud.resetParts(); ctx.hud.warn(null); ctx.hud.setInterrupt(-1);
    ctx.rig.cine = null; ctx.rig.blend = 0;
    ctx.rig.snapBehind(ctx.player);
    this.scene.fog.density = ctx.world.baseFog;
    this.battleTime = 0;
    this.comet = null;
    this.resultShown = false;
  }

  startBattle(skipIntro) {
    $('title').classList.add('hidden');
    this.resetBattle();
    if (skipIntro) { this.beginBattle(); return; }
    this.startIntro();
  }

  // 开场：从奇魔猪背后低机位慢慢抬头，雾被风吹开，露出雾里的巨龙形 MA；巨龙仰头咆哮
  startIntro() {
    const ctx = this.ctx, P = ctx.player.pos.clone(), D = ctx.dragon.pos.clone();
    this.state = 'intro';
    ctx.hud.show(false);
    const fwd = _v.subVectors(D, P).setY(0).normalize().clone();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).negate(); // 镜头右方
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    let roared = false, card = false;
    this.scene.fog.density = 0.034;
    const shot2From = new THREE.Vector3();
    ctx.rig.playCine(5.4, (t) => {
      this.scene.fog.density = lerp(0.034, ctx.world.baseFog, smoothstep(0.2, 3.2, t));
      const head = ctx.dragon.boxes[0].pos;
      if (t > 2.65 && !roared) { roared = true; ctx.dragon.intro = false; ctx.dragon.startAction('roar', {}); }
      if (t > 2.75 && !card) { card = true; $('bosscard').classList.add('on'); setTimeout(() => $('bosscard').classList.remove('on'), 2300); }
      if (t < 2.6) {
        const k = easeInOutSine(t / 2.6);
        const pos = _v2.copy(P).addScaledVector(fwd, -4.6).addScaledVector(right, 1.7).addScaledVector(UP, 0.8 + 0.4 * k);
        const look = _v3.copy(P).addScaledVector(fwd, 9).addScaledVector(UP, 1.6).lerp(_v.copy(head).addScaledVector(UP, -0.5), k);
        return { pos, look, fov: 52 };
      }
      const k = (t - 2.6) / 2.8;
      shot2From.copy(D).addScaledVector(fwd, -11).addScaledVector(side, 4.5).addScaledVector(UP, 0.9 + k * 0.8);
      shot2From.y = Math.max(shot2From.y, ctx.world.heightAt(shot2From.x, shot2From.z) + 0.6);
      return { pos: shot2From, look: _v3.copy(head).addScaledVector(UP, 0.4), fov: lerp(50, 44, k) };
    }, () => this.beginBattle());
  }
  skipIntro() {
    if (this.state !== 'intro') return;
    $('bosscard').classList.remove('on');
    this.ctx.rig.cine = null;
    this.ctx.dragon.cancelAction();
    this.beginBattle();
  }

  beginBattle() {
    const ctx = this.ctx;
    this.state = 'battle';
    $('bosscard').classList.remove('on');
    ctx.dragon.intro = false;
    ctx.dragon.aiEnabled = true;
    if (!ctx.dragon.action) ctx.dragon.idleT = 1.2;
    this.scene.fog.density = ctx.world.baseFog;
    ctx.hud.show(true);
    ctx.hud.toast('战斗开始！', 'pink', 1.4);
    ctx.rig.snapBehind(ctx.player);
    const force = params.get('act');
    if (force) { ctx.dragon.idleT = 0.5; ctx.dragon.cool = Object.fromEntries(Object.keys(ctx.dragon.cool).map((k) => [k, k === force ? 0 : 99])); }
  }

  retry() {
    $('result').classList.add('hidden'); $('pause').classList.add('hidden');
    this.resetBattle();
    this.ctx.dragon.intro = false;
    this.beginBattle();
  }

  toTitle() {
    $('result').classList.add('hidden'); $('pause').classList.add('hidden');
    this.resetBattle();
    this.ctx.hud.show(false);
    this.ctx.input.exitLock();
    this.state = 'title';
    $('title').classList.remove('hidden');
  }

  pause() {
    if (this.state !== 'battle') return;
    this.state = 'paused';
    $('pause').classList.remove('hidden');
    this.ctx.input.exitLock();
    this.ctx.audio.setThruster(0);
  }
  resume() {
    if (this.state !== 'paused') return;
    $('pause').classList.add('hidden');
    this.state = 'battle';
    this.ctx.audio.init();
    this.ctx.input.requestLock();
  }

  // 招牌动作「最后射击」的镜头：先从右前方拍举枪的奇魔猪，再切到身后看光束飞出去
  cineLastShot() {
    const ctx = this.ctx, p = ctx.player;
    ctx.rig.playCine(1.95, (t) => {
      const yaw = p.yaw;
      const f = _v.set(Math.sin(yaw), 0, Math.cos(yaw));
      const r = _v2.set(-Math.cos(yaw), 0, Math.sin(yaw));
      if (t < 0.85) {
        // 正前方稍偏左拍脸，步枪举在画面左上方外侧
        const pos = new THREE.Vector3().copy(p.pos).addScaledVector(f, 3.7).addScaledVector(r, -0.5).addScaledVector(UP, 1.3 + t * 0.15);
        const look = new THREE.Vector3().copy(p.pos).addScaledVector(UP, 1.5).addScaledVector(r, 0.35);
        return { pos, look, fov: 48 };
      }
      const pos = new THREE.Vector3().copy(p.pos).addScaledVector(f, -3.3).addScaledVector(r, 2.7).addScaledVector(UP, 1.5);
      return { pos, look: p.aimPoint.clone(), fov: 58 };
    });
  }

  onDragonDefeated() {
    if (this.state !== 'battle') return;
    const ctx = this.ctx;
    this.state = 'victory';
    this.victoryTime = this.battleTime;
    this.victoryT = 0;
    ctx.hud.warn(null);
    ctx.hud.toast('巨龙形 MA 击破！', 'gold', 3);
    ctx.player.lock = null;
    const D = ctx.dragon.pos.clone();
    const a0 = Math.atan2(this.camera.position.x - D.x, this.camera.position.z - D.z);
    ctx.rig.playCine(7.5, (t) => {
      const a = a0 + t * 0.22;
      const pos = new THREE.Vector3(D.x + Math.sin(a) * 17, 0, D.z + Math.cos(a) * 17);
      pos.y = Math.max(ctx.world.heightAt(pos.x, pos.z) + 3.5, D.y + 4.5 + t * 0.4);
      if (t > 3.8 && !this.comet) this.launchComet();
      return { pos, look: new THREE.Vector3(D.x, D.y + 2.2, D.z), fov: 55 };
    }, () => this.showResult(true));
  }

  // 彩蛋：远处天空划过一道红色彗星
  launchComet() {
    const cam = this.camera;
    const f = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    this.comet = { t: 0, from: cam.position.clone().addScaledVector(f, 90).addScaledVector(r, 80).add(new THREE.Vector3(0, 40, 0)),
      to: cam.position.clone().addScaledVector(f, 70).addScaledVector(r, -90).add(new THREE.Vector3(0, 52, 0)), pos: new THREE.Vector3() };
    this.ctx.hud.toast('远方的云层里，划过一道红色彗星……', 'red', 2.6);
  }
  updateComet(dt) {
    const c = this.comet;
    if (!c || c.t > 2.6) return;
    c.t += dt;
    const k = c.t / 2.6;
    c.pos.lerpVectors(c.from, c.to, k);
    const fx = this.ctx.effects;
    for (let i = 0; i < 4; i++) fx.add.spawn(c.pos.x + rand(-0.4, 0.4), c.pos.y + rand(-0.4, 0.4), c.pos.z + rand(-0.4, 0.4), 0, 0, 0, 3.5, 0.9, 0.5, 3.2, 0.4, 0.9, 1, 0, 0, 2.5, 0.4, 0.1);
    fx.add.spawn(c.pos.x, c.pos.y, c.pos.z, 0, 0, 0, 4, 2.5, 2.2, 5, 4, 0.08, 1, 0, 0);
  }

  showResult(win) {
    if (this.resultShown) return;
    this.resultShown = true;
    const ctx = this.ctx, p = ctx.player, d = ctx.dragon;
    this.state = win ? 'victory' : 'defeat';
    ctx.input.exitLock();
    ctx.hud.show(false);
    const time = win ? this.victoryTime : this.battleTime;
    const mm = Math.floor(time / 60), ss = Math.floor(time % 60);
    const bays = d.bays.filter((b) => b.broken).length;
    const funnels = 12 - d.funnels.aliveCount;
    const acc = p.stats.shots ? Math.round((p.stats.hits / p.stats.shots) * 100) : 0;
    let rank = 'C';
    if (win) {
      const score = (time < 150 ? 2 : time < 240 ? 1 : 0) + (p.damageTaken < 250 ? 2 : p.damageTaken < 600 ? 1 : 0) + (bays === 2 ? 1 : 0) + (funnels >= 8 ? 1 : 0);
      rank = score >= 5 ? 'S' : score >= 3 ? 'A' : 'B';
    }
    $('result-title').textContent = win ? '讨伐成功' : '战斗不能';
    $('result-title').className = win ? 'win' : 'lose';
    $('result-sub').textContent = win ? '巨龙形 MA 倒在了高地草原上' : '奇魔猪倒下了……再来一次吧';
    $('result-stats').innerHTML = `
      <div><span>用时</span><b>${mm}:${String(ss).padStart(2, '0')}</b></div>
      <div><span>受到伤害</span><b>${Math.round(p.damageTaken)}</b></div>
      <div><span>光束步枪命中率</span><b>${acc}%</b></div>
      <div><span>导弹舱破坏</span><b>${bays} / 2</b></div>
      <div><span>浮游炮击坠</span><b>${funnels} / 12</b></div>
      <div><span>巨龙剩余装甲</span><b>${Math.round((d.hp / d.maxHp) * 100)}%</b></div>
      ${win ? `<div class="rank"><span>评价</span><b>${rank}</b></div>` : ''}`;
    $('result').classList.remove('hidden');
  }

  debugView(v) {
    const ctx = this.ctx;
    $('title').classList.add('hidden');
    this.state = 'debug';
    const p = ctx.player, d = ctx.dragon;
    const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    ctx.rig.playCine(9999, () => {
      if (v === 'pig') return { pos: p.pos.clone().addScaledVector(f, 4.2).addScaledVector(r, -0.8).add(new THREE.Vector3(0, 1.5, 0)), look: p.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), fov: 40 };
      if (v === 'pigback') return { pos: p.pos.clone().addScaledVector(f, -4).addScaledVector(r, -1.5).add(new THREE.Vector3(0, 1.8, 0)), look: p.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), fov: 40 };
      const df = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)), dr = new THREE.Vector3(-df.z, 0, df.x);
      if (v === 'dragon') return { pos: d.pos.clone().addScaledVector(df, 13).addScaledVector(dr, 10).add(new THREE.Vector3(0, 4.5, 0)), look: d.pos.clone().add(new THREE.Vector3(0, 3.2, 0)), fov: 50 };
      if (v === 'dragonside') return { pos: d.pos.clone().addScaledVector(dr, 19).add(new THREE.Vector3(0, 3.5, 0)), look: d.pos.clone().add(new THREE.Vector3(0, 3.2, 0)), fov: 50 };
      return { pos: p.pos.clone().addScaledVector(f, -6).add(new THREE.Vector3(0, 2.4, 0)), look: d.pos.clone().add(new THREE.Vector3(0, 3, 0)), fov: 60 };
    });
  }

  updateTitleCamera(dt) {
    const ctx = this.ctx;
    this.titleT += dt;
    const P = ctx.player.pos, D = ctx.dragon.pos;
    const mid = _v.lerpVectors(P, D, 0.35);
    const a = Math.atan2(P.x - D.x, P.z - D.z) + 0.55 + Math.sin(this.titleT * 0.07) * 0.35;
    const cam = this.camera;
    cam.position.set(mid.x + Math.sin(a) * 26, 0, mid.z + Math.cos(a) * 26);
    cam.position.y = Math.max(ctx.world.heightAt(cam.position.x, cam.position.z) + 3.0, P.y + 2.5);
    cam.lookAt(_v2.copy(D).add(_v3.set(0, 3.2, 0)).lerp(P, 0.3));
    if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
  }

  frame() {
    const ctx = this.ctx;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT > 0.5) { $('fps').textContent = `${Math.round(this.fpsN / this.fpsT)} FPS`; this.fpsT = 0; this.fpsN = 0; }
    if (this.frozen) { ctx.input.endFrame(); return; }
    this.tick(dt);
    this.render();
    ctx.input.endFrame();
  }

  // 测试用：把奇魔猪放到 (x, z)，面朝巨龙
  debugPlace(x, z) {
    const p = this.ctx.player, d = this.ctx.dragon.pos;
    p.pos.set(x, this.ctx.world.groundAt(x, z), z); p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(d.x - x, d.z - z);
    this.ctx.rig.snapBehind(p); this.ctx.rig.pivot.copy(p.pos).y += 1.65;
    return 'placed';
  }
  // 测试用：固定镜头绕着巨龙（角度相对巨龙朝向，0 = 正前方），战斗照常进行
  debugCamDragon(angleDeg, dist, height, fov = 50) {
    const d = this.ctx.dragon;
    this.ctx.rig.playCine(9999, () => {
      const a = d.yaw + (angleDeg * Math.PI) / 180;
      const pos = new THREE.Vector3(d.pos.x + Math.sin(a) * dist, d.pos.y + height, d.pos.z + Math.cos(a) * dist);
      return { pos, look: new THREE.Vector3(d.pos.x, d.pos.y + 3.2, d.pos.z), fov };
    });
    return 'cam';
  }

  // 测试用：按固定步长推进 sec 秒（不受帧率影响），然后渲染一帧
  advance(sec, step = 1 / 30) {
    this.frozen = true;
    const n = Math.max(1, Math.round(sec / step));
    for (let i = 0; i < n; i++) { this.tick(step); this.ctx.input.endFrame(); }
    this.render();
    return `${this.state} t=${this.battleTime.toFixed(2)} act=${this.ctx.dragon.action ? this.ctx.dragon.action.type + ':' + this.ctx.dragon.action.phase : '-'}`;
  }

  tick(dt) {
    const ctx = this.ctx;
    if (this.state === 'paused') return;
    let gdt = dt;
    if (ctx.effects.hitStop > 0) { ctx.effects.hitStop -= dt; gdt = dt * 0.06; }
    const st = this.state;
    const battle = st === 'battle' || st === 'victory' || st === 'defeat';
    const controls = st === 'battle' && !ctx.rig.cine;
    if (st === 'battle') this.battleTime += dt;
    if (st === 'victory') { this.victoryT += dt; if (this.victoryT > 1.6) ctx.hud.show(false); }
    if (this.god) ctx.player.hp = ctx.player.maxHp;
    ctx.player.update(gdt, ctx.input, controls);
    ctx.dragon.update(gdt, battle || st === 'intro');
    ctx.projectiles.update(gdt);
    ctx.effects.update(gdt, ctx.world.windDir);
    if (st === 'title') this.updateTitleCamera(dt);
    else ctx.rig.update(dt, ctx.input, controls);
    ctx.world.update(dt, ctx.player.pos, this.camera);
    this.updateComet(dt);
    ctx.audio.listener = this.camera.position;
    ctx.audio.setWind(0.5 + ctx.world.gustBoost * 0.5);
    if (st === 'battle' || (st === 'victory' && this.victoryT <= 1.6)) ctx.hud.update(dt);
    if (st === 'battle' && !ctx.player.alive && ctx.player.deadT > 2.6) this.showResult(false);
  }

  render() {
    if (this.Q.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const el = $('loading-msg');
  if (el) el.textContent = '启动失败：' + (e && e.message ? e.message : e);
});
