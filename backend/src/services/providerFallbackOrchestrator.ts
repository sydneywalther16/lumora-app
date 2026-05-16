import { env } from '../lib/env';
import {
  generateSeedanceVideo,
  isSeedanceModerationError,
  safeCinematicRewrite,
  type SeedanceModerationDiagnostics,
  type SeedanceQualityMode,
  type SeedanceReferenceImage,
  type SeedanceVideoResult,
} from './providers/seedanceProvider';

export type ProviderFallbackProvider =
  | 'seedance-quality'
  | 'seedance-fast'
  | 'veo-experimental'
  | 'kling'
  | 'demo-mode';

export type ProviderFallbackStageId =
  | 'cast_safe_prompt'
  | 'seedance_fast'
  | 'stylized_cinematic'
  | 'paused';

export type ProviderFallbackStageStatus =
  | 'attempted'
  | 'blocked'
  | 'succeeded'
  | 'skipped'
  | 'paused';

export type ProviderFallbackStage = {
  stage: ProviderFallbackStageId;
  provider: ProviderFallbackProvider;
  message: string;
  status: ProviderFallbackStageStatus;
  blockedReasonCategory?: string | null;
  promptChanged?: boolean;
  quality?: SeedanceQualityMode;
};

export type CastSafePromptResult = {
  originalPrompt: string;
  prompt: string;
  castSafePromptApplied: boolean;
  displayNameMasked: boolean;
  riskyTermsRemoved: string[];
};

export type ProviderFallbackDiagnostics = {
  providerAttempted: ProviderFallbackProvider;
  fallbackProviderAttempted: ProviderFallbackProvider | null;
  providersAttempted: ProviderFallbackProvider[];
  castSafePromptApplied: boolean;
  displayNameMasked: boolean;
  riskyTermsRemoved: string[];
  finalProviderStatus: 'succeeded' | 'blocked' | 'paused';
  blockedReasonCategory?: string | null;
  finalProvider: ProviderFallbackProvider | null;
  finalPrompt: string;
  stages: ProviderFallbackStage[];
  suggestedPrompt?: string | null;
  sanitizedPrompt?: string | null;
  moderationDiagnostics?: SeedanceModerationDiagnostics | null;
};

export type ProviderFallbackSeedanceResult = SeedanceVideoResult & {
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics;
};

export type SeedanceModerationErrorWithFallback = Error & {
  statusCode?: number;
  suggestion?: string;
  suggestedPrompt?: string;
  sanitizedPrompt?: string;
  diagnostics?: SeedanceModerationDiagnostics;
  referenceImages?: SeedanceReferenceImage[];
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics;
};

type RiskyTermRewrite = {
  pattern: RegExp;
  replacement: string;
  label: string;
};

const CAST_SAFE_SUFFIX =
  'Keep the scene fully clothed, fictional, non-public-figure, and focused on natural movement.';

const riskyProviderPromptRewrites: RiskyTermRewrite[] = [
  { pattern: /\bphoto\s*shoot\b/gi, replacement: 'cinematic scene', label: 'photoshoot' },
  { pattern: /\bphotoshoot\b/gi, replacement: 'cinematic scene', label: 'photoshoot' },
  { pattern: /\bsuperstar\b/gi, replacement: 'confident protagonist', label: 'superstar' },
  { pattern: /\bluxury\s+influencer\b/gi, replacement: 'elegant cinematic figure', label: 'luxury influencer' },
  { pattern: /\binfluencer\b/gi, replacement: 'creator', label: 'influencer' },
  { pattern: /\bcelebrity\b/gi, replacement: '', label: 'celebrity' },
  { pattern: /\bpublic\s+figure\b/gi, replacement: '', label: 'public figure' },
  { pattern: /\bglamour\b/gi, replacement: 'elegant cinematic tone', label: 'glamour' },
  { pattern: /\beditorial\s+realism\b/gi, replacement: 'cinematic dramatic realism', label: 'editorial realism' },
  { pattern: /\beditorial\s+fashion\s+realism\b/gi, replacement: 'dramatic cinematic styling', label: 'editorial fashion realism' },
  { pattern: /\bphotorealistic\s+woman\b/gi, replacement: 'cinematic character', label: 'photorealistic woman' },
  { pattern: /\brealistic\s+influencer\b/gi, replacement: 'stylized cinematic protagonist', label: 'realistic influencer' },
  { pattern: /\bmodel\s+posing\b/gi, replacement: 'natural movement', label: 'model posing' },
  { pattern: /\bposing\s+like\s+a\s+model\b/gi, replacement: 'moving naturally', label: 'model posing' },
  { pattern: /\bseductive\b/gi, replacement: 'expressive', label: 'seductive' },
  { pattern: /\bsultry\b/gi, replacement: 'cinematic', label: 'sultry' },
  { pattern: /\bbody[-\s]?focused\b/gi, replacement: 'character-focused', label: 'body-focused' },
];

