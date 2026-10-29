// 音效全部用 WebAudio 现场合成：只有和画面同步的音效（风声、光束、导弹、爆炸、推进器、咆哮……），没有背景音乐
import { clamp } from './util.js';

export class Sfx {
  constructor() {
    this.ac = null;
    this.muted = false;
    this.last = {};
    this.listener = null; // {x,y,z}
  }

  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ac = new AC(); } catch (e) { this.ac = null; return; }
    const ac = this.ac;
    this.master = ac.createGain(); this.master.gain.value = this.muted ? 0 : 0.6;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ac.destination);
    this.out = ac.createGain(); this.out.gain.value = 1; this.out.connect(this.master);
    this.amb = ac.createGain(); this.amb.gain.value = 0.55; this.amb.connect(this.master);
    const len = ac.sampleRate * 2;
    this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 褐噪声（更沉的风声和轰鸣）
    this.brownBuf = ac.createBuffer(1, len, ac.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.startWind();
    this.startThruster();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ac.currentTime, 0.05);
  }

  get now() { return this.ac.currentTime; }
  ok(name, minGap = 0.03) {
    if (!this.ac || this.muted) return false;
    const t = this.ac.currentTime;
    if (this.last[name] && t - this.last[name] < minGap) return false;
    this.last[name] = t;
    return true;
  }
  distGain(pos, range = 110) {
    if (!pos || !this.listener) return 1;
    const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return clamp(1 - d / range, 0.12, 1) ** 1.3;
  }

  // ---------- 基础积木 ----------
  gain(v = 1, dest = this.out) { const g = this.ac.createGain(); g.gain.value = v; g.connect(dest); return g; }
  env(g, t0, a, peak, dcy) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dcy);
  }
  osc(type, f0, f1, t0, dur, dest) {
    const o = this.ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    o.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  noise(t0, dur, dest, brown = false, loop = false) {
    const s = this.ac.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.loop = loop || dur > 1.8;
    s.connect(dest);
    s.start(t0, Math.random() * 1.5);
    if (!loop) s.stop(t0 + dur + 0.05);
    return s;
  }
  filter(type, f, q = 1, dest) { const f2 = this.ac.createBiquadFilter(); f2.type = type; f2.frequency.value = f; f2.Q.value = q; f2.connect(dest); return f2; }

  // ---------- 环境：风 ----------
  startWind() {
    const ac = this.ac, t = ac.currentTime;
    this.windGain = this.gain(0.0, this.amb);
    const lp = this.filter('lowpass', 520, 0.6, this.windGain);
    const bp = this.filter('bandpass', 380, 0.5, lp);
    this.noise(t, 0, bp, true, true);
    const hp = this.filter('bandpass', 1400, 2.5, this.gain(0.06, this.windGain));
    this.noise(t, 0, hp, false, true);
    this.windLp = lp;
    this.windGain.gain.setTargetAtTime(0.5, t, 1.5);
  }
  setWind(level) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.windGain.gain.setTargetAtTime(0.32 + level * 0.35, t, 0.4);
    this.windLp.frequency.setTargetAtTime(380 + level * 420, t, 0.4);
  }

  // ---------- 推进器 ----------
  startThruster() {
    const t = this.ac.currentTime;
    this.thrGain = this.gain(0, this.out);
    const lp = this.filter('lowpass', 1800, 0.7, this.thrGain);
    const bp = this.filter('bandpass', 650, 0.7, lp);
    this.noise(t, 0, bp, false, true);
    const rum = this.filter('lowpass', 220, 1, this.thrGain);
    this.noise(t, 0, rum, true, true);
  }
  setThruster(level) {
    if (!this.ac) return;
    this.thrGain.gain.setTargetAtTime(this.muted ? 0 : level * 0.42, this.ac.currentTime, 0.06);
  }

  // ---------- 奇魔猪 ----------
  rifle() {
    if (!this.ok('rifle', 0.04)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.003, 0.22, 0.17);
    const lp = this.filter('lowpass', 3800, 1, g);
    lp.frequency.setValueAtTime(3800, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    this.osc('square', 1500, 240, t, 0.15, lp);
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.1, 0.09);
    this.osc('sine', 3200, 700, t, 0.09, g2);
    const g3 = this.gain(1); this.env(g3, t, 0.001, 0.14, 0.06);
    this.noise(t, 0.08, this.filter('highpass', 2500, 0.7, g3));
  }
  bazooka() {
    if (!this.ok('bazooka', 0.1)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.005, 0.8, 0.45);
    this.osc('sine', 140, 38, t, 0.45, g);
    const g2 = this.gain(1); this.env(g2, t, 0.01, 0.5, 0.7);
    this.noise(t, 0.8, this.filter('lowpass', 1400, 0.8, g2));
    const g3 = this.gain(1); this.env(g3, t + 0.05, 0.1, 0.18, 0.9);
    const bp = this.filter('bandpass', 700, 1.2, g3);
    bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.8);
    this.noise(t, 1.0, bp);
  }
  saberOn() {
    if (!this.ok('saberOn', 0.2)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.04, 0.22, 0.4);
    const lp = this.filter('lowpass', 300, 2, g);
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
    this.osc('sawtooth', 85, 95, t, 0.45, lp); this.osc('square', 171, 190, t, 0.45, lp);
  }
  saberSwing(pitch = 1) {
    if (!this.ok('swing', 0.05)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.03, 0.4, 0.3);
    const bp = this.filter('bandpass', 500, 1.6, g);
    bp.frequency.setValueAtTime(450 * pitch, t); bp.frequency.exponentialRampToValueAtTime(2600 * pitch, t + 0.12); bp.frequency.exponentialRampToValueAtTime(600 * pitch, t + 0.32);
    this.noise(t, 0.35, bp);
    const g2 = this.gain(1); this.env(g2, t, 0.02, 0.12, 0.3);
    this.osc('sawtooth', 120 * pitch, 175 * pitch, t, 0.3, this.filter('lowpass', 900, 1, g2));
  }
  saberHit() {
    if (!this.ok('saberHit', 0.04)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.002, 0.5, 0.25);
    this.osc('sine', 260, 70, t, 0.25, g);
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.35, 0.35);
    this.noise(t, 0.4, this.filter('highpass', 3000, 0.8, g2));
    const g3 = this.gain(1); this.env(g3, t, 0.002, 0.25, 0.12);
    this.noise(t, 0.15, this.filter('bandpass', 1300, 1.5, g3));
  }
  boltHit(pos) {
    if (!this.ok('boltHit', 0.03)) return;
    const t = this.now, k = this.distGain(pos);
    const g = this.gain(1); this.env(g, t, 0.002, 0.22 * k, 0.1);
    this.noise(t, 0.12, this.filter('bandpass', 2600, 2, g));
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.08 * k, 0.12);
    this.osc('sine', 1900, 900, t, 0.12, g2);
  }
  block() {
    if (!this.ok('block', 0.05)) return;
    const t = this.now;
    for (const [f, d, v] of [[620, 0.55, 0.22], [1340, 0.38, 0.14], [2230, 0.25, 0.09], [3170, 0.15, 0.05]]) {
      const g = this.gain(1); this.env(g, t, 0.002, v, d);
      this.osc('sine', f, f * 0.98, t, d, g);
    }
    const g = this.gain(1); this.env(g, t, 0.001, 0.25, 0.08);
    this.noise(t, 0.1, this.filter('highpass', 1800, 0.7, g));
  }
  hurt() {
    if (!this.ok('hurt', 0.08)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.003, 0.45, 0.22);
    this.osc('square', 320, 110, t, 0.22, this.filter('lowpass', 1200, 1, g));
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.3, 0.15);
    this.noise(t, 0.18, this.filter('bandpass', 1600, 1.2, g2));
  }
  step() {
    if (!this.ok('step', 0.12)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.002, 0.06, 0.06);
    this.osc('triangle', 430, 210, t, 0.06, g);
  }
  land(strength = 1) {
    if (!this.ok('land', 0.1)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.003, 0.2 * strength, 0.14);
    this.osc('triangle', 260, 110, t, 0.14, g);
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.15 * strength, 0.2);
    this.noise(t, 0.22, this.filter('lowpass', 700, 1, g2));
  }
  dash() {
    if (!this.ok('dash', 0.1)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.01, 0.4, 0.35);
    const bp = this.filter('bandpass', 1400, 0.9, g);
    bp.frequency.setValueAtTime(1600, t); bp.frequency.exponentialRampToValueAtTime(320, t + 0.35);
    this.noise(t, 0.4, bp);
  }
  lockOn() {
    if (!this.ok('lock', 0.1)) return;
    const t = this.now;
    for (const [f, dt] of [[1250, 0], [1700, 0.07]]) {
      const g = this.gain(1); this.env(g, t + dt, 0.003, 0.08, 0.06);
      this.osc('sine', f, f, t + dt, 0.07, g);
    }
  }
  warning() {
    if (!this.ok('warn', 0.5)) return;
    const t = this.now;
    for (const dt of [0, 0.16]) {
      const g = this.gain(1); this.env(g, t + dt, 0.005, 0.07, 0.1);
      this.osc('square', 880, 880, t + dt, 0.11, this.filter('lowpass', 2500, 1, g));
    }
  }
  special() {
    if (!this.ok('special', 0.5)) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t, 0.3, 0.25, 0.6);
    const lp = this.filter('lowpass', 400, 3, g);
    lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(5000, t + 0.8);
    this.osc('sawtooth', 110, 440, t, 0.9, lp); this.osc('sawtooth', 165, 660, t, 0.9, lp);
  }

  // ---------- 巨龙 ----------
  explosion(pos, size = 1) {
    if (!this.ok('expl', 0.05)) return;
    const t = this.now, k = this.distGain(pos, 140) * clamp(size, 0.3, 2);
    const g = this.gain(1); this.env(g, t, 0.006, 0.75 * k, 1.1 + size * 0.4);
    const lp = this.filter('lowpass', 2200, 0.7, g);
    lp.frequency.setValueAtTime(2000 + size * 600, t); lp.frequency.exponentialRampToValueAtTime(110, t + 1.2 + size * 0.3);
    this.noise(t, 1.8, lp, false);
    const g2 = this.gain(1); this.env(g2, t, 0.004, 0.75 * k, 0.55);
    this.osc('sine', 95, 32, t, 0.55, g2);
    const g3 = this.gain(1); this.env(g3, t, 0.01, 0.5 * k, 1.4);
    this.noise(t, 1.6, this.filter('lowpass', 260, 0.8, g3), true);
  }
  missileLaunch(pos) {
    if (!this.ok('mlaunch', 0.06)) return;
    const t = this.now, k = this.distGain(pos);
    const g = this.gain(1); this.env(g, t, 0.02, 0.22 * k, 0.6);
    const bp = this.filter('bandpass', 900, 1.4, g);
    bp.frequency.setValueAtTime(800, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
    this.noise(t, 0.7, bp);
    const g2 = this.gain(1); this.env(g2, t, 0.01, 0.05 * k, 0.5);
    this.osc('sawtooth', 220, 700, t, 0.5, this.filter('lowpass', 1800, 1, g2));
  }
  hatch(pos) {
    if (!this.ok('hatch', 0.05)) return;
    const t = this.now, k = this.distGain(pos);
    const g = this.gain(1); this.env(g, t, 0.002, 0.2 * k, 0.06);
    this.osc('square', 1000, 500, t, 0.06, this.filter('bandpass', 1500, 2, g));
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.18 * k, 0.12);
    this.noise(t, 0.12, this.filter('bandpass', 3200, 3, g2));
  }
  stomp(pos, big = false) {
    if (!this.ok(big ? 'stompB' : 'stomp', big ? 0.1 : 0.06)) return;
    const t = this.now, k = this.distGain(pos, 120) * (big ? 1.4 : 0.8);
    const g = this.gain(1); this.env(g, t, 0.004, 0.65 * k, big ? 0.7 : 0.35);
    this.osc('sine', big ? 85 : 72, 30, t, big ? 0.7 : 0.35, g);
    const g2 = this.gain(1); this.env(g2, t, 0.003, 0.3 * k, 0.25);
    this.noise(t, 0.3, this.filter('lowpass', big ? 700 : 420, 1, g2), true);
    const g3 = this.gain(1); this.env(g3, t + 0.02, 0.002, 0.07 * k, 0.18);
    this.osc('square', 310, 260, t + 0.02, 0.18, this.filter('bandpass', 950, 4, g3));
    // 液压声
    const g4 = this.gain(1); this.env(g4, t + 0.05, 0.03, 0.06 * k, 0.3);
    this.noise(t + 0.05, 0.35, this.filter('highpass', 4500, 0.8, g4));
  }
  roar(pos) {
    if (!this.ok('roar', 1.0)) return;
    const t = this.now, k = this.distGain(pos, 200);
    const g = this.gain(1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * k, t + 0.18);
    g.gain.setValueAtTime(0.5 * k, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    const f1 = this.filter('bandpass', 420, 2, g), f2 = this.filter('bandpass', 950, 3, g);
    const lfo = this.ac.createOscillator(); lfo.frequency.value = 7.5;
    const lfoG = this.ac.createGain(); lfoG.gain.value = 9; lfo.connect(lfoG);
    for (const [f0, f1v] of [[78, 52], [117, 79], [156, 101]]) {
      const o = this.ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.85, t); o.frequency.linearRampToValueAtTime(f0, t + 0.25); o.frequency.exponentialRampToValueAtTime(f1v, t + 2.0);
      lfoG.connect(o.frequency);
      o.connect(f1); o.connect(f2); o.start(t); o.stop(t + 2.2);
    }
    lfo.start(t); lfo.stop(t + 2.2);
    const gn = this.gain(1);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.3 * k, t + 0.2); gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    this.noise(t, 2.1, this.filter('bandpass', 650, 1.2, gn));
    // 金属共鸣
    const gm = this.gain(1); this.env(gm, t + 0.1, 0.3, 0.05 * k, 1.6);
    this.osc('square', 233, 180, t + 0.1, 1.9, this.filter('bandpass', 1800, 6, gm));
  }
  // 主炮蓄能：返回句柄，stop() 渐弱
  beamCharge(pos, dur = 1.5) {
    if (!this.ac || this.muted) return { stop() {} };
    const t = this.now, k = this.distGain(pos, 160);
    const g = this.gain(0.0001);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * k, t + dur);
    const lp = this.filter('lowpass', 400, 4, g);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(4500, t + dur);
    const o1 = this.ac.createOscillator(); o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(55, t); o1.frequency.exponentialRampToValueAtTime(420, t + dur);
    const o2 = this.ac.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(110, t); o2.frequency.exponentialRampToValueAtTime(880, t + dur);
    const lfo = this.ac.createOscillator(); lfo.frequency.setValueAtTime(5, t); lfo.frequency.linearRampToValueAtTime(22, t + dur);
    const lg = this.ac.createGain(); lg.gain.value = 0.1 * k; lfo.connect(lg); lg.connect(g.gain);
    o1.connect(lp); o2.connect(lp);
    o1.start(t); o2.start(t); lfo.start(t);
    const end = t + dur + 3;
    o1.stop(end); o2.stop(end); lfo.stop(end);
    return {
      stop: () => {
        const n = this.ac.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0.0001, n, 0.05);
        try { o1.stop(n + 0.3); o2.stop(n + 0.3); lfo.stop(n + 0.3); } catch (e) { /* 已停止 */ }
      },
    };
  }
  beamFire(pos) {
    if (!this.ac || this.muted) return { stop() {} };
    const t = this.now, k = this.distGain(pos, 160);
    this.explosion(pos, 1.3);
    const g = this.gain(0.0001);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55 * k, t + 0.06);
    const rum = this.noise(t, 0, this.filter('lowpass', 900, 0.8, g), true, true);
    const sizz = this.noise(t, 0, this.filter('highpass', 4200, 0.7, this.gain(0.18, g)), false, true);
    const o = this.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58;
    const trem = this.ac.createOscillator(); trem.frequency.value = 23;
    const tg = this.ac.createGain(); tg.gain.value = 0.12; trem.connect(tg);
    const og = this.gain(0.22, g); tg.connect(og.gain);
    o.connect(this.filter('lowpass', 600, 1, og));
    o.start(t); trem.start(t);
    return {
      stop: () => {
        const n = this.ac.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0.0001, n, 0.12);
        try { rum.stop(n + 0.8); sizz.stop(n + 0.8); o.stop(n + 0.8); trem.stop(n + 0.8); } catch (e) { /* 已停止 */ }
      },
    };
  }
  funnelLaunch(pos) {
    if (!this.ok('fLaunch', 0.05)) return;
    const t = this.now, k = this.distGain(pos);
    const g = this.gain(1); this.env(g, t, 0.01, 0.06 * k, 0.3);
    this.osc('sine', 600, 1900, t, 0.3, g);
    const g2 = this.gain(1); this.env(g2, t, 0.005, 0.1 * k, 0.15);
    this.noise(t, 0.16, this.filter('bandpass', 2500, 1.5, g2));
  }
  funnelCharge(pos) {
    if (!this.ok('fCharge', 0.08)) return;
    const t = this.now, k = this.distGain(pos, 80);
    const g = this.gain(1); this.env(g, t, 0.35, 0.05 * k, 0.12);
    this.osc('sine', 900, 2100, t, 0.47, g);
  }
  funnelShot(pos) {
    if (!this.ok('fShot', 0.04)) return;
    const t = this.now, k = this.distGain(pos, 90);
    const g = this.gain(1); this.env(g, t, 0.003, 0.14 * k, 0.16);
    const o = this.osc('square', 2600, 1100, t, 0.16, this.filter('lowpass', 5000, 1, g));
    const lfo = this.ac.createOscillator(); lfo.frequency.value = 60;
    const lg = this.ac.createGain(); lg.gain.value = 300; lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(t); lfo.stop(t + 0.2);
    const g2 = this.gain(1); this.env(g2, t, 0.002, 0.08 * k, 0.12);
    this.noise(t, 0.13, this.filter('highpass', 3500, 0.7, g2));
  }
  partBreak(pos) {
    this.explosion(pos, 1.8);
    if (!this.ac || this.muted) return;
    const t = this.now;
    const g = this.gain(1); this.env(g, t + 0.05, 0.05, 0.25, 1.0);
    const bp = this.filter('bandpass', 3000, 2, g);
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(600, t + 1.0);
    this.noise(t, 1.1, bp);
  }
}
