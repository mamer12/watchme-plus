/** Whether the billboard may autoplay a muted preview. Pure. */
export interface PreviewEnv {
  desktop: boolean;
  canHover: boolean;
  saveData: boolean;
  reducedMotion: boolean;
  enabled: boolean;
}

export const PREVIEW_DELAY_MS = 3000;

export function canPreview(env: PreviewEnv): boolean {
  return env.enabled && env.desktop && env.canHover && !env.saveData && !env.reducedMotion;
}
