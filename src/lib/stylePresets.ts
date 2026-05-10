export const STYLE_PRESETS = [
  'Editorial Drama',
  'Virtual Sitcom',
  'Luxury POV',
  'Cinematic Sunset',
  'Animated Cartoon',
] as const;

export type StylePreset = typeof STYLE_PRESETS[number];

function uniquePresetValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

export function toggleStylePreset(current: string[], preset: string): string[] {
  const normalizedPreset = preset.trim();
  if (!normalizedPreset) return current;

  const exists = current.some((item) => item.toLowerCase() === normalizedPreset.toLowerCase());
  return exists
    ? current.filter((item) => item.toLowerCase() !== normalizedPreset.toLowerCase())
    : uniquePresetValues([...current, normalizedPreset]);
}

export function selectedStylePrompt(selectedStyles: string[], prompt = ''): string {
  const promptLower = prompt.toLowerCase();
  return uniquePresetValues(selectedStyles)
    .filter((style) => !promptLower.includes(style.toLowerCase()))
    .join(', ');
}
