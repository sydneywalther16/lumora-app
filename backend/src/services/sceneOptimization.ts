import { createHash } from 'node:crypto';
import { query } from './db';
import type {
  SeedanceQualityMode,
  SeedanceReferenceImage,
} from './providers/seedanceProvider';

export type RenderSuccessMode = 'cinematic_quality' | 'balanced' | 'success_first';

export type RenderSafeStyle =
  | 'storybook_cinematic'
  | 'editorial_drama'
  | 'soft_dreamscape'
  | 'cozy_realism'
  | 'gentle_cinematic'
  | 'painterly_elegance';

export type SceneComplexityLevel = 'low' | 'medium' | 'high';

export type ReliableRenderStageId =
  | 'cast_safe_prompt'
  | 'seedance_fast'
  | 'stylized_cinematic'
  | 'reduced_references'
  | 'primary_reference'
  | 'storybook_text_only';

export type ReliableReferenceStrategy =
  | 'all_saved_references'
  | 'reduced_cast_references'
  | 'primary_reference'
  | 'no_reference_storybook';

export type SceneComplexityScore = {
  score: number;
  level: SceneComplexityLevel;
  promptLength: number;
  referenceCount: number;
  sceneCount: number;
  emotionalDensity: number;
  cameraComplexity: number;
  environmentComplexity: number;
  recommendations: string[];
};

export type ReferenceConfidenceScore = {
  url: string;
  label: string | null;
  role: string | null;
  token: string | null;
  score: number;
  savedToLumora: boolean;
  primary: boolean;
  reasons: string[];
};

export type SceneOptimizationDiagnostics = {
  originalPromptLength: number;
  optimizedPromptLength: number;
  simplified: boolean;
  successMode: RenderSuccessMode;
  safeStyle: RenderSafeStyle;
  complexity: SceneComplexityScore;
  referenceConfidence: ReferenceConfidenceScore[];
  selectedReferenceCount: number;
  originalReferenceCount: number;
  referenceQualityScore: number;
  referenceStrategy: ReliableReferenceStrategy;
  creatorMessage: string | null;
  promptFingerprint: string;
};

export type SceneOptimizationResult = {
  originalPrompt: string;
  optimizedPrompt: string;
  diagnostics: SceneOptimizationDiagnostics;
  complexity: SceneComplexityScore;
  referenceConfidence: ReferenceConfidenceScore[];
  referenceSets: {
    all: SeedanceReferenceImage[];
    primary: SeedanceReferenceImage[];
    minimal: SeedanceReferenceImage[];
    none: SeedanceReferenceImage[];
  };
  creatorMessage: string | null;
  safeStyle: RenderSafeStyle;
  successMode: RenderSuccessMode;
};

export type ReliableRenderAttemptPlan = {
  stage: ReliableRenderStageId;
  quality: SeedanceQualityMode;
  message: string;
  referenceImages: SeedanceReferenceImage[];
  referenceStrategy: ReliableReferenceStrategy;
  promptVariant: 'optimized' | 'stylized' | 'storybook';
};

type OptimizeSceneInput = {
  prompt: string;
  requestedQuality?: SeedanceQualityMode;
  successMode?: RenderSuccessMode | string | null;
  referenceImages?: SeedanceReferenceImage[];
  sceneCount?: number;
  cameraText?: string | null;
  environmentText?: string | null;
  emotionalText?: string | null;
  continuityNotes?: string[];
};

type RenderMemoryInput = {
  userId?: string | null;
  characterId?: string | null;
  provider: string;
  prompt: string;
  successMode: RenderSuccessMode;
  safeStyle: RenderSafeStyle;
  referenceStrategy: ReliableReferenceStrategy | null;
  referenceCount: number;
  complexityScore: number;
  referenceQualityScore: number;
  stage?: string | null;
  category?: string | null;
  metadata?: Record<string, unknown>;
};