export const safeProviderTestPrompts = [
  'A cinematic character walks through a sunlit garden, gently picking daisies, peaceful mood, natural movement, fully clothed, storybook cinematic realism.',
] as const;

const providerFallbackStats = {
  attempts: 0,
  castSafePromptApplied: 0,
  displayNameMasked: 0,
  successfulFallbacks: 0,
  paused: 0,
  riskyTermsRemoved: new Map<string, number>(),
  providersAttempted: new Map<ProviderFallbackProvider, number>(),
  blockedCategories: new Map<string, number>(),
  lastSuccessfulPath: null as string | null,
  lastBlockedCategory: null as string | null,
};

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

  return uniqueValues([
    cleaned,
    ...parts,
  ]).sort((a, b) => b.length - a.length);
}

function replaceDisplayNames(prompt: string, displayName?: string | null) {
  let nextPrompt = prompt;
  let masked = false;

  for (const candidate of displayNameCandidates(displayName)) {
    const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'gi');
    if (pattern.test(nextPrompt)) {
      masked = true;
      nextPrompt = nextPrompt.replace(pattern, 'the cast character');
    }
  }

  nextPrompt = nextPrompt
    .replace(/\bthe cast character\s+the cast character\b/gi, 'the cast character')
    .replace(/\bthe cast character's\b/gi, "the cast character's");

  return {
    prompt: nextPrompt,
    masked,
  };
}

function applyRiskyTermRewrites(prompt: string) {
  let nextPrompt = prompt;
  const removed: string[] = [];

  for (const rewrite of riskyProviderPromptRewrites) {
    rewrite.pattern.lastIndex = 0;
    if (!rewrite.pattern.test(nextPrompt)) continue;

    removed.push(rewrite.label);
    rewrite.pattern.lastIndex = 0;
    nextPrompt = nextPrompt.replace(rewrite.pattern, rewrite.replacement);
  }

  return {
    prompt: collapseWhitespace(nextPrompt),
    riskyTermsRemoved: uniqueValues(removed),
  };
}

function appendCastSafeSuffix(prompt: string) {
  const lower = prompt.toLowerCase();
  if (
    lower.includes('fully clothed') &&
    lower.includes('non-public-figure') &&
    lower.includes('natural movement')
  ) {
    return prompt;
  }

  return collapseWhitespace(`${prompt} ${CAST_SAFE_SUFFIX}`);
}

export function applyCastSafePromptMask(input: {
  prompt: string;
  characterName?: string | null;
  characterDisplayName?: string | null;
}) {
  const originalPrompt = input.prompt.trim();
  const displayNames = uniqueValues([
    input.characterName ?? '',
    input.characterDisplayName ?? '',
  ]);
  let prompt = originalPrompt;
  let displayNameMasked = false;

  for (const displayName of displayNames) {
    const result = replaceDisplayNames(prompt, displayName);
    prompt = result.prompt;
    displayNameMasked = displayNameMasked || result.masked;
  }

  const riskyResult = applyRiskyTermRewrites(prompt);
  prompt = riskyResult.prompt;

  const changedBeforeSuffix = prompt !== originalPrompt;
  prompt = changedBeforeSuffix ? appendCastSafeSuffix(prompt) : prompt;

  return {
    originalPrompt,
    prompt,
    castSafePromptApplied: prompt !== originalPrompt,
    displayNameMasked,
    riskyTermsRemoved: riskyResult.riskyTermsRemoved,
  } satisfies CastSafePromptResult;
}

function stylizedCinematicPrompt(prompt: string) {
  return collapseWhitespace([
    safeCinematicRewrite(prompt),
    'Render as a stylized cinematic story moment with storybook realism, elegant wardrobe, gentle emotional pacing, natural movement, and no public-figure framing.',
  ].join(' '));
}

function providerForQuality(quality: SeedanceQualityMode): ProviderFallbackProvider {
  return quality === 'quality' ? 'seedance-quality' : 'seedance-fast';
}

function moderationCategory(error: unknown) {
  if (!isSeedanceModerationError(error)) return null;
  return error.diagnostics.category ?? error.diagnostics.categories?.[0] ?? 'provider_unknown_moderation';
}

