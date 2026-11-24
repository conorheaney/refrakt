declare module '*.css';

/** Image imports resolve to the asset's URL (Vite). */
declare module '*.webp' {
  const url: string;
  export default url;
}

/** Vite build flags. */
interface ImportMeta {
  readonly env: {
    /** True under `npm run dev`, false in production builds. */
    readonly DEV: boolean;
  };
}
declare module '*.jpg' {
  const url: string;
  export default url;
}
/** Audio imports resolve to the asset's URL (Vite). */
declare module '*.wav' {
  const url: string;
  export default url;
}
declare module '*.mp3' {
  const url: string;
  export default url;
}