export const renderSafeStyles = [
  'storybook_cinematic',
  'editorial_drama',
  'soft_dreamscape',
  'cozy_realism',
  'gentle_cinematic',
  'painterly_elegance',
] as const satisfies readonly RenderSafeStyle[];

const reliabilityStats = {
  optimizations: 0,
  simplifiedScenes: 0,
  referencesReduced: 0,
  successes: 0,
  failures: 0,
  moderationFailures: 0,
  timeoutFailures: 0,
  persistenceWrites: 0,
  persistenceErrors: 0,
  lastComplexityScore: null as number | null,
  lastReferenceQualityScore: null as number | null,
  lastSuccessfulStage: null as string | null,
  lastFailureCategory: null as string | null,
};

const reliabilityRewrites: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bphoto\s*shoot\b/gi, replacement: 'cinematic scene' },
  { pattern: /\bphotoshoot\b/gi, replacement: 'cinematic scene' },
  { pattern: /\bmodel\s+posing\b/gi, replacement: 'natural movement' },
  { pattern: /\bposing\s+like\s+a\s+model\b/gi, replacement: 'moving naturally' },
  { pattern: /\bglamour\b/gi, replacement: 'elegant cinematic tone' },
  { pattern: /\binfluencer\b/gi, replacement: 'creator' },
  { pattern: /\bsuperstar\b/gi, replacement: 'confident protagonist' },
  { pattern: /\bcelebrity\b/gi, replacement: '' },
  { pattern: /\bpublic\s+figure\b/gi, replacement: '' },
  { pattern: /\bphotorealistic\s+woman\b/gi, replacement: 'cinematic character' },
  { pattern: /\brealistic\s+influencer\b/gi, replacement: 'stylized cinematic protagonist' },
  { pattern: /\bcomplex\s+multi[-\s]?scene\s+montage\b/gi, replacement: 'simple cinematic moment' },
  { pattern: /\brapid\s+montage\b/gi, replacement: 'gentle sequence' },
  { pattern: /\bdolly\s+zoom\b/gi, replacement: 'gentle camera movement' },
  { pattern: /\bcrane\s+shot\b/gi, replacement: 'soft camera movement' },
  { pattern: /\borbiting\s+camera\b/gi, replacement: 'gentle camera movement' },
  { pattern: /\bwhip\s+pan\b/gi, replacement: 'smooth camera move' },
];

const cameraTerms = [
  'dolly',
  'crane',
  'orbit',
  'tracking',
  'zoom',
  'pan',
  'tilt',
  'handheld',
  'steadicam',
  'rack focus',
  'montage',
  'transition',
  'slow motion',
  'close-up',
  'wide shot',
];

const environmentTerms = [
  'rain',
  'neon',
  'crowd',
  'traffic',
  'mirror',
  'reflection',
  'smoke',
  'fog',
  'night',
  'city',
  'garden',
  'ocean',
  'desert',
  'forest',
  'storm',
  'festival',
];

const emotionalTerms = [
  'heartbroken',
  'melancholy',
  'peaceful',
  'joyful',
  'tense',
  'intimate',
  'nostalgic',
  'hopeful',
  'confident',
  'lonely',
  'romantic',
  'dramatic',
  'dreamlike',
];

const primaryReferenceHints = [
  'front',
  'face',
  'portrait',
  'primary',
  'upper',
  'self',
];

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalizedMode(value: RenderSuccessMode | string | null | undefined): RenderSuccessMode {
  if (value === 'cinematic_quality' || value === 'balanced' || value === 'success_first') return value;
  return 'balanced';
}

function normalizedUrlHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLumoraControlledUrl(url: string) {
  const lower = url.toLowerCase();
  const host = normalizedUrlHost(url);
  return (
    lower.includes('/storage/v1/object/public/lumora-assets/') ||
    lower.includes('/storage/v1/object/sign/lumora-assets/') ||
    lower.includes('/lumora-assets/') ||
    host.includes('supabase.co') ||
    host.includes('lumora')
  );
}