function providerFallbackPromptChanged(input: {
  castSafePrompt: CastSafePromptResult;
  prompt: string;
}) {
  return input.castSafePrompt.prompt !== input.castSafePrompt.originalPrompt ||
    input.prompt !== input.castSafePrompt.originalPrompt;
}

function recordMapValue<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function diagnosticsFromStages(input: {
  providerAttempted: ProviderFallbackProvider;
  castSafePrompt: CastSafePromptResult;
  finalProviderStatus: ProviderFallbackDiagnostics['finalProviderStatus'];
  finalProvider: ProviderFallbackProvider | null;
  finalPrompt: string;
  stages: ProviderFallbackStage[];
  moderationDiagnostics?: SeedanceModerationDiagnostics | null;
  suggestedPrompt?: string | null;
  sanitizedPrompt?: string | null;
}) {
  const providersAttempted = uniqueValues(
    input.stages
      .filter((stage) => stage.status === 'attempted' || stage.status === 'blocked' || stage.status === 'succeeded')
      .map((stage) => stage.provider),
  ) as ProviderFallbackProvider[];
  const fallbackProviderAttempted = providersAttempted.find((provider) => provider !== input.providerAttempted) ?? null;
  const blockedReasonCategory = input.stages
    .slice()
    .reverse()
    .map((stage) => stage.blockedReasonCategory)
    .find((category): category is string => typeof category === 'string' && category.length > 0) ?? null;

  return {
    providerAttempted: input.providerAttempted,
    fallbackProviderAttempted,
    providersAttempted,
    castSafePromptApplied: input.castSafePrompt.castSafePromptApplied,
    displayNameMasked: input.castSafePrompt.displayNameMasked,
    riskyTermsRemoved: input.castSafePrompt.riskyTermsRemoved,
    finalProviderStatus: input.finalProviderStatus,
    blockedReasonCategory,
    finalProvider: input.finalProvider,
    finalPrompt: input.finalPrompt,
    stages: input.stages.map((stage) => ({ ...stage })),
    suggestedPrompt: input.suggestedPrompt ?? null,
    sanitizedPrompt: input.sanitizedPrompt ?? null,
    moderationDiagnostics: input.moderationDiagnostics ?? null,
  } satisfies ProviderFallbackDiagnostics;
}

function recordProviderFallbackDiagnostics(diagnostics: ProviderFallbackDiagnostics) {
  providerFallbackStats.attempts += 1;
  if (diagnostics.castSafePromptApplied) providerFallbackStats.castSafePromptApplied += 1;
  if (diagnostics.displayNameMasked) providerFallbackStats.displayNameMasked += 1;
  if (diagnostics.finalProviderStatus === 'succeeded' && diagnostics.stages.some((stage) => stage.status === 'blocked')) {
    providerFallbackStats.successfulFallbacks += 1;
    providerFallbackStats.lastSuccessfulPath = diagnostics.stages
      .map((stage) => `${stage.provider}:${stage.status}`)
      .join(' -> ');
  }
  if (diagnostics.finalProviderStatus === 'paused') {
    providerFallbackStats.paused += 1;
  }
  diagnostics.riskyTermsRemoved.forEach((term) => recordMapValue(providerFallbackStats.riskyTermsRemoved, term));
  diagnostics.providersAttempted.forEach((provider) => recordMapValue(providerFallbackStats.providersAttempted, provider));
  if (diagnostics.blockedReasonCategory) {
    providerFallbackStats.lastBlockedCategory = diagnostics.blockedReasonCategory;
    recordMapValue(providerFallbackStats.blockedCategories, diagnostics.blockedReasonCategory);
  }
}

function shouldAttachDiagnostics(diagnostics: ProviderFallbackDiagnostics) {
  return diagnostics.castSafePromptApplied ||
    diagnostics.displayNameMasked ||
    diagnostics.riskyTermsRemoved.length > 0 ||
    diagnostics.stages.some((stage) => stage.status === 'blocked') ||
    diagnostics.providerAttempted !== diagnostics.finalProvider;
}

