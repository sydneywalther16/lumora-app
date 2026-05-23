import { env } from '../lib/env';
import {
  generateSeedanceVideo,
  isSeedanceModerationError,
  type SeedanceModerationDiagnostics,
  type SeedancePredictionEvent,
  type SeedanceQualityMode,
  type SeedanceReferenceImage,
  type SeedanceVideoResult,
} from './providers/seedanceProvider';
import {
  buildCreatorSafeRewrite,
  sanitizeProviderPrompt,
} from './providerPromptSanitizer';
import {
  buildReliableRenderAttemptPlan,
  buildStylizedReliabilityPrompt,
  optimizeCinematicScene,
  recordRenderFailureMemory,
  recordRenderSuccessMemory,
  storybookFallbackPrompt,
  type RenderSuccessMode,
  type SceneOptimizationDiagnostics,
} from './sceneOptimization';

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
  | 'reduced_references'
  | 'primary_reference'
  | 'storybook_text_only'
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
  referenceStrategy?: ProviderFallbackReferenceStrategy;
  referenceCount?: number;
};

export type ProviderFallbackReferenceStrategy =
  | 'all_saved_references'
  | 'reduced_cast_references'
  | 'primary_reference'
  | 'no_reference_storybook';

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
  referenceStrategy: ProviderFallbackReferenceStrategy | null;
  renderedWithLighterCastGuidance: boolean;
  stages: ProviderFallbackStage[];
  suggestedPrompt?: string | null;
  sanitizedPrompt?: string | null;
  moderationDiagnostics?: SeedanceModerationDiagnostics | null;
  sceneOptimization?: SceneOptimizationDiagnostics | null;
  successMode?: RenderSuccessMode | null;
  safeStyle?: string | null;
  complexityScore?: number | null;
  referenceQualityScore?: number | null;
  creatorMessage?: string | null;
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
  const sanitizer = sanitizeProviderPrompt(input);
  const prompt = sanitizer.changed ? appendCastSafeSuffix(sanitizer.prompt) : sanitizer.prompt;

  return {
    originalPrompt: sanitizer.originalPrompt,
    prompt,
    castSafePromptApplied: prompt !== sanitizer.originalPrompt,
    displayNameMasked: sanitizer.displayNameMasked,
    riskyTermsRemoved: [
      ...sanitizer.riskyTermsRemoved,
      ...sanitizer.socialPhrasesRemoved,
      ...sanitizer.artifactsRemoved,
    ],
  } satisfies CastSafePromptResult;
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
  sceneOptimization?: SceneOptimizationDiagnostics | null;
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
  const finalStage = input.stages
    .slice()
    .reverse()
    .find((stage) => stage.status === 'succeeded' || stage.status === 'paused') ?? null;
  const referenceStrategy = finalStage?.referenceStrategy ?? null;

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
    referenceStrategy,
    renderedWithLighterCastGuidance: Boolean(referenceStrategy && referenceStrategy !== 'all_saved_references'),
    stages: input.stages.map((stage) => ({ ...stage })),
    suggestedPrompt: input.suggestedPrompt ?? null,
    sanitizedPrompt: input.sanitizedPrompt ?? null,
    moderationDiagnostics: input.moderationDiagnostics ?? null,
    sceneOptimization: input.sceneOptimization ?? null,
    successMode: input.sceneOptimization?.successMode ?? null,
    safeStyle: input.sceneOptimization?.safeStyle ?? null,
    complexityScore: input.sceneOptimization?.complexity.score ?? null,
    referenceQualityScore: input.sceneOptimization?.referenceQualityScore ?? null,
    creatorMessage: input.sceneOptimization?.creatorMessage ?? null,
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
    diagnostics.providerAttempted !== diagnostics.finalProvider ||
    Boolean(diagnostics.sceneOptimization?.simplified);
}