function looksProtectedOrTemporary(url: string) {
  const host = normalizedUrlHost(url);
  const lower = url.toLowerCase();
  return (
    host.includes('fbcdn.net') ||
    host.includes('facebook.com') ||
    host.includes('instagram') ||
    host.includes('cdninstagram') ||
    host.includes('googleusercontent.com') ||
    lower.includes('expires=') ||
    lower.includes('x-amz-signature') ||
    lower.includes('token=')
  );
}

function countTerms(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
}

function scoreLevel(score: number): SceneComplexityLevel {
  if (score >= 68) return 'high';
  if (score >= 38) return 'medium';
  return 'low';
}

export function scoreSceneComplexity(input: {
  prompt: string;
  referenceCount?: number;
  sceneCount?: number;
  cameraText?: string | null;
  environmentText?: string | null;
  emotionalText?: string | null;
}): SceneComplexityScore {
  const prompt = input.prompt.trim();
  const sceneCount = Math.max(1, Math.round(input.sceneCount ?? 1));
  const referenceCount = Math.max(0, Math.round(input.referenceCount ?? 0));
  const cameraText = `${prompt} ${input.cameraText ?? ''}`;
  const environmentText = `${prompt} ${input.environmentText ?? ''}`;
  const emotionalText = `${prompt} ${input.emotionalText ?? ''}`;

  const promptLengthScore = Math.min(34, Math.ceil(prompt.length / 32));
  const referenceScore = referenceCount <= 3
    ? referenceCount * 3
    : 9 + ((referenceCount - 3) * 6);
  const sceneScore = Math.min(18, Math.max(0, sceneCount - 1) * 4);
  const cameraComplexity = Math.min(18, countTerms(cameraText, cameraTerms) * 3);
  const environmentComplexity = Math.min(12, countTerms(environmentText, environmentTerms) * 2);
  const emotionalDensity = Math.min(12, countTerms(emotionalText, emotionalTerms) * 2);
  const score = Math.min(100, promptLengthScore + referenceScore + sceneScore + cameraComplexity + environmentComplexity + emotionalDensity);
  const recommendations: string[] = [];

  if (prompt.length > 650) recommendations.push('Shorten provider prompt.');
  if (referenceCount > 3) recommendations.push('Use strongest cast references first.');
  if (sceneCount >= 5) recommendations.push('Render as smaller saved shots.');
  if (cameraComplexity > 10) recommendations.push('Simplify camera choreography.');
  if (environmentComplexity > 8) recommendations.push('Reduce environment density.');

  return {
    score,
    level: scoreLevel(score),
    promptLength: prompt.length,
    referenceCount,
    sceneCount,
    emotionalDensity,
    cameraComplexity,
    environmentComplexity,
    recommendations,
  };
}

function referenceText(reference: SeedanceReferenceImage) {
  return `${reference.role ?? ''} ${reference.label ?? ''} ${reference.token ?? ''}`.toLowerCase();
}

export function scoreReferenceConfidence(reference: SeedanceReferenceImage): ReferenceConfidenceScore {
  const text = referenceText(reference);
  const url = reference.url;
  const reasons: string[] = [];
  let score = 48;
  const savedToLumora = isLumoraControlledUrl(url);

  if (savedToLumora) {
    score += 24;
    reasons.push('Saved to Lumora');
  } else {
    score -= 12;
    reasons.push('External link');
  }

  if (looksProtectedOrTemporary(url)) {
    score -= 30;
    reasons.push('Protected or temporary source');
  }

  if (primaryReferenceHints.some((hint) => text.includes(hint))) {
    score += 20;
    reasons.push('Primary identity angle');
  } else if (text.includes('side') || text.includes('angle')) {
    score += 12;
    reasons.push('Useful alternate angle');
  } else if (text.includes('full') || text.includes('body')) {
    score += 4;
    reasons.push('Wardrobe/body continuity');
  }

  if (text.includes('manual_reference_override') || text.includes('manual reference') || text.includes('override')) {
    score -= 40;
    reasons.push('Manual override is lower confidence');
  }

  if (!url.trim()) {
    score = 0;
    reasons.push('Missing image URL');
  }

  const clampedScore = Math.max(0, Math.min(100, score));

  return {
    url,
    label: reference.label ?? null,
    role: reference.role ?? null,
    token: reference.token ?? null,
    score: clampedScore,
    savedToLumora,
    primary: clampedScore >= 72 || primaryReferenceHints.some((hint) => text.includes(hint)),
    reasons: uniqueStrings(reasons),
  };
}

