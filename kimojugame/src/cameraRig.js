// 越肩第三人称镜头：鼠标转向、锁定时自动对准目标、地形和岩石避让、震屏、过场镜头
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3();

export class CameraRig {
  constructor(camera, ctx) {
    this.camera = camera;
    this.ctx = ctx;
    this.yaw = 0; this.pitch = 0.1;
    this.dist = 5.9; this.distTarget = 5.9;
    this.shoulder = 0.85;
    this.pivot = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.fov = 62; this.fovKick = 0;
    this.sens = 1;
    this.cine = null;
    this.blend = 0; // 过场 → 跟随的过渡
    this.blendFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  }

  dirFrom(yaw, pitch, out) {
    const cp = Math.cos(pitch);
    return out.set(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp);
  }

  snapBehind(player) {
    this.yaw = player.yaw; this.pitch = 0.1;
    this.pivot.copy(player.pos).y += 1.65;
  }

  // fn(t) → { pos, look, fov }；t 从 0 到 dur
  playCine(dur, fn, onEnd) {
    this.cine = { t: 0, dur, fn, onEnd };
  }
  endCine(blend = true) {
    if (!this.cine) return;
    const c = this.cine; this.cine = null;
    if (blend) {
      this.blend = 1;
      this.blendFrom.pos.copy(this.camera.position);
      this.camera.getWorldDirection(_v);
      this.blendFrom.look.copy(this.camera.position).addScaledVector(_v, 10);
    }
    if (c.onEnd) c.onEnd();
  }

  update(dt, input, allowControl = true) {
    const ctx = this.ctx, cam = this.camera, world = ctx.world, fx = ctx.effects;
    if (this.cine) {
      const c = this.cine;
      c.t += dt;
      const r = c.fn(Math.min(c.t, c.dur));
      cam.position.copy(r.pos);
      if (fx.shake > 0) cam.position.add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fx.shake * 0.4));
      cam.lookAt(r.look);
      if (r.fov && Math.abs(cam.fov - r.fov) > 0.01) { cam.fov = r.fov; cam.updateProjectionMatrix(); }
      if (c.t >= c.dur) this.endCine(true);
      return;
    }
    const player = ctx.player;
    if (allowControl) {
      const s = 0.0022 * this.sens;
      this.yaw -= input.dx * s;
      this.pitch += input.dy * s;
      this.yaw += (input.down('ArrowLeft') ? 1 : 0) * 2.2 * dt - (input.down('ArrowRight') ? 1 : 0) * 2.2 * dt;
      this.pitch += ((input.down('ArrowDown') ? 1 : 0) - (input.down('ArrowUp') ? 1 : 0)) * 1.4 * dt;
      if (input.wheel) this.distTarget = clamp(this.distTarget + input.wheel * 0.6, 4.2, 11);
    }
    const lock = player.getLockPoint();
    _v2.copy(player.pos); _v2.y += 1.65;
    this.pivot.lerp(_v2, 1 - Math.exp(-18 * dt));
    if (lock) {
      _v.subVectors(lock, this.pivot);
      const horiz = Math.hypot(_v.x, _v.z);
      const desiredYaw = Math.atan2(_v.x, _v.z);
      const desiredPitch = clamp(-Math.atan2(_v.y, horiz) * 0.75 + 0.1, -0.7, 0.65);
      this.yaw = dampAngle(this.yaw, desiredYaw, 6.5, dt);
      this.pitch = damp(this.pitch, desiredPitch, 4, dt);
    }
    this.pitch = clamp(this.pitch, -0.9, 1.05);
    this.dist = damp(this.dist, this.distTarget, 6, dt);
    this.dirFrom(this.yaw, this.pitch, _dir);
    this.forward.copy(_dir);
    _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    // 镜头位置：先放在肩后，再看有没有被地形/岩石挡住
    const pos = _v.copy(this.pivot).addScaledVector(_right, this.shoulder);
    const back = _v2.copy(_dir).negate();
    let d = this.dist;
    const hit = world.raycast(pos, back, d + 0.4, true);
    if (hit < d + 0.4) d = Math.max(1.2, hit - 0.4);
    pos.addScaledVector(back, d);
    const gy = world.heightAt(pos.x, pos.z) + 0.45;
    if (pos.y < gy) pos.y = gy;
    if (this.blend > 0) {
      this.blend = Math.max(0, this.blend - dt * 1.6);
      const k = this.blend * this.blend;
      pos.lerp(this.blendFrom.pos, k);
    }
    cam.position.copy(pos);
    if (fx.shake > 0) cam.position.add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fx.shake * 0.35));
    _v2.copy(pos).addScaledVector(_dir, 20);
    if (this.blend > 0) _v2.lerp(this.blendFrom.look, this.blend * this.blend);
    cam.lookAt(_v2);
    this.fovKick = damp(this.fovKick, 0, 4, dt);
    const fov = lerp(cam.fov, this.fov + this.fovKick, 1 - Math.exp(-10 * dt));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  // 准星射线（屏幕中心）
  aimRay(origin, dir) {
    origin.copy(this.camera.position);
    this.camera.getWorldDirection(dir);
  }
}