function withProviderFallbackDiagnostics(
  error: unknown,
  diagnostics: ProviderFallbackDiagnostics,
): SeedanceModerationErrorWithFallback {
  if (isSeedanceModerationError(error)) {
    const enriched = error as SeedanceModerationErrorWithFallback;
    enriched.suggestedPrompt = diagnostics.suggestedPrompt ?? buildCreatorSafeRewrite();
    enriched.sanitizedPrompt = diagnostics.sanitizedPrompt ?? diagnostics.finalPrompt;
    enriched.providerFallbackDiagnostics = diagnostics;
    return enriched;
  }

  const fallbackError = new Error('This scene needs a simpler direction before rendering.') as SeedanceModerationErrorWithFallback;
  fallbackError.name = 'SeedanceModerationError';
  fallbackError.statusCode = 422;
  fallbackError.suggestion = 'Try a simpler cinematic scene with fully clothed styling, natural movement, and fictional framing.';
  fallbackError.suggestedPrompt = diagnostics.suggestedPrompt ?? buildCreatorSafeRewrite();
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
  renderPreference?: RenderSuccessMode | string | null;
  referenceImages?: SeedanceReferenceImage[];
  userId?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterDisplayName?: string | null;
  projectId?: string | null;
  sceneCount?: number;
  cameraText?: string | null;
  environmentText?: string | null;
  emotionalText?: string | null;
  continuityNotes?: string[];
  durationSeconds?: number | null;
  onPredictionCreated?: (event: SeedancePredictionEvent) => void | Promise<void>;
  onPredictionPolled?: (event: SeedancePredictionEvent) => void | Promise<void>;
}): Promise<ProviderFallbackSeedanceResult> {
  const requestedQuality = input.quality ?? 'fast';
  const providerAttempted = providerForQuality(requestedQuality);
  const optimization = optimizeCinematicScene({
    prompt: input.prompt,
    requestedQuality,
    successMode: input.renderPreference,
    referenceImages: input.referenceImages ?? [],
    sceneCount: input.sceneCount,
    cameraText: input.cameraText,
    environmentText: input.environmentText,
    emotionalText: input.emotionalText,
    continuityNotes: input.continuityNotes,
  });
  const castSafePrompt = applyCastSafePromptMask({
    prompt: optimization.optimizedPrompt,
    characterName: input.characterName,
    characterDisplayName: input.characterDisplayName,
  });
  const stylizedPrompt = buildStylizedReliabilityPrompt(castSafePrompt.prompt, optimization.safeStyle);
  const storybookPrompt = storybookFallbackPrompt();
  const attemptPlan = buildReliableRenderAttemptPlan({
    requestedQuality,
    referenceSets: optimization.referenceSets,
  });
  const stages: ProviderFallbackStage[] = [];
  let lastModerationError: unknown = null;
  let lastAttemptPrompt = castSafePrompt.prompt;

  async function attempt(inputAttempt: {
    stage: ProviderFallbackStageId;
    quality: SeedanceQualityMode;
    prompt: string;
    message: string;
    referenceImages: SeedanceReferenceImage[];
    referenceStrategy: ProviderFallbackReferenceStrategy;
  }) {
    const provider = providerForQuality(inputAttempt.quality);
    const stage: ProviderFallbackStage = {
      stage: inputAttempt.stage,
      provider,
      message: inputAttempt.message,
      status: 'attempted',
      quality: inputAttempt.quality,
      referenceStrategy: inputAttempt.referenceStrategy,
      referenceCount: inputAttempt.referenceImages.length,
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
      referenceStrategy: stage.referenceStrategy,
      referenceCount: stage.referenceCount,
      complexityScore: optimization.diagnostics.complexity.score,
      referenceQualityScore: optimization.diagnostics.referenceQualityScore,
      successMode: optimization.successMode,
    });

    try {
      const result = await generateSeedanceVideo(inputAttempt.prompt, {
        quality: inputAttempt.quality,
        referenceImages: inputAttempt.referenceImages,
        userId: input.userId,
        characterId: input.characterId,
        characterName: input.characterName,
        characterDisplayName: input.characterDisplayName,
        projectId: input.projectId,
        providerFallbackStage: inputAttempt.stage,
        durationSeconds: input.durationSeconds,
        onPredictionCreated: input.onPredictionCreated,
        onPredictionPolled: input.onPredictionPolled,
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
        sceneOptimization: optimization.diagnostics,
      });
      recordProviderFallbackDiagnostics(diagnostics);
      await recordRenderSuccessMemory({
        userId: input.userId,
        characterId: input.characterId,
        provider,
        prompt: result.finalPrompt,
        successMode: optimization.successMode,
        safeStyle: optimization.safeStyle,
        referenceStrategy: stage.referenceStrategy ?? null,
        referenceCount: stage.referenceCount ?? 0,
        complexityScore: optimization.diagnostics.complexity.score,
        referenceQualityScore: optimization.diagnostics.referenceQualityScore,
        stage: stage.stage,
        metadata: {
          providerFallbackStage: stage.stage,
          renderPreference: optimization.successMode,
          selectedReferenceCount: optimization.diagnostics.selectedReferenceCount,
          originalReferenceCount: optimization.diagnostics.originalReferenceCount,
        },
      });
      console.info('PROVIDER FALLBACK SUCCEEDED:', {
        provider: diagnostics.finalProvider,
        providerAttempted: diagnostics.providerAttempted,
        fallbackProviderAttempted: diagnostics.fallbackProviderAttempted,
        castSafePromptApplied: diagnostics.castSafePromptApplied,
        displayNameMasked: diagnostics.displayNameMasked,
        riskyTermsRemoved: diagnostics.riskyTermsRemoved,
        finalProviderStatus: diagnostics.finalProviderStatus,
        complexityScore: diagnostics.complexityScore,
        referenceQualityScore: diagnostics.referenceQualityScore,
      });

      return {
        ...result,
        warnings: [
          ...result.warnings,
          ...(optimization.creatorMessage ? [optimization.creatorMessage] : []),
          ...(diagnostics.displayNameMasked
            ? ['Lumora kept the cast name in your story metadata and used visual references for provider-safe identity continuity.']
            : []),
          ...(diagnostics.stages.some((item) => item.status === 'blocked')
            ? ['Lumora found a safer cinematic route.']
            : []),
          ...(diagnostics.renderedWithLighterCastGuidance
            ? ['Rendered with soft self guidance.']
            : []),
        ],
        suggestedPrompt: buildCreatorSafeRewrite(),
        sanitizedPrompt: result.sanitizedPrompt,
        providerFallbackDiagnostics: shouldAttachDiagnostics(diagnostics) ? diagnostics : undefined,
      } satisfies ProviderFallbackSeedanceResult;
    } catch (error) {
      if (!isSeedanceModerationError(error)) {
        await recordRenderFailureMemory({
          userId: input.userId,
          characterId: input.characterId,
          provider,
          prompt: inputAttempt.prompt,
          successMode: optimization.successMode,
          safeStyle: optimization.safeStyle,
          referenceStrategy: stage.referenceStrategy ?? null,
          referenceCount: stage.referenceCount ?? 0,
          complexityScore: optimization.diagnostics.complexity.score,
          referenceQualityScore: optimization.diagnostics.referenceQualityScore,
          stage: stage.stage,
          category: 'provider',
        });
        throw error;
      }

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

  for (const plan of attemptPlan) {
    const prompt = plan.promptVariant === 'storybook'
      ? storybookPrompt
      : plan.promptVariant === 'stylized'
        ? stylizedPrompt
        : castSafePrompt.prompt;
    lastAttemptPrompt = prompt;
    const result = await attempt({
      stage: plan.stage,
      quality: plan.quality,
      prompt,
      message: plan.message,
      referenceImages: plan.referenceImages,
      referenceStrategy: plan.referenceStrategy,
    });
    if (result) return result;
  }

  stages.push({
    stage: 'paused',
    provider: providerForQuality(requestedQuality === 'quality' ? 'fast' : requestedQuality),
    message: 'This renderer paused the scene. Your scene is saved, but no new video has completed yet.',
    status: 'paused',
    blockedReasonCategory: moderationCategory(lastModerationError),
    quality: requestedQuality === 'quality' ? 'fast' : requestedQuality,
    referenceStrategy: 'no_reference_storybook',
    referenceCount: 0,
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
    finalPrompt: lastAttemptPrompt,
    stages,
    moderationDiagnostics: seedanceError?.diagnostics ?? null,
    suggestedPrompt: buildCreatorSafeRewrite(),
    sanitizedPrompt: seedanceError?.sanitizedPrompt ?? lastAttemptPrompt,
    sceneOptimization: optimization.diagnostics,
  });
  recordProviderFallbackDiagnostics(diagnostics);
  await recordRenderFailureMemory({
    userId: input.userId,
    characterId: input.characterId,
    provider: providerForQuality(requestedQuality === 'quality' ? 'fast' : requestedQuality),
    prompt: lastAttemptPrompt,
    successMode: optimization.successMode,
    safeStyle: optimization.safeStyle,
    referenceStrategy: diagnostics.referenceStrategy,
    referenceCount: 0,
    complexityScore: optimization.diagnostics.complexity.score,
    referenceQualityScore: optimization.diagnostics.referenceQualityScore,
    stage: 'paused',
    category: 'moderation',
    metadata: {
      providerFallbackStages: stages.map((stage) => stage.stage),
      blockedReasonCategory: diagnostics.blockedReasonCategory,
    },
  });
  console.warn('PROVIDER FALLBACK PAUSED:', {
    providerAttempted: diagnostics.providerAttempted,
    providersAttempted: diagnostics.providersAttempted,
    blockedReasonCategory: diagnostics.blockedReasonCategory,
    castSafePromptApplied: diagnostics.castSafePromptApplied,
    displayNameMasked: diagnostics.displayNameMasked,
    riskyTermsRemoved: diagnostics.riskyTermsRemoved,
    complexityScore: diagnostics.complexityScore,
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
