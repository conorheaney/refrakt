import { PowerUpKind } from '../types';

let uid = 0;

/**
 * Glossy, slightly 3D icons for the eight power-ups, drawn as self-contained
 * SVG (64 x 64 view box). Every call gets unique gradient ids so several
 * copies can live in the DOM at once, including hidden ones.
 */
export function iconSvg(kind: PowerUpKind): string {
  const id = `ri${uid++}`;
  const gloss = `<radialGradient id="${id}g" cx="0.35" cy="0.2" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  const wrap = (defs: string, body: string): string =>
    `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${gloss}${defs}</defs>${body}</svg>`;
  const lin = (name: string, a: string, b: string, x2 = 0, y2 = 1): string =>
    `<linearGradient id="${id}${name}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

  switch (kind) {
    case PowerUpKind.Fire: // rocket
      return wrap(
        lin('b', '#fff6c9', '#ffb21f', 1, 1) +
          lin('f', '#ff8a2b', '#d9361a') +
          lin('w', '#9fe3ff', '#2a7de0') +
          lin('x', '#fff3a0', '#ff7a1a'),
        `<g transform="rotate(45 32 32)">
          <path d="M26 47 L32 60 L38 47 Z" fill="url(#${id}x)"/>
          <path d="M22 38 L14 48 L24 46 Z M42 38 L50 48 L40 46 Z" fill="url(#${id}f)"/>
          <path d="M32 4 C42 14 43 30 40 46 L24 46 C21 30 22 14 32 4 Z" fill="url(#${id}b)"/>
          <path d="M32 4 C42 14 43 30 40 46 L35 46 C38 30 37 14 32 4 Z" fill="#e2850f" opacity="0.45"/>
          <circle cx="32" cy="24" r="5.5" fill="url(#${id}w)" stroke="#fff" stroke-width="1.5"/>
          <path d="M32 4 C27 9 25 15 24.5 22" stroke="#fff" stroke-width="2" fill="none" opacity="0.8"/>
        </g>`,
      );
    case PowerUpKind.Laser: // lightning bolt
      return wrap(
        lin('b', '#fff7b0', '#ffb000') + lin('s', '#ffd23b', '#e07800', 1, 1),
        `<path d="M37 4 L15 36 L29 36 L24 60 L49 25 L34 25 L41 4 Z" fill="url(#${id}s)" transform="translate(1.5 1.5)" opacity="0.5"/>
         <path d="M37 4 L15 36 L29 36 L24 60 L49 25 L34 25 L41 4 Z" fill="url(#${id}b)" stroke="#fff3c4" stroke-width="1.2" stroke-linejoin="round"/>
         <path d="M37 6 L19 33 L27 33 Z" fill="url(#${id}g)"/>`,
      );
    case PowerUpKind.Magnet:
      return wrap(
        lin('r', '#ff6f7d', '#c8102e') + lin('t', '#ffffff', '#b8c6d8'),
        `<path d="M12 10 L24 10 L24 34 A8 8 0 0 0 40 34 L40 10 L52 10 L52 34 A20 20 0 0 1 12 34 Z" fill="url(#${id}r)" stroke="#ffb3bb" stroke-width="1"/>
         <rect x="12" y="6" width="12" height="9" rx="2" fill="url(#${id}t)"/>
         <rect x="40" y="6" width="12" height="9" rx="2" fill="url(#${id}t)"/>
         <path d="M14 16 L14 34 A18 18 0 0 0 22 49" stroke="#fff" stroke-width="2.5" fill="none" opacity="0.55" stroke-linecap="round"/>`,
      );
    case PowerUpKind.Multi: // dotted cluster
      return wrap(
        `<radialGradient id="${id}c" cx="0.4" cy="0.35" r="0.65"><stop offset="0" stop-color="#e6fbff"/><stop offset="0.45" stop-color="#4fc3ff"/><stop offset="1" stop-color="#1557c9"/></radialGradient>`,
        `<circle cx="32" cy="32" r="10" fill="url(#${id}c)"/>
         ${[0, 1, 2, 3, 4, 5, 6, 7]
           .map((i) => {
             const a = (i / 8) * Math.PI * 2;
             const r = i % 2 === 0 ? 20 : 19;
             const s = i % 2 === 0 ? 5.2 : 3.6;
             return `<circle cx="${(32 + Math.cos(a) * r).toFixed(1)}" cy="${(32 + Math.sin(a) * r).toFixed(1)}" r="${s}" fill="url(#${id}c)"/>`;
           })
           .join('')}
         <circle cx="29" cy="28" r="4" fill="url(#${id}g)"/>`,
      );
    case PowerUpKind.Expand: // widen arrows
      return wrap(
        lin('b', '#c9ffe0', '#1fbf63') + lin('d', '#7dffb0', '#0f8a45'),
        `<rect x="18" y="26" width="28" height="12" rx="4" fill="url(#${id}d)"/>
         <path d="M4 32 L18 18 L18 46 Z M60 32 L46 18 L46 46 Z" fill="url(#${id}b)" stroke="#e9fff1" stroke-width="1.2" stroke-linejoin="round"/>
         <rect x="20" y="27" width="24" height="4" rx="2" fill="#fff" opacity="0.6"/>`,
      );
    case PowerUpKind.Slow: // stopwatch
      return wrap(
        lin('b', '#b8d4ff', '#3e63e0') + lin('f', '#ffffff', '#dbe6ff'),
        `<rect x="27" y="4" width="10" height="7" rx="2" fill="url(#${id}b)"/>
         <circle cx="32" cy="36" r="22" fill="url(#${id}b)"/>
         <circle cx="32" cy="36" r="16" fill="url(#${id}f)"/>
         <path d="M32 36 L32 24 M32 36 L41 41" stroke="#2c48b8" stroke-width="3.5" stroke-linecap="round"/>
         <circle cx="32" cy="36" r="2.5" fill="#2c48b8"/>
         <ellipse cx="25" cy="24" rx="9" ry="6" fill="url(#${id}g)"/>`,
      );
    case PowerUpKind.Shield:
      return wrap(
        lin('b', '#c4fff6', '#16b3b0') + lin('i', '#3fe0d0', '#0b6f7a'),
        `<path d="M32 4 L54 12 L54 30 C54 46 44 55 32 60 C20 55 10 46 10 30 L10 12 Z" fill="url(#${id}b)" stroke="#e8fffb" stroke-width="1.2"/>
         <path d="M32 12 L46 17 L46 30 C46 41 40 47 32 51 Z" fill="url(#${id}i)" opacity="0.8"/>
         <path d="M14 14 L32 7 L32 30 L14 30 Z" fill="url(#${id}g)"/>`,
      );
    case PowerUpKind.Life:
    default:
      return wrap(
        lin('b', '#ffb3a6', '#f0453a'),
        `<path d="M32 56 C14 43 6 33 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 33 50 43 32 56 Z" fill="url(#${id}b)" stroke="#ffd6cf" stroke-width="1.2"/>
         <ellipse cx="20" cy="19" rx="8" ry="6" fill="url(#${id}g)"/>`,
      );
  }
}

/** Heart glyph for the lives display; `filled` hearts are coral, lost ones white. */
export function heartSvg(): string {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M32 56 C14 43 6 33 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 33 50 43 32 56 Z"/></svg>`;
}
