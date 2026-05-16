import { env } from '../lib/env';

export type ProviderPromptSanitizerResult = {
  originalPrompt: string;
  prompt: string;
  changed: boolean;
  displayNameMasked: boolean;
  riskyTermsRemoved: string[];
  socialPhrasesRemoved: string[];
  artifactsRemoved: string[];
};

export type ProviderPromptSanitizerInput = {
  prompt: string;
  characterName?: string | null;
  characterDisplayName?: string | null;
  additionalDisplayNames?: Array<string | null | undefined>;
};

type RewriteRule = {
  pattern: RegExp;
  replacement: string;
  label: string;
};

export const STORYBOOK_GARDEN_PROVIDER_PROMPT =
  'the cast character gently picks flowers in a sunlit bloom garden, peaceful mood, natural movement, fully clothed, storybook cinematic style, soft lighting, gentle camera movement.';

export const STORYBOOK_GARDEN_USER_REWRITE =
  'Storybook cinematic version: the cast character gently picks flowers in a sunlit bloom garden with peaceful movement, soft lighting, and fully clothed styling.';

const displayNameStopwords = new Set([
  'the',
  'and',
  'self',
  'cast',
  'main',
  'user',
  'creator',
  'character',
  'profile',
]);

const riskyProviderPromptRewrites: RewriteRule[] = [
  { pattern: /\bphoto\s*shoot\b/gi, replacement: 'cinematic scene', label: 'photoshoot' },
  { pattern: /\bphotoshoot\b/gi, replacement: 'cinematic scene', label: 'photoshoot' },
  { pattern: /\bmodel\s+posing\b/gi, replacement: 'natural movement', label: 'model posing' },
  { pattern: /\bposing\s+like\s+a\s+model\b/gi, replacement: 'natural movement', label: 'model posing' },
  { pattern: /\bphotorealistic\s+woman\b/gi, replacement: 'cinematic character', label: 'photorealistic woman' },
  { pattern: /\bluxury\s+influencer\b/gi, replacement: 'elegant cinematic figure', label: 'luxury influencer' },
  { pattern: /\brealistic\s+influencer\b/gi, replacement: 'stylized cinematic protagonist', label: 'realistic influencer' },
  { pattern: /\bsuperstar\b/gi, replacement: 'confident protagonist', label: 'superstar' },
  { pattern: /\bglamour\b/gi, replacement: 'elegant cinematic tone', label: 'glamour' },
  { pattern: /\binfluencer\b/gi, replacement: 'creator', label: 'influencer' },
  { pattern: /\bcelebrity\b/gi, replacement: '', label: 'celebrity' },
  { pattern: /\bpublic\s+figure\b/gi, replacement: '', label: 'public figure' },
  { pattern: /\bfamous\s+person\b/gi, replacement: '', label: 'famous person' },
  { pattern: /\bknown\s+person\b/gi, replacement: '', label: 'known person' },
  { pattern: /\bmodel\b/gi, replacement: 'character', label: 'model' },
  { pattern: /\bseductive\b/gi, replacement: 'expressive', label: 'seductive' },
  { pattern: /\bsultry\b/gi, replacement: 'cinematic', label: 'sultry' },
  { pattern: /\bbody[-\s]?focused\b/gi, replacement: 'character-focused', label: 'body-focused' },
];