function withProviderFallbackDiagnostics(
  error: unknown,
  diagnostics: ProviderFallbackDiagnostics,
): SeedanceModerationErrorWithFallback {
  if (isSeedanceModerationError(error)) {
    const enriched = error as SeedanceModerationErrorWithFallback;
    enriched.providerFallbackDiagnostics = diagnostics;
    return enriched;
  }

  const fallbackError = new Error('This scene needs a simpler direction before rendering.') as SeedanceModerationErrorWithFallback;
  fallbackError.name = 'SeedanceModerationError';
  fallbackError.statusCode = 422;
  fallbackError.suggestion = 'Try a simpler cinematic scene with fully clothed styling, natural movement, and fictional framing.';
  fallbackError.suggestedPrompt = diagnostics.suggestedPrompt ?? diagnostics.finalPrompt;
  fallbackError.sanitizedPrompt = diagnostics.sanitizedPrompt ?? diagnostics.finalPrompt;
  fallbackError.diagnostics = diagnostics.moderationDiagnostics ?? undefined;
  fallbackError.referenceImages = [];
  fallbackError.providerFallbackDiagnostics = diagnostics;
  return fallbackError;
}

export function providerFallbackDiagnosticsFromError(error: unknown) {
  return Boolean(error) && typeof error === 'object'
    ? (error as { providerFallbackDiagnostics?: ProviderFallbackDiagnostics }).providerFallbackDiagnostics ?? null
    : null;
}

export async function generateSeedanceWithProviderFallback(input: {
  prompt: string;
  quality?: SeedanceQualityMode;
  referenceImages?: SeedanceReferenceImage[];
  userId?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterDisplayName?: string | null;
  projectId?: string | null;
}): Promise<ProviderFallbackSeedanceResult> {
  const requestedQuality = input.quality ?? 'fast';
  const providerAttempted = providerForQuality(requestedQuality);
  const castSafePrompt = applyCastSafePromptMask({
    prompt: input.prompt,
    characterName: input.characterName,
    characterDisplayName: input.characterDisplayName,
  });
  const stages: ProviderFallbackStage[] = [];
  let lastModerationError: unknown = null;

  async function attempt(inputAttempt: {
    stage: ProviderFallbackStageId;
    quality: SeedanceQualityMode;
    prompt: string;
    message: string;
  }) {
    const provider = providerForQuality(inputAttempt.quality);
    const stage: ProviderFallbackStage = {
      stage: inputAttempt.stage,
      provider,
      message: inputAttempt.message,
      status: 'attempted',
      quality: inputAttempt.quality,
      promptChanged: providerFallbackPromptChanged({
        castSafePrompt,
        prompt: inputAttempt.prompt,
      }),
    };
    stages.push(stage);

    console.info('PROVIDER FALLBACK ATTEMPT:', {
      stage: stage.stage,
      provider: stage.provider,
      quality: stage.quality,
      castSafePromptApplied: castSafePrompt.castSafePromptApplied,
      displayNameMasked: castSafePrompt.displayNameMasked,
      riskyTermsRemoved: castSafePrompt.riskyTermsRemoved,
    });

    try {
      const result = await generateSeedanceVideo(inputAttempt.prompt, {
        quality: inputAttempt.quality,
        referenceImages: input.referenceImages,
        userId: input.userId,
        characterId: input.characterId,
        projectId: input.projectId,
      });
      stage.status = 'succeeded';

      const diagnostics = diagnosticsFromStages({
        providerAttempted,
        castSafePrompt,
        finalProviderStatus: 'succeeded',
        finalProvider: provider,
        finalPrompt: result.finalPrompt,
        stages,
        moderationDiagnostics: result.moderationDiagnostics ?? null,
        suggestedPrompt: result.suggestedPrompt ?? null,
        sanitizedPrompt: result.sanitizedPrompt ?? null,
      });
      recordProviderFallbackDiagnostics(diagnostics);
      console.info('PROVIDER FALLBACK SUCCEEDED:', {
        provider: diagnostics.finalProvider,
        providerAttempted: diagnostics.providerAttempted,
        fallbackProviderAttempted: diagnostics.fallbackProviderAttempted,
        castSafePromptApplied: diagnostics.castSafePromptApplied,
        displayNameMasked: diagnostics.displayNameMasked,
        riskyTermsRemoved: diagnostics.riskyTermsRemoved,
        finalProviderStatus: diagnostics.finalProviderStatus,
      });

      return {
        ...result,
        warnings: [
          ...result.warnings,
          ...(diagnostics.displayNameMasked
            ? ['Lumora kept the cast name in your story metadata and used visual references for provider-safe identity continuity.']
            : []),
          ...(diagnostics.stages.some((item) => item.status === 'blocked')
            ? ['Lumora found a safer cinematic route.']
            : []),
        ],
        providerFallbackDiagnostics: shouldAttachDiagnostics(diagnostics) ? diagnostics : undefined,
      } satisfies ProviderFallbackSeedanceResult;
    } catch (error) {
      if (!isSeedanceModerationError(error)) throw error;

      lastModerationError = error;
      stage.status = 'blocked';
      stage.blockedReasonCategory = moderationCategory(error);
      console.warn('PROVIDER FALLBACK BLOCKED:', {
        stage: stage.stage,
        provider: stage.provider,
        quality: stage.quality,
        blockedReasonCategory: stage.blockedReasonCategory,
      });
      return null;
    }
  }

  const firstResult = await attempt({
    stage: 'cast_safe_prompt',
    quality: requestedQuality,
    prompt: castSafePrompt.prompt,
    message: 'Trying a cast-safe cinematic prompt...',
  });
  if (firstResult) return firstResult;

  if (requestedQuality === 'quality') {
    const fastResult = await attempt({
      stage: 'seedance_fast',
      quality: 'fast',
      prompt: castSafePrompt.prompt,
      message: 'Trying a lighter rendering path...',
    });
    if (fastResult) return fastResult;
  }

  const stylizedPrompt = stylizedCinematicPrompt(castSafePrompt.prompt);
  const stylizedResult = await attempt({
    stage: 'stylized_cinematic',
    quality: 'fast',
    prompt: stylizedPrompt,
    message: 'Trying a more stylized cinematic take...',
  });
  if (stylizedResult) return stylizedResult;

  stages.push({
    stage: 'paused',
    provider: providerForQuality(requestedQuality === 'quality' ? 'fast' : requestedQuality),
    message: 'This renderer paused the scene. Your completed shots are saved in Drafts.',
    status: 'paused',
    blockedReasonCategory: moderationCategory(lastModerationError),
    quality: requestedQuality === 'quality' ? 'fast' : requestedQuality,
    promptChanged: true,
  });

  const seedanceError = isSeedanceModerationError(lastModerationError)
    ? lastModerationError
    : null;
  const diagnostics = diagnosticsFromStages({
    providerAttempted,
    castSafePrompt,
    finalProviderStatus: 'paused',
    finalProvider: null,
    finalPrompt: stylizedPrompt,
    stages,
    moderationDiagnostics: seedanceError?.diagnostics ?? null,
    suggestedPrompt: seedanceError?.suggestedPrompt ?? stylizedPrompt,
    sanitizedPrompt: seedanceError?.sanitizedPrompt ?? stylizedPrompt,
  });
  recordProviderFallbackDiagnostics(diagnostics);
  console.warn('PROVIDER FALLBACK PAUSED:', {
    providerAttempted: diagnostics.providerAttempted,
    providersAttempted: diagnostics.providersAttempted,
    blockedReasonCategory: diagnostics.blockedReasonCategory,
    castSafePromptApplied: diagnostics.castSafePromptApplied,
    displayNameMasked: diagnostics.displayNameMasked,
    riskyTermsRemoved: diagnostics.riskyTermsRemoved,
  });

  throw withProviderFallbackDiagnostics(lastModerationError, diagnostics);
}