function normalizeReferences(references: SeedanceReferenceImage[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (!reference.url || seen.has(reference.url)) return false;
    seen.add(reference.url);
    return true;
  });
}

function referenceMaxForMode(input: {
  mode: RenderSuccessMode;
  complexity: SceneComplexityScore;
  requestedQuality?: SeedanceQualityMode;
}) {
  if (input.mode === 'success_first') return input.complexity.level === 'low' ? 3 : 2;
  if (input.complexity.level === 'high') return 3;
  if (input.mode === 'cinematic_quality' && input.requestedQuality === 'quality') return 5;
  return 4;
}

function selectReferenceSets(input: {
  references: SeedanceReferenceImage[];
  confidence: ReferenceConfidenceScore[];
  complexity: SceneComplexityScore;
  mode: RenderSuccessMode;
  requestedQuality?: SeedanceQualityMode;
}) {
  const references = normalizeReferences(input.references);
  const confidenceByUrl = new Map(input.confidence.map((score) => [score.url, score]));
  const sorted = references
    .slice()
    .sort((a, b) => (confidenceByUrl.get(b.url)?.score ?? 0) - (confidenceByUrl.get(a.url)?.score ?? 0));
  const maxReferences = referenceMaxForMode(input);
  const all = sorted.slice(0, maxReferences);
  const primary = sorted
    .filter((reference) => {
      const confidence = confidenceByUrl.get(reference.url);
      return Boolean(confidence?.primary || referenceText(reference).includes('side'));
    })
    .slice(0, input.mode === 'success_first' ? 2 : 3);
  const fallbackPrimary = primary.length ? primary : all.slice(0, Math.min(2, all.length));
  const minimal = fallbackPrimary.slice(0, 1);

  return {
    all,
    primary: fallbackPrimary,
    minimal,
    none: [],
  };
}

function applyReliabilityRewrites(prompt: string) {
  return collapseWhitespace(
    reliabilityRewrites.reduce((next, rewrite) => next.replace(rewrite.pattern, rewrite.replacement), prompt),
  );
}

function splitPromptUnits(prompt: string) {
  return uniqueStrings(
    prompt
      .split(/[\n.;]+/g)
      .map((part) => collapseWhitespace(part.replace(/^[-*]\s*/, '')))
      .filter((part) => part.length > 0),
  );
}

function targetPromptLength(mode: RenderSuccessMode, complexity: SceneComplexityScore) {
  if (mode === 'success_first') return complexity.level === 'high' ? 380 : 460;
  if (mode === 'cinematic_quality') return complexity.level === 'high' ? 620 : 760;
  return complexity.level === 'high' ? 500 : 620;
}

function shortenToLength(prompt: string, targetLength: number) {
  if (prompt.length <= targetLength) return prompt;

  const units = splitPromptUnits(prompt);
  let next = '';
  for (const unit of units) {
    const candidate = next ? `${next}. ${unit}` : unit;
    if (candidate.length > targetLength) break;
    next = candidate;
  }

  if (next.length >= 120) return next.endsWith('.') ? next : `${next}.`;

  const words = prompt.split(/\s+/g);
  const kept: string[] = [];
  for (const word of words) {
    const candidate = [...kept, word].join(' ');
    if (candidate.length > targetLength) break;
    kept.push(word);
  }

  return collapseWhitespace(kept.join(' '));
}

