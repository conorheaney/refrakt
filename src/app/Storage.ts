import type { Quality } from '../engine/render/Renderer';

export type { Quality };

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  /** Ambience and other background sound (rain, thunder). */
  ambienceVolume: number;
  quality: Quality;
  screenShake: boolean;
}

const SETTINGS_KEY = 'refrakt.settings.v1';
const HISCORE_KEY = 'refrakt.hiscore.v1';

const DEFAULTS: Settings = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  quality: 'high',
  screenShake: true,
};

function isQuality(v: unknown): v is Quality {
  return v === 'low' || v === 'medium' || v === 'high';
}

function unitOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

/** localStorage persistence that tolerates private mode, quota and corrupt data. */
export const Storage = {
  loadSettings(): Settings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULTS };
      const data = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
      return {
        musicVolume: unitOr(data.musicVolume, DEFAULTS.musicVolume),
        sfxVolume: unitOr(data.sfxVolume, DEFAULTS.sfxVolume),
        ambienceVolume: unitOr(data.ambienceVolume, DEFAULTS.ambienceVolume),
        quality: isQuality(data.quality) ? data.quality : DEFAULTS.quality,
        screenShake: typeof data.screenShake === 'boolean' ? data.screenShake : DEFAULTS.screenShake,
      };
    } catch {
      return { ...DEFAULTS };
    }
  },

  saveSettings(settings: Settings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings simply stay session-only */
    }
  },

  loadHighScore(): number {
    try {
      const v = Number(localStorage.getItem(HISCORE_KEY));
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch {
      return 0;
    }
  },

  saveHighScore(score: number): void {
    try {
      localStorage.setItem(HISCORE_KEY, String(Math.floor(score)));
    } catch {
      /* ignore */
    }
  },
};
