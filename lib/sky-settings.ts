export const SKYBOX_NAMES = [
  '2litesky', '2starset', '2starysky', '2weird', 'aurora', 'bluesky',
  'bluestar', 'rainsky', 'stormsky', 'sunset', 'yellowsky',
] as const;

export type SkyboxName = (typeof SKYBOX_NAMES)[number];
export const DEFAULT_SKYBOX: SkyboxName = '2starset';

export function isSkyboxName(value: unknown): value is SkyboxName {
  return typeof value === 'string' && (SKYBOX_NAMES as readonly string[]).includes(value);
}

export function resolveSkyboxName(value?: string): SkyboxName {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  return isSkyboxName(name) ? name : DEFAULT_SKYBOX;
}

/** Pick the first available original sky from a map's startup list. */
export function skyboxFromStartScript(script: string): SkyboxName | undefined {
  const names = /^\s*sky_names\s+"([^"]*)"/im.exec(script)?.[1];
  return names?.split(',').map((name) => name.trim().toLowerCase()).find(isSkyboxName);
}