function ensureReliabilitySafetyDetails(prompt: string, mode: RenderSuccessMode, style: RenderSafeStyle) {
  const lower = prompt.toLowerCase();
  const additions: string[] = [];
  if (!lower.includes('fully clothed')) additions.push('fully clothed');
  if (!lower.includes('natural movement')) additions.push('natural movement');
  if (!lower.includes('cinematic')) additions.push('cinematic style');
  if (mode === 'success_first' && !lower.includes('simple')) additions.push('simple scene');
  if (style === 'storybook_cinematic' && !lower.includes('storybook')) additions.push('storybook cinematic style');
  if (style === 'gentle_cinematic' && !lower.includes('gentle')) additions.push('gentle cinematic tone');

  return additions.length ? collapseWhitespace(`${prompt}, ${additions.join(', ')}`) : prompt;
}

function safeStyleFor(input: {
  mode: RenderSuccessMode;
  complexity: SceneComplexityScore;
  requestedQuality?: SeedanceQualityMode;
}): RenderSafeStyle {
  if (input.mode === 'success_first') return 'gentle_cinematic';
  if (input.complexity.level === 'high') return 'storybook_cinematic';
  if (input.requestedQuality === 'quality' && input.mode === 'cinematic_quality') return 'editorial_drama';
  return 'cozy_realism';
}

