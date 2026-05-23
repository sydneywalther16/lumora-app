import { getCinematicCharacterProfileForUser, type CharacterProfile } from './characterProfiles';

export type SelfLikenessIntensity = 'light' | 'balanced' | 'strong';

export type SelfLikenessDescriptorInput = Partial<Pick<
  CharacterProfile,
  'displayName' | 'name' | 'appearanceSummary' | 'wardrobeTendencies' | 'cinematicStyle' | 'stylePreferences' | 'continuityState'
>> & {
  characterName?: string | null;
  intensity?: SelfLikenessIntensity | null;
  maxWords?: number | null;
};

export type SelfLikenessDescriptorResult = {
  available: boolean;
  descriptor: string | null;
  intensity: SelfLikenessIntensity;
  wordCount: number;
  sourceFields: string[];
};

const DEFAULT_MAX_WORDS = 35;
const fameOrUnsafeTerms = [
  /\bphotoshoots?\b/gi,
  /\bphoto\s*shoots?\b/gi,
  /\binfluencers?\b/gi,
  /\bsuperstars?\b/gi,
  /\bcelebrit(?:y|ies)\b/gi,
  /\bpublic figures?\b/gi,
  /\bmodels?\b/gi,
  /\bglam(?:our|orous)?\b/gi,
  /\bsexy\b/gi,
  /\bseductive\b/gi,
  /\blingerie\b/gi,
  /\bnude\b/gi,
  /\bnaked\b/gi,
  /\bcleavage\b/gi,
];

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function words(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

function limitWords(value: string, maxWords: number) {
  const parts = words(value);
  return parts.length <= maxWords ? value : parts.slice(0, maxWords).join(' ');
}

function displayNameCandidates(input: SelfLikenessDescriptorInput) {
  return [
    input.displayName,
    input.name,
    input.characterName,
    'Sydney',
  ]
    .map((value) => textValue(value))
    .filter(Boolean);
}

function sanitizeDescriptorFragment(value: string, names: string[]) {
  let next = value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[{}<>]/g, ' ');

  for (const name of names) {
    next = next.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '');
  }

  for (const pattern of fameOrUnsafeTerms) {
    next = next.replace(pattern, '');
  }

  return next
    .replace(/\b(public|private)\s+figure\b/gi, '')
    .replace(/\bbody\b/gi, 'features')
    .replace(/\s*[,;]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^(has|is|with)\s+/i, '')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
}

function sourceFragments(input: SelfLikenessDescriptorInput) {
  const style = recordValue(input.stylePreferences);
  const continuity = recordValue(input.continuityState);
  const fragments: Array<{ field: string; text: string }> = [];

  const push = (field: string, value: unknown) => {
    const text = textValue(value);
    if (text) fragments.push({ field, text });
  };

  push('appearanceSummary', input.appearanceSummary);
  push('continuityState.characterAppearance', continuity.characterAppearance);
  push('continuityState.hairstyle', continuity.hairstyle);
  push('stylePreferences.appearanceSummary', style.appearanceSummary);
  push('stylePreferences.hairColor', style.hairColor);
  push('stylePreferences.hairStyle', style.hairStyle);
  push('stylePreferences.eyeColor', style.eyeColor);
  push('stylePreferences.skinTone', style.skinTone);
  push('stylePreferences.facialFeatures', style.facialFeatures);
  push('wardrobeTendencies', input.wardrobeTendencies);
  push('stylePreferences.everydayStyle', style.everydayStyle);
  push('stylePreferences.fashionStyle', style.fashionStyle);
  push('cinematicStyle', input.cinematicStyle);

  return fragments;
}

export function normalizeSelfLikenessIntensity(value: unknown): SelfLikenessIntensity {
  return value === 'light' || value === 'strong' ? value : 'balanced';
}

export function buildSelfLikenessDescriptor(input: SelfLikenessDescriptorInput): SelfLikenessDescriptorResult {
  const intensity = normalizeSelfLikenessIntensity(input.intensity);
  const maxWords = Math.max(12, Math.min(45, Math.round(input.maxWords ?? DEFAULT_MAX_WORDS)));
  const names = displayNameCandidates(input);
  const sourceLimit = intensity === 'light' ? 3 : intensity === 'strong' ? 8 : 5;
  const cleaned: Array<{ field: string; text: string }> = [];

  for (const fragment of sourceFragments(input)) {
    const text = sanitizeDescriptorFragment(fragment.text, names);
    if (text && !cleaned.some((item) => item.text.toLowerCase() === text.toLowerCase())) {
      cleaned.push({ field: fragment.field, text });
    }
    if (cleaned.length >= sourceLimit) break;
  }

  if (!cleaned.length) {
    return {
      available: false,
      descriptor: null,
      intensity,
      wordCount: 0,
      sourceFields: [],
    };
  }

  const rawBody = cleaned
    .map((item) => item.text.replace(/\.$/, ''))
    .join(', ');
  const body = limitWords(sanitizeDescriptorFragment(rawBody, names), Math.max(6, maxWords - 5));
  const descriptor = limitWords(`a recurring cinematic character with ${body}`, maxWords)
    .replace(/\s+([,.])/g, '$1')
    .replace(/,+$/g, '')
    .trim();

  if (!descriptor || descriptor === 'a recurring cinematic character with') {
    return {
      available: false,
      descriptor: null,
      intensity,
      wordCount: 0,
      sourceFields: [],
    };
  }

  return {
    available: true,
    descriptor,
    intensity,
    wordCount: words(descriptor).length,
    sourceFields: cleaned.map((item) => item.field),
  };
}

function capitalizeFirst(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function applySelfLikenessDescriptorToPrompt(basePrompt: string, descriptor: string | null | undefined) {
  if (!descriptor) return basePrompt;
  const replacement = capitalizeFirst(descriptor.trim());
  if (/^A character\b/.test(basePrompt)) {
    return basePrompt.replace(/^A character\b/, replacement);
  }
  if (/^the cast character\b/i.test(basePrompt)) {
    return basePrompt.replace(/^the cast character\b/i, descriptor.trim());
  }
  return `${replacement} ${basePrompt.charAt(0).toLowerCase()}${basePrompt.slice(1)}`;
}

export async function getSelfLikenessDescriptorForCharacter(input: {
  userId: string;
  characterId?: string | null;
  characterName?: string | null;
  intensity?: SelfLikenessIntensity | null;
}) {
  const profile = await getCinematicCharacterProfileForUser(input.userId, input.characterId ?? null);
  if (!profile) {
    return buildSelfLikenessDescriptor({
      characterName: input.characterName,
      intensity: input.intensity,
    });
  }

  return buildSelfLikenessDescriptor({
    ...profile,
    characterName: input.characterName ?? profile.displayName,
    intensity: input.intensity,
  });
}