const socialPhraseRemovalRules: RewriteRule[] = [
  { pattern: /\bhey\s+y['’]?all\b/gi, replacement: '', label: 'hey yall' },
  { pattern: /\bheyy+\s+y['’]?all\b/gi, replacement: '', label: 'hey yall' },
  { pattern: /\bhi\s+y['’]?all\b/gi, replacement: '', label: 'hi yall' },
  { pattern: /\bhey\s+guys\b/gi, replacement: '', label: 'hey guys' },
  { pattern: /\bwhat['’]?s\s+up\b/gi, replacement: '', label: 'whats up' },
  { pattern: /\blike\s+and\s+subscribe\b/gi, replacement: '', label: 'like and subscribe' },
  { pattern: /\bfollow\s+(me|for\s+more)\b/gi, replacement: '', label: 'follow me' },
  { pattern: /\bmy\s+followers\b/gi, replacement: '', label: 'my followers' },
  { pattern: /\bmy\s+fans\b/gi, replacement: '', label: 'my fans' },
  { pattern: /\by['’]?all\b/gi, replacement: '', label: 'yall' },
];

const artifactRemovalRules: RewriteRule[] = [
  { pattern: /(^|[\n\r.?!])\s*render\s*[:,-]?\s*/gi, replacement: '$1 ', label: 'Render' },
  { pattern: /\[\s*render\s*\]/gi, replacement: '', label: 'Render' },
  { pattern: /\bRender\b/g, replacement: '', label: 'Render' },
];

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function displayNameCandidates(displayName?: string | null) {
  if (!displayName) return [];

  const cleaned = displayName
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const parts = cleaned
    .split(/\s+/)
    .map((part) => part.replace(/^[-']+|[-']+$/g, ''))
    .filter((part) => part.length >= 3 && !displayNameStopwords.has(part.toLowerCase()));

  return uniqueValues([cleaned, ...parts]).sort((a, b) => b.length - a.length);
}

function replaceDisplayNames(prompt: string, displayNames: string[]) {
  let nextPrompt = prompt;
  let masked = false;

  for (const displayName of displayNames) {
    for (const candidate of displayNameCandidates(displayName)) {
      const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'gi');
      pattern.lastIndex = 0;
      if (!pattern.test(nextPrompt)) continue;

      masked = true;
      pattern.lastIndex = 0;
      nextPrompt = nextPrompt.replace(pattern, 'the cast character');
    }
  }

  return {
    prompt: nextPrompt
      .replace(/\bthe cast character\s+the cast character\b/gi, 'the cast character')
      .replace(/\bthe cast character's\b/gi, "the cast character's"),
    masked,
  };
}

function applyRules(prompt: string, rules: RewriteRule[]) {
  let nextPrompt = prompt;
  const labels: string[] = [];

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(nextPrompt)) continue;

    labels.push(rule.label);
    rule.pattern.lastIndex = 0;
    nextPrompt = nextPrompt.replace(rule.pattern, rule.replacement);
  }

  return {
    prompt: nextPrompt,
    labels: uniqueValues(labels),
  };
}

function cleanPunctuation(prompt: string) {
  return collapseWhitespace(
    prompt
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/([,;:])\s*([,;:])+/g, '$1')
      .replace(/,\s*([.!?;:])/g, '$1')
      .replace(/([.!?])\s*,/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/\bconfident protagonist\s+elegant cinematic tone\s+creator\b/gi, 'confident protagonist, elegant cinematic tone, creator')
      .replace(/\belegant cinematic tone\s+creator\b/gi, 'elegant cinematic tone, creator')
      .replace(/^\s*[,.;:-]+\s*/g, '')
      .replace(/\s*[,;:-]+\s*$/g, '')
      .replace(/\s+\./g, '.'),
  );
}

export function sanitizeProviderPrompt(input: ProviderPromptSanitizerInput): ProviderPromptSanitizerResult {
  const originalPrompt = input.prompt.trim();
  const displayNames = uniqueValues([
    input.characterName ?? '',
    input.characterDisplayName ?? '',
    ...(input.additionalDisplayNames ?? []).map((value) => value ?? ''),
  ]);

  const nameResult = replaceDisplayNames(originalPrompt, displayNames);
  const riskyResult = applyRules(nameResult.prompt, riskyProviderPromptRewrites);
  const socialResult = applyRules(riskyResult.prompt, socialPhraseRemovalRules);
  const artifactResult = applyRules(socialResult.prompt, artifactRemovalRules);
  const prompt = cleanPunctuation(artifactResult.prompt);

  return {
    originalPrompt,
    prompt,
    changed: prompt !== originalPrompt,
    displayNameMasked: nameResult.masked,
    riskyTermsRemoved: riskyResult.labels,
    socialPhrasesRemoved: socialResult.labels,
    artifactsRemoved: artifactResult.labels,
  };
}

export function buildStyleSafeScenePrompt() {
  return STORYBOOK_GARDEN_PROVIDER_PROMPT;
}

export function buildCreatorSafeRewrite() {
  return STORYBOOK_GARDEN_USER_REWRITE;
}

function promptPreview(prompt: string) {
  return prompt.length <= 96 ? prompt : `${prompt.slice(0, 96)}...`;
}

export function logProviderPromptFinalization(input: {
  providerId: string;
  originalPrompt: string;
  sanitizer: ProviderPromptSanitizerResult;
  referenceCount: number;
  renderingMode?: string | null;
  fallbackStage?: string | null;
}) {
  const shouldLogPromptText = env.DEBUG_PROVIDER_PROMPTS || process.env.NODE_ENV !== 'production';
  console.info('PROVIDER PROMPT FINALIZED:', {
    providerId: input.providerId,
    originalPromptLength: input.originalPrompt.length,
    sanitizedPromptLength: input.sanitizer.prompt.length,
    displayNameMasked: input.sanitizer.displayNameMasked,
    riskyTermsRemoved: input.sanitizer.riskyTermsRemoved,
    socialPhrasesRemoved: input.sanitizer.socialPhrasesRemoved,
    artifactsRemoved: input.sanitizer.artifactsRemoved,
    referenceCount: input.referenceCount,
    renderingMode: input.renderingMode ?? null,
    fallbackStage: input.fallbackStage ?? null,
    prompt: shouldLogPromptText ? input.sanitizer.prompt : undefined,
    promptPreview: shouldLogPromptText ? undefined : promptPreview(input.sanitizer.prompt),
  });
}
