import * as THREE from 'three';
import { WALL_Z } from '../../gameplay/config';

/** Wall-torch light per unit of flicker (Environment.setTorches): kept low so bricks keep their colours. */
const TORCH_LIGHT = 90;

/** A small emissive "studio" used to bake the reflection environment: warm left, cool right, softbox above. */
function createStudioEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(80, 40, 80),
    new THREE.MeshBasicMaterial({ color: 0x23272e, side: THREE.BackSide }),
  );
  room.position.y = 8;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x4a4d52 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -10;
  scene.add(floor);
  const panel = (
    w: number,
    h: number,
    color: THREE.Color,
    pos: [number, number, number],
    rot: [number, number, number],
  ): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    scene.add(m);
  };
  panel(26, 18, new THREE.Color(1, 0.42, 0.12).multiplyScalar(7), [-38, 4, 4], [0, Math.PI / 2, 0]);
  panel(22, 16, new THREE.Color(0.32, 0.55, 1).multiplyScalar(4.5), [38, 4, 2], [0, -Math.PI / 2, 0]);
  panel(40, 12, new THREE.Color(1, 0.97, 0.92).multiplyScalar(5), [0, 27, 0], [Math.PI / 2, 0, 0]);
  panel(70, 26, new THREE.Color(0.55, 0.56, 0.6), [0, 4, 39], [0, Math.PI, 0]);
  panel(46, 3, new THREE.Color(1, 1, 1).multiplyScalar(6), [0, 10, 38], [0, Math.PI, 0]);
  panel(18, 10, new THREE.Color(1, 0.6, 0.3).multiplyScalar(2), [-20, 2, 36], [0, Math.PI, 0]);
  panel(18, 10, new THREE.Color(0.5, 0.65, 1).multiplyScalar(1.6), [22, 2, 36], [0, Math.PI, 0]);
  return scene;
}

/**
 * Everything around the playfield that every world shares: the lights, the reflection environment the bricks,
 * ball and paddle mirror, and the world's scenery, which is its uploaded background image (a plain dark
 * backdrop until one is set).
 */
export class Environment {
  readonly ballLight = new THREE.PointLight(0xff7a2a, 0, 12, 2);

  private uploadedBackground: THREE.Texture | null = null;
  private backdropAspect = 16 / 9;
  private readonly background = new THREE.Color(0x05070d);

  private readonly keyLight = new THREE.DirectionalLight(0xfff4ea, 1.25);
  private readonly warmKey = new THREE.DirectionalLight(0xff8a3c, 2.2);
  private readonly coolFill = new THREE.DirectionalLight(0x6f9dff, 1.2);
  private readonly warmPool = new THREE.PointLight(0xff8a3c, 700, 34, 2);
  private readonly coolPool = new THREE.PointLight(0x3f7dff, 420, 30, 2);
  /** Cold light from above for lightning (themes/weather/rain/RainLayer.ts). Always in the scene, dark until a strike. */
  private readonly lightning = new THREE.DirectionalLight(0xd8e6ff, 0);
  /** Warm light from the wall torches either side, for tomb dust (themes/weather/dust/TombDustLayer.ts). Dark elsewhere. */
  private readonly torchLeft = new THREE.PointLight(0xff8a3a, 0, 34, 2);
  private readonly torchRight = new THREE.PointLight(0xff8a3a, 0, 34, 2);
  private lightningFlash = 0;
  private torchFlare = 0;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = createStudioEnvScene();
    scene.environment = pmrem.fromScene(envScene, 0.035).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    scene.background = this.background;
    this.lightning.position.set(-8, 20, 14);
    scene.add(this.lightning);
    this.torchLeft.position.set(-17, 2.5, 3);
    this.torchRight.position.set(17, 2.5, 3);
    scene.add(this.torchLeft, this.torchRight);
    this.createLights(scene);
  }

  private createLights(scene: THREE.Scene): void {
    scene.add(new THREE.HemisphereLight(0xc8d4ea, 0x3a332e, 0.22));

    // Soft key light from above the camera. High enough that its specular hotspot on the bricks' upper
    // facets lands above the brick field.
    const key = this.keyLight;
    key.position.set(-3.5, 22, 34);
    key.target.position.set(0, 0, WALL_Z);
    scene.add(key, key.target);

    this.warmKey.position.set(-30, 6, 12);
    this.coolFill.position.set(30, 4, 14);
    this.warmPool.position.set(-24, 0, 6);
    this.coolPool.position.set(24, -2, 6);
    scene.add(this.warmKey, this.coolFill, this.warmPool, this.coolPool, this.ballLight);
  }

  /** The world's uploaded background image, drawn behind everything (null for the plain dark backdrop). */
  setBackdrop(texture: THREE.Texture | null): void {
    this.uploadedBackground = texture;
    this.resizeBackdrop(this.backdropAspect);
    this.scene.background = texture ?? this.background;
  }

  /**
   * A lightning flash, 0-1: brightens the uploaded backdrop and lights the playfield from above. Kept
   * moderate so the ball still stands out at the peak of a flash.
   */
  setLightning(flash: number): void {
    this.lightningFlash = flash;
    this.lightning.intensity = flash * 3.8;
    this.applyBackgroundIntensity();
  }

  /**
   * The tomb's wall torches (themes/weather/dust/TombDustLayer.ts): `left` and `right` are each torch's light, about 0.4-1.4
   * (0 turns them off), and `flare` 0-1 how bright a torch flare is, which also warms the backdrop a little.
   */
  setTorches(left: number, right: number, flare: number): void {
    this.torchLeft.intensity = left * TORCH_LIGHT;
    this.torchRight.intensity = right * TORCH_LIGHT;
    this.torchFlare = flare;
    this.applyBackgroundIntensity();
  }

  private applyBackgroundIntensity(): void {
    this.scene.backgroundIntensity = 1 + this.lightningFlash * 1.15 + this.torchFlare * 0.05;
  }

  /** Cover the adaptive 16:9–4:3 stage without stretching the uploaded artwork. */
  resizeBackdrop(aspect: number): void {
    this.backdropAspect = aspect;
    const texture = this.uploadedBackground;
    if (!texture) return;
    const image = texture.image as { width: number; height: number };
    const imageAspect = image.width / image.height;
    const x = Math.min(1, aspect / imageAspect);
    const y = Math.min(1, imageAspect / aspect);
    texture.repeat.set(x, y);
    texture.offset.set((1 - x) / 2, (1 - y) / 2);
  }
}