export async function buildProviderFallbackDiagnostics() {
  const configured = {
    seedanceQuality: Boolean(env.REPLICATE_API_TOKEN),
    seedanceFast: Boolean(env.REPLICATE_API_TOKEN),
    veoExperimental: Boolean(env.GOOGLE_API_KEY),
    kling: false,
    demoMode: env.DEMO_MODE,
  };

  return {
    ok: true,
    configured,
    attempts: providerFallbackStats.attempts,
    castSafePromptApplied: providerFallbackStats.castSafePromptApplied,
    displayNameMasked: providerFallbackStats.displayNameMasked,
    successfulFallbacks: providerFallbackStats.successfulFallbacks,
    paused: providerFallbackStats.paused,
    providersAttempted: Object.fromEntries(providerFallbackStats.providersAttempted.entries()),
    riskyTermsRemoved: Object.fromEntries(providerFallbackStats.riskyTermsRemoved.entries()),
    blockedCategories: Object.fromEntries(providerFallbackStats.blockedCategories.entries()),
    lastSuccessfulPath: providerFallbackStats.lastSuccessfulPath,
    lastBlockedCategory: providerFallbackStats.lastBlockedCategory,
    safeTestPrompts: safeProviderTestPrompts,
    providerOrder: [
      'seedance-quality',
      'seedance-fast',
      'veo-experimental',
      'kling',
      'demo-mode',
    ] satisfies ProviderFallbackProvider[],
    note: 'Demo mode is explicit only and is not used as a fake production render fallback.',
  };
}