function optimizePrompt(input: {
  prompt: string;
  mode: RenderSuccessMode;
  style: RenderSafeStyle;
  complexity: SceneComplexityScore;
  continuityNotes?: string[];
}) {
  const rewritten = applyReliabilityRewrites(input.prompt)
    .replace(/\b(?:render|generate)\b\s*$/i, '')
    .replace(/\b(?:hey\s+yall|hey\s+ya'll|like\s+and\s+subscribe)\b/gi, '');
  const targetLength = targetPromptLength(input.mode, input.complexity);
  const units = splitPromptUnits(rewritten);
  const importantUnits = units.filter((unit) => {
    const lower = unit.toLowerCase();
    return (
      lower.includes('character') ||
      lower.includes('scene') ||
      lower.includes('walk') ||
      lower.includes('pick') ||
      lower.includes('garden') ||
      lower.includes('emotion') ||
      lower.includes('mood') ||
      lower.includes('lighting') ||
      lower.includes('camera') ||
      emotionalTerms.some((term) => lower.includes(term)) ||
      environmentTerms.some((term) => lower.includes(term))
    );
  });
  const continuityUnits = uniqueStrings(input.continuityNotes ?? [])
    .slice(0, input.mode === 'success_first' ? 1 : 2)
    .map((note) => `Story continuity: ${note}`);
  const baseUnits = (importantUnits.length ? importantUnits : units).slice(0, input.mode === 'success_first' ? 4 : 6);
  const rebuilt = collapseWhitespace([...baseUnits, ...continuityUnits].join('. '));
  const withSafety = ensureReliabilitySafetyDetails(rebuilt || rewritten, input.mode, input.style);

  return shortenToLength(withSafety, targetLength);
}

function referenceStrategyFor(input: {
  originalReferenceCount: number;
  selectedReferenceCount: number;
  primaryReferenceCount: number;
}): ReliableReferenceStrategy {
  if (input.selectedReferenceCount === 0) return 'no_reference_storybook';
  if (input.selectedReferenceCount < input.originalReferenceCount) return 'reduced_cast_references';
  if (input.selectedReferenceCount === 1 && input.originalReferenceCount > 1) return 'primary_reference';
  if (input.primaryReferenceCount === input.selectedReferenceCount && input.originalReferenceCount > input.selectedReferenceCount) {
    return 'primary_reference';
  }
  return 'all_saved_references';
}

function averageReferenceScore(scores: ReferenceConfidenceScore[]) {
  if (!scores.length) return 0;
  const total = scores.reduce((sum, score) => sum + score.score, 0);
  return Math.round(total / scores.length);
}

export function optimizeCinematicScene(input: OptimizeSceneInput): SceneOptimizationResult {
  const references = normalizeReferences(input.referenceImages ?? []);
  const successMode = normalizedMode(input.successMode);
  const complexity = scoreSceneComplexity({
    prompt: input.prompt,
    referenceCount: references.length,
    sceneCount: input.sceneCount,
    cameraText: input.cameraText,
    environmentText: input.environmentText,
    emotionalText: input.emotionalText,
  });
  const safeStyle = safeStyleFor({
    mode: successMode,
    complexity,
    requestedQuality: input.requestedQuality,
  });
  const referenceConfidence = references.map(scoreReferenceConfidence);
  const referenceSets = selectReferenceSets({
    references,
    confidence: referenceConfidence,
    complexity,
    mode: successMode,
    requestedQuality: input.requestedQuality,
  });
  const optimizedPrompt = optimizePrompt({
    prompt: input.prompt,
    mode: successMode,
    style: safeStyle,
    complexity,
    continuityNotes: input.continuityNotes,
  });
  const referenceQualityScore = averageReferenceScore(referenceConfidence);
  const referenceStrategy = referenceStrategyFor({
    originalReferenceCount: references.length,
    selectedReferenceCount: referenceSets.all.length,
    primaryReferenceCount: referenceSets.primary.length,
  });
  const simplified = optimizedPrompt !== collapseWhitespace(input.prompt) ||
    complexity.level === 'high' ||
    referenceSets.all.length < references.length ||
    successMode === 'success_first';
  const creatorMessage = simplified
    ? 'Lumora simplified this scene to help it render smoothly.'
    : null;

  reliabilityStats.optimizations += 1;
  if (simplified) reliabilityStats.simplifiedScenes += 1;
  if (referenceSets.all.length < references.length) reliabilityStats.referencesReduced += 1;
  reliabilityStats.lastComplexityScore = complexity.score;
  reliabilityStats.lastReferenceQualityScore = referenceQualityScore;

  const diagnostics: SceneOptimizationDiagnostics = {
    originalPromptLength: collapseWhitespace(input.prompt).length,
    optimizedPromptLength: optimizedPrompt.length,
    simplified,
    successMode,
    safeStyle,
    complexity,
    referenceConfidence,
    selectedReferenceCount: referenceSets.all.length,
    originalReferenceCount: references.length,
    referenceQualityScore,
    referenceStrategy,
    creatorMessage,
    promptFingerprint: hashText(optimizedPrompt),
  };

  return {
    originalPrompt: input.prompt,
    optimizedPrompt,
    diagnostics,
    complexity,
    referenceConfidence,
    referenceSets,
    creatorMessage,
    safeStyle,
    successMode,
  };
}

export function buildStylizedReliabilityPrompt(prompt: string, style: RenderSafeStyle) {
  const styleText: Record<RenderSafeStyle, string> = {
    storybook_cinematic: 'storybook cinematic style, soft lighting, gentle camera movement',
    editorial_drama: 'cinematic dramatic realism, elegant styling, natural movement',
    soft_dreamscape: 'soft dreamscape atmosphere, peaceful mood, gentle motion',
    cozy_realism: 'cozy cinematic realism, natural movement, soft lighting',
    gentle_cinematic: 'gentle cinematic tone, simple movement, peaceful mood',
    painterly_elegance: 'painterly cinematic elegance, calm pacing, soft visual texture',
  };

  return collapseWhitespace(`${prompt}. ${styleText[style]}. Keep the scene fully clothed and fictional.`);
}

export function storybookFallbackPrompt() {
  return 'The cast character gently moves through a sunlit bloom garden, peaceful mood, natural movement, fully clothed, storybook cinematic style, soft lighting, gentle camera movement.';
}

export function buildReliableRenderAttemptPlan(input: {
  requestedQuality: SeedanceQualityMode;
  referenceSets: SceneOptimizationResult['referenceSets'];
}): ReliableRenderAttemptPlan[] {
  const attempts: ReliableRenderAttemptPlan[] = [{
    stage: 'cast_safe_prompt',
    quality: input.requestedQuality,
    message: 'Trying a provider-friendly cinematic take...',
    referenceImages: input.referenceSets.all,
    referenceStrategy: 'all_saved_references',
    promptVariant: 'optimized',
  }];

  if (input.referenceSets.primary.length > 0 && input.referenceSets.primary.length < input.referenceSets.all.length) {
    attempts.push({
      stage: 'reduced_references',
      quality: input.requestedQuality,
      message: 'Using the strongest cast references...',
      referenceImages: input.referenceSets.primary,
      referenceStrategy: input.referenceSets.primary.length === 1 ? 'primary_reference' : 'reduced_cast_references',
      promptVariant: 'optimized',
    });
  }

  if (input.requestedQuality === 'quality') {
    attempts.push({
      stage: 'seedance_fast',
      quality: 'fast',
      message: 'Trying a lighter rendering path...',
      referenceImages: input.referenceSets.primary.length ? input.referenceSets.primary : input.referenceSets.all,
      referenceStrategy: input.referenceSets.primary.length === 1 ? 'primary_reference' : 'reduced_cast_references',
      promptVariant: 'optimized',
    });
  }

  attempts.push({
    stage: 'stylized_cinematic',
    quality: 'fast',
    message: 'Trying a more stylized cinematic take...',
    referenceImages: input.referenceSets.minimal,
    referenceStrategy: input.referenceSets.minimal.length ? 'primary_reference' : 'no_reference_storybook',
    promptVariant: 'stylized',
  });

  attempts.push({
    stage: 'storybook_text_only',
    quality: 'fast',
    message: 'Trying a storybook cinematic version...',
    referenceImages: input.referenceSets.none,
    referenceStrategy: 'no_reference_storybook',
    promptVariant: 'storybook',
  });

  return attempts;
}

function uuidOrNull(value?: string | null) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function memoryKey(input: RenderMemoryInput) {
  return [
    input.provider,
    uuidOrNull(input.userId) ?? 'anonymous',
    input.characterId ?? 'no-character',
    hashText(input.prompt),
    input.successMode,
    input.referenceStrategy ?? 'unknown',
  ].join(':');
}

export async function recordRenderSuccessMemory(input: RenderMemoryInput) {
  reliabilityStats.successes += 1;
  reliabilityStats.lastSuccessfulStage = input.stage ?? null;
  await persistRenderMemory(input, true);
}

export async function recordRenderFailureMemory(input: RenderMemoryInput) {
  reliabilityStats.failures += 1;
  reliabilityStats.lastFailureCategory = input.category ?? null;
  if (input.category === 'moderation') reliabilityStats.moderationFailures += 1;
  if (input.category === 'timeout') reliabilityStats.timeoutFailures += 1;
  await persistRenderMemory(input, false);
}

async function persistRenderMemory(input: RenderMemoryInput, success: boolean) {
  const userId = uuidOrNull(input.userId);
  if (!userId) return;

  try {
    await query(
      `insert into render_success_memory (
         memory_key,
         user_id,
         character_id,
         provider,
         render_mode,
         safe_style,
         prompt_fingerprint,
         reference_strategy,
         reference_count,
         complexity_score,
         reference_quality_score,
         success_count,
         failure_count,
         moderation_failure_count,
         timeout_failure_count,
         last_success_at,
         last_failure_at,
         last_successful_stage,
         last_failure_category,
         metadata,
         created_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, now(), now())
       on conflict (memory_key)
       do update set
         success_count = render_success_memory.success_count + excluded.success_count,
         failure_count = render_success_memory.failure_count + excluded.failure_count,
         moderation_failure_count = render_success_memory.moderation_failure_count + excluded.moderation_failure_count,
         timeout_failure_count = render_success_memory.timeout_failure_count + excluded.timeout_failure_count,
         last_success_at = coalesce(excluded.last_success_at, render_success_memory.last_success_at),
         last_failure_at = coalesce(excluded.last_failure_at, render_success_memory.last_failure_at),
         last_successful_stage = coalesce(excluded.last_successful_stage, render_success_memory.last_successful_stage),
         last_failure_category = coalesce(excluded.last_failure_category, render_success_memory.last_failure_category),
         reference_count = excluded.reference_count,
         complexity_score = excluded.complexity_score,
         reference_quality_score = excluded.reference_quality_score,
         metadata = render_success_memory.metadata || excluded.metadata,
         updated_at = now()`,
      [
        memoryKey(input),
        userId,
        input.characterId ?? null,
        input.provider,
        input.successMode,
        input.safeStyle,
        hashText(input.prompt),
        input.referenceStrategy,
        input.referenceCount,
        input.complexityScore,
        input.referenceQualityScore,
        success ? 1 : 0,
        success ? 0 : 1,
        !success && input.category === 'moderation' ? 1 : 0,
        !success && input.category === 'timeout' ? 1 : 0,
        success ? new Date().toISOString() : null,
        success ? null : new Date().toISOString(),
        success ? input.stage ?? null : null,
        success ? null : input.category ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    reliabilityStats.persistenceWrites += 1;
  } catch (error) {
    reliabilityStats.persistenceErrors += 1;
    console.warn('RENDER RELIABILITY MEMORY PERSISTENCE SKIPPED:', {
      reason: error instanceof Error ? error.message : error,
    });
  }
}

export async function buildRenderReliabilityDiagnostics() {
  try {
    const result = await query<{
      persistedMemoryCount: number;
      providerSuccessRate: number | null;
      moderationFailureRate: number | null;
      timeoutFailureRate: number | null;
      averageComplexityScore: number | null;
      averageReferenceQualityScore: number | null;
    }>(
      `select
         count(*)::int as "persistedMemoryCount",
         case
           when sum(success_count + failure_count) > 0
           then round((sum(success_count)::numeric / sum(success_count + failure_count)::numeric) * 100)::int
           else null
         end as "providerSuccessRate",
         case
           when sum(failure_count) > 0
           then round((sum(moderation_failure_count)::numeric / sum(failure_count)::numeric) * 100)::int
           else null
         end as "moderationFailureRate",
         case
           when sum(failure_count) > 0
           then round((sum(timeout_failure_count)::numeric / sum(failure_count)::numeric) * 100)::int
           else null
         end as "timeoutFailureRate",
         round(avg(complexity_score))::int as "averageComplexityScore",
         round(avg(reference_quality_score))::int as "averageReferenceQualityScore"
       from render_success_memory`,
    );
    const row = result.rows[0];

    return {
      ok: true,
      persistenceAvailable: true,
      configured: true,
      safeStyles: renderSafeStyles,
      inMemory: { ...reliabilityStats },
      persistedMemoryCount: row?.persistedMemoryCount ?? 0,
      providerSuccessRate: row?.providerSuccessRate ?? null,
      moderationFailureRate: row?.moderationFailureRate ?? null,
      timeoutFailureRate: row?.timeoutFailureRate ?? null,
      averageComplexityScore: row?.averageComplexityScore ?? null,
      averageReferenceQualityScore: row?.averageReferenceQualityScore ?? null,
    };
  } catch (error) {
    return {
      ok: true,
      persistenceAvailable: false,
      configured: true,
      safeStyles: renderSafeStyles,
      inMemory: { ...reliabilityStats },
      warning: 'Render reliability memory table is not available yet. Apply the render reliability migration to persist provider success memory.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
