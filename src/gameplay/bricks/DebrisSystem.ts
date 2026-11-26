import * as THREE from 'three';
import { createShardGeometry } from '../../engine/render/geometry';
import { applySurfaceFx } from '../../engine/render/shaders';

/**
 * Pooled, instanced glass shards thrown off by shattered bricks. Shards are
 * flat irregular gems with per-instance non-uniform scale (so one geometry
 * yields many shapes), tumble, and skitter to rest on the studio floor.
 */
export class DebrisSystem {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly shape: Float32Array;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly vPos = new THREE.Vector3();
  private readonly vScale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.shape = new Float32Array(capacity * 3);

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x9a9a9a,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.6,
      flatShading: true,
      envMapIntensity: 1.4,
    });
    applySurfaceFx(material, { glow: 0.5, rim: 1.8 });
    this.mesh = new THREE.InstancedMesh(createShardGeometry(), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.set(0xffffff));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /**
   * @param halfW,halfH area the shards start from (the brick face)
   * @param pushX,pushY bias direction, e.g. the ball's travel direction
   */
  spawn(
    x: number,
    y: number,
    color: THREE.Color,
    count: number,
    speed: number,
    halfW = 0.9,
    halfH = 0.5,
    pushX = 0,
    pushY = 0,
    size = 1,
  ): void {
    for (let n = 0; n < count; n++) {
      // When full, recycle a random live slot instead of dropping the effect.
      const i = this.count < this.capacity ? this.count++ : Math.floor(Math.random() * this.capacity);
      const i3 = i * 3;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pos[i3] = x + (Math.random() - 0.5) * 2 * halfW;
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * 2 * halfH;
      // Shards start behind the play plane and drift away from the camera, so the ball (z = 0) is always
      // drawn in front of them and never hidden by falling glass.
      this.pos[i3 + 2] = -0.7 - Math.random() * 0.5;
      this.vel[i3] = Math.cos(a) * s + pushX * speed * 0.6;
      this.vel[i3 + 1] = Math.sin(a) * s + pushY * speed * 0.6 + 3;
      this.vel[i3 + 2] = -(1 + Math.random() * 3);
      this.rot[i3] = Math.random() * 6;
      this.rot[i3 + 1] = Math.random() * 6;
      this.rot[i3 + 2] = Math.random() * 6;
      this.spin[i3] = (Math.random() - 0.5) * 14;
      this.spin[i3 + 1] = (Math.random() - 0.5) * 14;
      this.spin[i3 + 2] = (Math.random() - 0.5) * 14;
      this.life[i] = 0.7 + Math.random() * 0.6;
      const base = size * (0.3 + Math.random() * 0.4);
      this.shape[i3] = base * (0.7 + Math.random() * 0.6);
      this.shape[i3 + 1] = base * (0.6 + Math.random() * 0.6);
      this.shape[i3 + 2] = base * (0.8 + Math.random() * 0.5);
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** `floorY`: the paddle lane's floor, where shards skitter to rest. */
  update(dt: number, floorY: number): void {
    const { pos, vel, rot, spin, life, shape, mesh } = this;
    const floor = floorY + 0.08;
    let i = 0;
    while (i < this.count) {
      life[i] -= dt;
      const i3 = i * 3;
      if (life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          const l3 = last * 3;
          for (let k = 0; k < 3; k++) {
            pos[i3 + k] = pos[l3 + k];
            vel[i3 + k] = vel[l3 + k];
            rot[i3 + k] = rot[l3 + k];
            spin[i3 + k] = spin[l3 + k];
            shape[i3 + k] = shape[l3 + k];
          }
          life[i] = life[last];
          if (mesh.instanceColor) {
            mesh.getColorAt(last, this.color);
            mesh.setColorAt(i, this.color);
            mesh.instanceColor.needsUpdate = true;
          }
        }
        continue;
      }
      vel[i3 + 1] -= 22 * dt;
      for (let k = 0; k < 3; k++) {
        pos[i3 + k] += vel[i3 + k] * dt;
        rot[i3 + k] += spin[i3 + k] * dt;
      }
      if (pos[i3 + 1] < floor && vel[i3 + 1] < 0) {
        pos[i3 + 1] = floor;
        vel[i3 + 1] *= -0.32;
        vel[i3] *= 0.6;
        vel[i3 + 2] *= 0.6;
        for (let k = 0; k < 3; k++) spin[i3 + k] *= 0.5;
      }
      const s = Math.min(1, life[i] * 2.5);
      this.euler.set(rot[i3], rot[i3 + 1], rot[i3 + 2]);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(
        this.vPos.set(pos[i3], pos[i3 + 1], pos[i3 + 2]),
        this.quat,
        this.vScale.set(shape[i3] * s, shape[i3 + 1] * s, shape[i3 + 2] * s),
      );
      mesh.setMatrixAt(i, this.matrix);
      i++;
    }
    mesh.count = this.count;
    mesh.instanceMatrix.needsUpdate = true;
  }
}
