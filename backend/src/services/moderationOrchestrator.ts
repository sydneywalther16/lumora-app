import { createHash } from 'node:crypto';
import { query } from './db';

export type ModerationCategory =
  | 'identity_moderation'
  | 'celebrity_public_figure_moderation'
  | 'photorealistic_person_moderation'
  | 'glamour_editorial_moderation'
  | 'unsafe_wording'
  | 'provider_unknown_moderation';

export type ModerationRenderingMode =
  | 'photorealistic'
  | 'cinematic realism'
  | 'stylized cinematic'
  | 'painterly cinematic'
  | 'dreamlike cinematic'
  | 'animated cinematic';

export type ModerationProviderId = 'seedance' | 'veo' | 'kling' | 'runway';
export type ModerationSensitivity = 'low' | 'medium' | 'high';
export type ModerationEscalationLevel = 1 | 2 | 3 | 4 | 5;

export type ModerationProviderProfile = {
  provider: ModerationProviderId;
  label: string;
  realismTolerance: ModerationSensitivity;
  identitySensitivity: ModerationSensitivity;
  celebritySensitivity: ModerationSensitivity;
  stylizationFallbackPreference: ModerationRenderingMode;
  retryThresholds: {
    maxAttempts: number;
    providerFallbackLevel: ModerationEscalationLevel;
  };
  realismModeOrder: ModerationRenderingMode[];
};

export type ModerationRewriteResult = {
  prompt: string;
  changed: boolean;
  replacements: string[];
  categories: ModerationCategory[];
  rewriteStrategy: string;
  renderingMode: ModerationRenderingMode;
  realismModeSelected: ModerationRenderingMode;
  escalationLevel: ModerationEscalationLevel;
};

export type ModerationOrchestrationAttempt = ModerationRewriteResult & {
  attemptLabel: string;
  stageMessage: string;
  provider: ModerationProviderId;
  providerProfile: string;
  providerFallbackReady: boolean;
};

export type ModerationMemoryPreference = {
  id: string;
  preferredRenderingMode: ModerationRenderingMode;
  preferredEscalationLevel: ModerationEscalationLevel;
  preferredRewriteStrategy: string;
  successfulPrompt: string;
  updatedAt: string;
};

export type ModerationProviderSensitivityProfile = {
  realismTolerance: ModerationSensitivity;
  celebritySensitivity: ModerationSensitivity;
  identitySensitivity: ModerationSensitivity;
  stylizationFallbackPreference: ModerationRenderingMode;
};

export type ModerationOrchestrationPlan = {
  providerProfile: ModerationProviderProfile;
  originalPrompt: string;
  categories: ModerationCategory[];
  attempts: ModerationOrchestrationAttempt[];
  moderationMemoryApplied: boolean;
  moderationMemoryPreference: ModerationMemoryPreference | null;
};

export type ModerationOrchestrationResultInput = {
  userId?: string | null;
  characterId?: string | null;
  provider: ModerationProviderId;
  originalPrompt: string;
  categories: ModerationCategory[];
  attempt: ModerationOrchestrationAttempt | null;
  orchestrationPath: ModerationOrchestrationAttempt[];
  success: boolean;
  providerMessage?: string | null;
};

