import type * as THREE from 'three';
import { canvas2d, finish } from '../../engine/render/textures';
import type { PowerUpKind } from '../types';
import { iconSvg } from './icons';

/**
 * Power-up icon rendered from the shared SVG icon set. A letter is drawn
 * immediately so the texture is usable even if the SVG fails to decode.
 */
export function createIconTexture(kind: PowerUpKind, fallbackLetter: string): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = canvas2d(size);
  ctx.font = '900 84px "Segoe UI", system-ui, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fallbackLetter, size / 2, size / 2 + 4);
  const tex = finish(canvas);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 10, 10, size - 20, size - 20);
    tex.needsUpdate = true;
  };
  img.onerror = () => {
    /* keep the letter fallback */
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(kind))}`;
  return tex;
}