type RewriteRule = {
  pattern: RegExp;
  replacement: string;
  label: string;
  categories: ModerationCategory[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const moderationProviderProfiles: Record<ModerationProviderId, ModerationProviderProfile> = {
  seedance: {
    provider: 'seedance',
    label: 'Seedance',
    realismTolerance: 'low',
    identitySensitivity: 'high',
    celebritySensitivity: 'high',
    stylizationFallbackPreference: 'painterly cinematic',
    retryThresholds: {
      maxAttempts: 5,
      providerFallbackLevel: 5,
    },
    realismModeOrder: [
      'cinematic realism',
      'cinematic realism',
      'cinematic realism',
      'stylized cinematic',
      'painterly cinematic',
    ],
  },
  veo: {
    provider: 'veo',
    label: 'Veo',
    realismTolerance: 'medium',
    identitySensitivity: 'medium',
    celebritySensitivity: 'high',
    stylizationFallbackPreference: 'dreamlike cinematic',
    retryThresholds: {
      maxAttempts: 5,
      providerFallbackLevel: 5,
    },
    realismModeOrder: ['photorealistic', 'photorealistic', 'cinematic realism', 'stylized cinematic', 'dreamlike cinematic'],
  },
  kling: {
    provider: 'kling',
    label: 'Kling',
    realismTolerance: 'medium',
    identitySensitivity: 'medium',
    celebritySensitivity: 'high',
    stylizationFallbackPreference: 'animated cinematic',
    retryThresholds: {
      maxAttempts: 5,
      providerFallbackLevel: 5,
    },
    realismModeOrder: ['cinematic realism', 'cinematic realism', 'cinematic realism', 'stylized cinematic', 'animated cinematic'],
  },
  runway: {
    provider: 'runway',
    label: 'Runway',
    realismTolerance: 'medium',
    identitySensitivity: 'medium',
    celebritySensitivity: 'high',
    stylizationFallbackPreference: 'painterly cinematic',
    retryThresholds: {
      maxAttempts: 5,
      providerFallbackLevel: 5,
    },
    realismModeOrder: ['cinematic realism', 'cinematic realism', 'cinematic realism', 'stylized cinematic', 'painterly cinematic'],
  },
};

const moderationStageMessages: Record<ModerationEscalationLevel, string> = {
  1: 'Trying safer cinematic wording...',
  2: 'Trying safer non-celebrity framing...',
  3: 'Trying cinematic realism...',
  4: 'Trying stylized cinematic mode...',
  5: 'Trying painterly cinematic mode...',
};

const unsafeWordingRules: RewriteRule[] = [
  { pattern: /\bonlyfans\b/gi, replacement: 'creator portfolio', label: 'onlyfans -> creator portfolio', categories: ['unsafe_wording'] },
  { pattern: /\bsexy\b/gi, replacement: 'stylish', label: 'sexy -> stylish', categories: ['unsafe_wording'] },
  { pattern: /\bsexiness\b/gi, replacement: 'confidence', label: 'sexiness -> confidence', categories: ['unsafe_wording'] },
  { pattern: /\bseductive\b/gi, replacement: 'confident', label: 'seductive -> confident', categories: ['unsafe_wording'] },
  { pattern: /\bseducing\b/gi, replacement: 'posing confidently', label: 'seducing -> posing confidently', categories: ['unsafe_wording'] },
  { pattern: /\bsensual\b/gi, replacement: 'elegant', label: 'sensual -> elegant', categories: ['unsafe_wording'] },
  { pattern: /\bsultry\b/gi, replacement: 'cinematic', label: 'sultry -> cinematic', categories: ['unsafe_wording'] },
  { pattern: /\bprovocative\b/gi, replacement: 'editorial', label: 'provocative -> editorial', categories: ['unsafe_wording'] },
  { pattern: /\badult\b/gi, replacement: 'mature cinematic', label: 'adult -> mature cinematic', categories: ['unsafe_wording'] },
  { pattern: /\berotic\b/gi, replacement: 'fashion-inspired', label: 'erotic -> fashion-inspired', categories: ['unsafe_wording'] },
  { pattern: /\bnude\b/gi, replacement: 'fully clothed', label: 'nude -> fully clothed', categories: ['unsafe_wording'] },
  { pattern: /\bnudity\b/gi, replacement: 'fully clothed styling', label: 'nudity -> fully clothed styling', categories: ['unsafe_wording'] },
  { pattern: /\blingerie\b/gi, replacement: 'fashion outfit', label: 'lingerie -> fashion outfit', categories: ['unsafe_wording'] },
  { pattern: /\bboudoir\b/gi, replacement: 'studio portrait', label: 'boudoir -> studio portrait', categories: ['unsafe_wording'] },
  { pattern: /\bfetish\b/gi, replacement: 'avant-garde fashion', label: 'fetish -> avant-garde fashion', categories: ['unsafe_wording'] },
  { pattern: /\bthirst\s*trap\b/gi, replacement: 'confident editorial portrait', label: 'thirst trap -> confident editorial portrait', categories: ['unsafe_wording'] },
  { pattern: /\brevealing\b/gi, replacement: 'tailored', label: 'revealing -> tailored', categories: ['unsafe_wording'] },
  { pattern: /\bsheer\b/gi, replacement: 'layered', label: 'sheer -> layered', categories: ['unsafe_wording'] },
  { pattern: /\bsee[-\s]?through\b/gi, replacement: 'layered', label: 'see-through -> layered', categories: ['unsafe_wording'] },
  { pattern: /\bcleavage\b/gi, replacement: 'neckline', label: 'cleavage -> neckline', categories: ['unsafe_wording'] },
  { pattern: /\bskimpy\b/gi, replacement: 'minimalist', label: 'skimpy -> minimalist', categories: ['unsafe_wording'] },
  { pattern: /\bbedroom\b/gi, replacement: 'cinematic studio', label: 'bedroom -> cinematic studio', categories: ['unsafe_wording'] },
];

const levelOneRules: RewriteRule[] = [
  ...unsafeWordingRules,
  {
    pattern: /\bphotorealistic\s+(woman|man|person|girl|boy|model)\b/gi,
    replacement: 'cinematic character',
    label: 'photorealistic person -> cinematic character',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\beditorial\s+fashion\s+realism\b/gi,
    replacement: 'cinematic dramatic realism',
    label: 'editorial fashion realism -> cinematic dramatic realism',
    categories: ['photorealistic_person_moderation', 'glamour_editorial_moderation'],
  },
  {
    pattern: /\beditorial\s+realism\b/gi,
    replacement: 'cinematic dramatic realism',
    label: 'editorial realism -> cinematic dramatic realism',
    categories: ['photorealistic_person_moderation', 'glamour_editorial_moderation'],
  },
  {
    pattern: /\bluxury\s+glamour\b/gi,
    replacement: 'elegant cinematic tone',
    label: 'luxury glamour -> elegant cinematic tone',
    categories: ['glamour_editorial_moderation'],
  },
  {
    pattern: /\bglamour\b/gi,
    replacement: 'elegant cinematic styling',
    label: 'glamour -> elegant cinematic styling',
    categories: ['glamour_editorial_moderation'],
  },
  {
    pattern: /\bmultimodal\s+identity\s+references?\b/gi,
    replacement: 'visual continuity references',
    label: 'identity references -> visual continuity references',
    categories: ['identity_moderation'],
  },
  {
    pattern: /\bconsistent\s+identity\b/gi,
    replacement: 'consistent visual continuity',
    label: 'consistent identity -> consistent visual continuity',
    categories: ['identity_moderation'],
  },
  {
    pattern: /\bpreserve\s+identity\b/gi,
    replacement: 'preserve visual continuity',
    label: 'preserve identity -> preserve visual continuity',
    categories: ['identity_moderation'],
  },
  {
    pattern: /\bpreserving\s+identity\b/gi,
    replacement: 'preserving visual continuity',
    label: 'preserving identity -> preserving visual continuity',
    categories: ['identity_moderation'],
  },
  {
    pattern: /\bidentity\s+across\b/gi,
    replacement: 'visual continuity across',
    label: 'identity across -> visual continuity across',
    categories: ['identity_moderation'],
  },
];

const levelTwoRules: RewriteRule[] = [
  {
    pattern: /\bhyper[-\s]?realistic\b/gi,
    replacement: 'cinematic realism',
    label: 'hyperrealistic -> cinematic realism',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\bphoto[-\s]?realistic\b/gi,
    replacement: 'cinematic realism',
    label: 'photorealistic -> cinematic realism',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\brealistic\s+(woman|man|person|girl|boy|model|face|portrait)\b/gi,
    replacement: 'cinematic character',
    label: 'realistic person -> cinematic character',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\breal\s+(woman|man|person|girl|boy|model)\b/gi,
    replacement: 'original cinematic character',
    label: 'real person -> original cinematic character',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\breal[-\s]?life\b/gi,
    replacement: 'screen-ready',
    label: 'real life -> screen-ready',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\blife[-\s]?like\b/gi,
    replacement: 'cinematic realism',
    label: 'lifelike -> cinematic realism',
    categories: ['photorealistic_person_moderation'],
  },
  {
    pattern: /\btrue[-\s]?to[-\s]?life\b/gi,
    replacement: 'cinematic realism',
    label: 'true-to-life -> cinematic realism',
    categories: ['photorealistic_person_moderation'],
  },
];

const levelCelebrityRules: RewriteRule[] = [
  {
    pattern: /\bsuperstar\b/gi,
    replacement: 'confident protagonist',
    label: 'superstar -> confident protagonist',
    categories: ['celebrity_public_figure_moderation'],
  },
  {
    pattern: /\bluxury\s+influencer\b/gi,
    replacement: 'elegant cinematic figure',
    label: 'luxury influencer -> elegant cinematic figure',
    categories: ['celebrity_public_figure_moderation', 'glamour_editorial_moderation'],
  },
  {
    pattern: /\brealistic\s+influencer\b/gi,
    replacement: 'stylized cinematic protagonist',
    label: 'realistic influencer -> stylized cinematic protagonist',
    categories: ['photorealistic_person_moderation', 'celebrity_public_figure_moderation'],
  },
  {
    pattern: /\bcelebrity\b/gi,
    replacement: 'original screen performer',
    label: 'celebrity -> original screen performer',
    categories: ['celebrity_public_figure_moderation'],
  },
  {
    pattern: /\bpublic\s+figure\b/gi,
    replacement: 'fictional public-facing character',
    label: 'public figure -> fictional public-facing character',
    categories: ['celebrity_public_figure_moderation'],
  },
  {
    pattern: /\binfluencer\b/gi,
    replacement: 'creative protagonist',
    label: 'influencer -> creative protagonist',
    categories: ['celebrity_public_figure_moderation'],
  },
  {
    pattern: /\bfamous\s+(actor|actress|singer|musician|model|person|creator)\b/gi,
    replacement: 'original performer',
    label: 'famous person -> original performer',
    categories: ['celebrity_public_figure_moderation'],
  },
  {
    pattern: /\blook[-\s]?alike\b/gi,
    replacement: 'original character',
    label: 'lookalike -> original character',
    categories: ['celebrity_public_figure_moderation'],
  },
  {
    pattern: /\blooks?\s+like\b/gi,
    replacement: 'has an original cinematic presence inspired by',
    label: 'looks like -> original cinematic presence',
    categories: ['celebrity_public_figure_moderation'],
  },
];

function isUuid(value: string | null | undefined) {
  return typeof value === 'string' && uuidPattern.test(value.trim());
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueCategories(categories: ModerationCategory[]) {
  return Array.from(new Set(categories));
}

function rewriteStrategyForLevel(level: ModerationEscalationLevel) {
  if (level === 1) return 'minor wording rewrite';
  if (level === 2) return 'remove celebrity and influencer wording';
  if (level === 3) return 'downgrade photorealistic language to cinematic realism';
  if (level === 4) return 'downgrade to stylized cinematic realism';
  return 'fallback to painterly or dreamlike cinematic mode';
}

function renderingModeForLevel(level: ModerationEscalationLevel, profile: ModerationProviderProfile): ModerationRenderingMode {
  return profile.realismModeOrder[level - 1] ?? profile.stylizationFallbackPreference;
}

export function providerSensitivityProfile(
  profile: ModerationProviderProfile,
): ModerationProviderSensitivityProfile {
  return {
    realismTolerance: profile.realismTolerance,
    celebritySensitivity: profile.celebritySensitivity,
    identitySensitivity: profile.identitySensitivity,
    stylizationFallbackPreference: profile.stylizationFallbackPreference,
  };
}

function applyRules(prompt: string, rules: RewriteRule[]) {
  let nextPrompt = prompt;
  const replacements: string[] = [];
  const categories: ModerationCategory[] = [];

  for (const rule of rules) {
    const before = nextPrompt;
    nextPrompt = nextPrompt.replace(rule.pattern, rule.replacement);
    if (before !== nextPrompt) {
      replacements.push(rule.label);
      categories.push(...rule.categories);
    }
  }

  return {
    prompt: collapseWhitespace(nextPrompt),
    replacements,
    categories: uniqueCategories(categories),
  };
}

function promptPrefixForLevel(level: ModerationEscalationLevel, renderingMode: ModerationRenderingMode) {
  const continuityClause = 'Preserve storyboard structure, character continuity, emotional pacing, wardrobe, environment, and camera intent.';

  if (level === 1) {
    return `Family-safe ${renderingMode} wording. ${continuityClause}`;
  }

  if (level === 2) {
    return `Original-protagonist cinematic mode: use a fictional protagonist with distinctive screen presence. ${continuityClause}`;
  }

  if (level === 3) {
    return `Cinematic realism mode: use screen-ready dramatic realism for an original character. ${continuityClause}`;
  }

  if (level === 4) {
    return `Stylized cinematic realism mode: original character, fully clothed styling, expressive lighting, tasteful composition. ${continuityClause}`;
  }

  return `${renderingMode} fallback: original fictional character, fully clothed styling, distinctive non-public-figure design, expressive cinematic composition. ${continuityClause}`;
}

function rulesForLevel(level: ModerationEscalationLevel) {
  const rules = [...levelOneRules];
  if (level >= 2) rules.push(...levelCelebrityRules);
  if (level >= 3) rules.push(...levelTwoRules);
  if (level >= 4) {
    rules.push({
      pattern: /\beditorial\b/gi,
      replacement: 'cinematic',
      label: 'editorial -> cinematic',
      categories: ['glamour_editorial_moderation'],
    });
  }
  if (level >= 5) {
    rules.push({
      pattern: /\b(realistic|realism|photographic|photo[-\s]?real)\b/gi,
      replacement: 'painterly cinematic',
      label: 'realistic/photo-real -> painterly cinematic',
      categories: ['photorealistic_person_moderation'],
    });
  }
  return rules;
}

export function detectModerationCategories(input: {
  prompt?: string | null;
  providerResponse?: unknown;
  referenceImageCount?: number;
  includeUnknownFallback?: boolean;
}): ModerationCategory[] {
  const providerText = stringifyModerationValue(input.providerResponse);
  const text = [
    input.prompt ?? '',
    providerText,
  ].join(' ').toLowerCase();
  const categories: ModerationCategory[] = [];

  if (/\b(identity|same face|consistent identity|likeness|face reference|reference image|visual reference|multimodal identity|the woman from|the man from)\b/i.test(text)) {
    categories.push('identity_moderation');
  }

  if (/\b(celebrity|public figure|influencer|superstar|luxury influencer|famous actor|famous actress|famous singer|famous model|lookalike|look alike|looks like)\b/i.test(text)) {
    categories.push('celebrity_public_figure_moderation');
  }

  if (/\b(photorealistic|photo-realistic|hyperrealistic|hyper-realistic|realistic woman|realistic man|realistic person|real person|lifelike|true-to-life|editorial realism|editorial fashion realism)\b/i.test(text)) {
    categories.push('photorealistic_person_moderation');
  }

  if (/\b(glamour|luxury glamour|luxury influencer|editorial realism|editorial fashion realism|boudoir|seductive|sultry|provocative|lingerie)\b/i.test(text)) {
    categories.push('glamour_editorial_moderation');
  }

  if (/\b(nsfw|nude|nudity|erotic|sexual|onlyfans|fetish|revealing|sheer|see-through|cleavage|skimpy|policy violation|content policy|safety filter|flagged as sensitive|e005)\b/i.test(text)) {
    categories.push('unsafe_wording');
  }

  if (providerText && !categories.length && input.includeUnknownFallback) {
    categories.push('provider_unknown_moderation');
  }

  if ((input.referenceImageCount ?? 0) > 0 && !categories.includes('identity_moderation')) {
    categories.push('identity_moderation');
  }

  return uniqueCategories(categories);
}

export function rewritePromptForEscalationLevel(input: {
  prompt: string;
  provider?: ModerationProviderId;
  level: ModerationEscalationLevel;
  categories?: ModerationCategory[];
}): ModerationRewriteResult {
  const providerProfile = moderationProviderProfiles[input.provider ?? 'seedance'];
  const renderingMode = renderingModeForLevel(input.level, providerProfile);
  const rewritten = applyRules(input.prompt, rulesForLevel(input.level));
  const detectedCategories = detectModerationCategories({
    prompt: input.prompt,
    includeUnknownFallback: false,
  });
  const categories = uniqueCategories([
    ...(input.categories ?? []),
    ...detectedCategories,
    ...rewritten.categories,
  ]);
  const prefix = promptPrefixForLevel(input.level, renderingMode);
  const prompt = collapseWhitespace(`${prefix} ${rewritten.prompt}`);

  return {
    prompt,
    changed: prompt !== collapseWhitespace(input.prompt),
    replacements: rewritten.replacements,
    categories,
    rewriteStrategy: rewriteStrategyForLevel(input.level),
    renderingMode,
    realismModeSelected: renderingMode,
    escalationLevel: input.level,
  };
}

export async function createModerationOrchestrationPlan(input: {
  prompt: string;
  provider?: ModerationProviderId;
  userId?: string | null;
  characterId?: string | null;
  referenceImageCount?: number;
}): Promise<ModerationOrchestrationPlan> {
  const providerProfile = moderationProviderProfiles[input.provider ?? 'seedance'];
  const categories = detectModerationCategories({
    prompt: input.prompt,
    referenceImageCount: input.referenceImageCount,
    includeUnknownFallback: false,
  });
  const memoryPreference = await loadModerationMemoryPreference({
    provider: providerProfile.provider,
    userId: input.userId,
    characterId: input.characterId,
  });
  const firstLevel = memoryPreference?.preferredEscalationLevel ?? 1;
  const levels: ModerationEscalationLevel[] = [1, 2, 3, 4, 5]
    .filter((level): level is ModerationEscalationLevel => level >= firstLevel)
    .slice(0, providerProfile.retryThresholds.maxAttempts);
  const attempts = levels.map((level) => {
    const rewrite = rewritePromptForEscalationLevel({
      prompt: input.prompt,
      provider: providerProfile.provider,
      level,
      categories,
    });

    return {
      ...rewrite,
      attemptLabel: `moderation_level_${level}`,
      stageMessage: moderationStageMessages[level],
      provider: providerProfile.provider,
      providerProfile: providerProfile.label,
      providerFallbackReady: level >= providerProfile.retryThresholds.providerFallbackLevel,
    };
  });

  return {
    providerProfile,
    originalPrompt: input.prompt,
    categories,
    attempts,
    moderationMemoryApplied: Boolean(memoryPreference),
    moderationMemoryPreference: memoryPreference,
  };
}

export function moderationRetryStages(attempts: ModerationOrchestrationAttempt[]) {
  return Array.from(new Set(attempts.map((attempt) => attempt.stageMessage)));
}

export function logModerationOrchestration(input: {
  event: 'attempt' | 'blocked' | 'succeeded' | 'failed';
  attempt: ModerationOrchestrationAttempt | null;
  providerMessage?: string | null;
  providerProfile: ModerationProviderProfile;
  orchestrationPath: ModerationOrchestrationAttempt[];
}) {
  const payload = {
    event: input.event,
    moderationCategory: input.attempt?.categories ?? [],
    rewriteStrategy: input.attempt?.rewriteStrategy ?? null,
    escalationLevel: input.attempt?.escalationLevel ?? null,
    renderingMode: input.attempt?.renderingMode ?? null,
    realismModeSelected: input.attempt?.realismModeSelected ?? null,
    providerModerationProfile: input.providerProfile.label,
    providerSensitivityProfile: providerSensitivityProfile(input.providerProfile),
    provider: input.providerProfile.provider,
    providerMessage: input.providerMessage ?? null,
    successfulFallbackPath: input.event === 'succeeded'
      ? input.orchestrationPath.map((attempt) => `${attempt.attemptLabel}:${attempt.realismModeSelected}`).join(' -> ')
      : null,
    finalSuccessfulOrchestrationPath: input.event === 'succeeded'
      ? input.orchestrationPath.map((attempt) => `${attempt.attemptLabel}:${attempt.realismModeSelected}`).join(' -> ')
      : null,
    orchestrationPath: input.orchestrationPath.map((attempt) => ({
      escalationLevel: attempt.escalationLevel,
      rewriteStrategy: attempt.rewriteStrategy,
      renderingMode: attempt.renderingMode,
      realismModeSelected: attempt.realismModeSelected,
      stageMessage: attempt.stageMessage,
      categories: attempt.categories,
      providerProfile: attempt.providerProfile,
    })),
  };

  if (input.event === 'blocked' || input.event === 'failed') {
    console.warn('MODERATION ORCHESTRATOR:', payload);
  } else {
    console.info('MODERATION ORCHESTRATOR:', payload);
  }
}

export async function recordModerationOrchestrationResult(input: ModerationOrchestrationResultInput) {
  const promptFingerprint = moderationPromptFingerprint({
    provider: input.provider,
    userId: input.userId,
    characterId: input.characterId,
    prompt: input.originalPrompt,
  });
  const userId = isUuid(input.userId) ? input.userId?.trim() ?? null : null;

  try {
    await query(
      `insert into moderation_orchestration_memory (
         user_id,
         character_id,
         provider,
         prompt_fingerprint,
         categories,
         preferred_rendering_mode,
         preferred_escalation_level,
         preferred_rewrite_strategy,
         successful_prompt,
         failed_count,
         success_count,
         last_provider_message,
         orchestration_path,
         provider_sensitivity_profile,
         successful_fallback_path
       )
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
       on conflict (provider, prompt_fingerprint) do update
       set
         categories = excluded.categories,
         preferred_rendering_mode = excluded.preferred_rendering_mode,
         preferred_escalation_level = excluded.preferred_escalation_level,
         preferred_rewrite_strategy = excluded.preferred_rewrite_strategy,
         successful_prompt = coalesce(excluded.successful_prompt, moderation_orchestration_memory.successful_prompt),
         failed_count = moderation_orchestration_memory.failed_count + excluded.failed_count,
         success_count = moderation_orchestration_memory.success_count + excluded.success_count,
         last_provider_message = excluded.last_provider_message,
         orchestration_path = excluded.orchestration_path,
         provider_sensitivity_profile = excluded.provider_sensitivity_profile,
         successful_fallback_path = coalesce(excluded.successful_fallback_path, moderation_orchestration_memory.successful_fallback_path),
         updated_at = now()`,
      [
        userId,
        input.characterId ?? null,
        input.provider,
        promptFingerprint,
        JSON.stringify(input.categories),
        input.attempt?.realismModeSelected ?? 'cinematic realism',
        input.attempt?.escalationLevel ?? 1,
        input.attempt?.rewriteStrategy ?? 'minor wording rewrite',
        input.success ? input.attempt?.prompt ?? null : null,
        input.success ? 0 : 1,
        input.success ? 1 : 0,
        input.providerMessage ?? null,
        JSON.stringify(input.orchestrationPath.map((attempt) => ({
          escalationLevel: attempt.escalationLevel,
          rewriteStrategy: attempt.rewriteStrategy,
          renderingMode: attempt.renderingMode,
          realismModeSelected: attempt.realismModeSelected,
          stageMessage: attempt.stageMessage,
          categories: attempt.categories,
          providerProfile: attempt.providerProfile,
          providerFallbackReady: attempt.providerFallbackReady,
        }))),
        JSON.stringify(providerSensitivityProfile(moderationProviderProfiles[input.provider])),
        input.success
          ? input.orchestrationPath.map((attempt) => `${attempt.attemptLabel}:${attempt.realismModeSelected}`).join(' -> ')
          : null,
      ],
    );
  } catch (error) {
    if (isMissingModerationMemorySchema(error)) {
      console.warn('MODERATION ORCHESTRATOR MEMORY FALLBACK:', {
        message: 'Run the Moderation Orchestrator migration to persist provider-safe rewrite preferences.',
        error: error instanceof Error ? error.message : error,
      });
      return;
    }

    throw error;
  }
}

async function loadModerationMemoryPreference(input: {
  provider: ModerationProviderId;
  userId?: string | null;
  characterId?: string | null;
}): Promise<ModerationMemoryPreference | null> {
  const userId = isUuid(input.userId) ? input.userId?.trim() ?? null : null;

  try {
    const result = await query<{
      id: string;
      preferredRenderingMode: string;
      preferredEscalationLevel: number;
      preferredRewriteStrategy: string;
      successfulPrompt: string | null;
      updatedAt: string;
    }>(
      `select
         id,
         preferred_rendering_mode as "preferredRenderingMode",
         preferred_escalation_level as "preferredEscalationLevel",
         preferred_rewrite_strategy as "preferredRewriteStrategy",
         successful_prompt as "successfulPrompt",
         updated_at as "updatedAt"
       from moderation_orchestration_memory
       where provider = $1
         and success_count > 0
         and (failed_count > 0 or preferred_escalation_level > 1)
         and ($2::uuid is null or user_id is null or user_id = $2::uuid)
         and ($3::text is null or character_id is null or character_id = $3::text)
       order by
         case when user_id = $2::uuid then 0 else 1 end,
         case when character_id = $3::text then 0 else 1 end,
         updated_at desc
       limit 1`,
      [input.provider, userId, input.characterId ?? null],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      preferredRenderingMode: normalizeRenderingMode(row.preferredRenderingMode),
      preferredEscalationLevel: normalizeEscalationLevel(row.preferredEscalationLevel),
      preferredRewriteStrategy: row.preferredRewriteStrategy || 'minor wording rewrite',
      successfulPrompt: row.successfulPrompt ?? '',
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    if (isMissingModerationMemorySchema(error)) return null;
    throw error;
  }
}

function normalizeEscalationLevel(value: number): ModerationEscalationLevel {
  if (value >= 5) return 5;
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

function normalizeRenderingMode(value: string): ModerationRenderingMode {
  if (value === 'photorealistic' || value === 'realistic') return 'photorealistic';
  if (value === 'cinematic realism' || value === 'cinematic') return 'cinematic realism';
  if (value === 'stylized cinematic') return 'stylized cinematic';
  if (value === 'painterly cinematic') return 'painterly cinematic';
  if (value === 'dreamlike cinematic') return 'dreamlike cinematic';
  if (value === 'animated cinematic') return 'animated cinematic';
  return 'cinematic realism';
}

function moderationPromptFingerprint(input: {
  provider: ModerationProviderId;
  userId?: string | null;
  characterId?: string | null;
  prompt: string;
}) {
  const normalizedPrompt = collapseWhitespace(input.prompt.toLowerCase()).slice(0, 1500);
  return createHash('sha256')
    .update([
      input.provider,
      input.userId ?? 'anonymous',
      input.characterId ?? 'no-character',
      normalizedPrompt,
    ].join('|'))
    .digest('hex');
}

function stringifyModerationValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isMissingModerationMemorySchema(error: unknown) {
  const text = stringifyModerationValue(error).toLowerCase();
  return (
    text.includes('moderation_orchestration_memory') ||
    text.includes('database is not configured') ||
    text.includes('42p01') ||
    text.includes('42703')
  );
}
