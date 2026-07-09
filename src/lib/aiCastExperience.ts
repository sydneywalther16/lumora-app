export type ViralScenePreset = {
  id: string;
  label: string;
  prompt: string;
};

export type PromptPolishResult = {
  prompt: string;
  promptPolished: boolean;
  additions: string[];
};

export type CaptionSuggestions = {
  short: string;
  dramatic: string;
  realityShow: string;
  dreamyCinematic: string;
};

export type CreateSceneAnchorGuidance = {
  title: string;
  body: string;
  helper: string;
};

export type AiCastReadinessItem = {
  key: string;
  label: string;
  ready: boolean;
  status: string;
};

export type AiCastReadinessInput = {
  selfCharacterSaved: boolean;
  verificationVideoSaved: boolean;
  klingExactLikenessReady: boolean;
  sceneAnchorConfigured: boolean;
  draftsReady?: boolean;
  continueStoryReady?: boolean;
  audioConfigured?: boolean;
  viralPolishReady?: boolean;
};

type DraftLabelInput = {
  exactLikenessRoute?: string | null;
  generationMode?: string | null;
  sceneAnchorStrategy?: string | null;
  primaryInputType?: string | null;
  startFrameSource?: string | null;
  identityReferencesPassedToVideoStage?: boolean | null;
  identityReferenceMode?: string | null;
  stage2ProviderRouteType?: string | null;
  referenceStrategy?: string | null;
  sceneAnchorGenerated?: boolean | null;
  audioConfigured?: boolean | null;
};

type ContinueStoryInput = {
  exactLikenessRoute?: string | null;
  generationMode?: string | null;
  sceneAnchorStrategy?: string | null;
  referenceStrategy?: string | null;
  startFrameSource?: string | null;
  identityReferencesPassedToVideoStage?: boolean | null;
  identityReferenceMode?: string | null;
  stage2ProviderModel?: string | null;
  stage2ProviderRouteType?: string | null;
  rawReferenceVisualInputsSentToStage2?: boolean | null;
  klingReferenceDiagnostics?: Record<string, unknown> | null;
  outfitTermsDetected?: string[] | null;
  environmentTermsDetected?: string[] | null;
  framingIntent?: string | null;
};

const outfitPattern = /\b(?:ivory|white|black|red|blue|pink|gold|silver|emerald|silk|satin|velvet|flowing|tailored|sparkling|evening|red\s*carpet|fairy[-\s]?tale|gown|dress|suit|coat|jacket|jeans|skirt|boots|heels|robe)\b/i;
const framingPattern = /\b(?:full[-\s]?body|medium[-\s]?wide|medium[-\s]?full|wide shot|cinematic shot|walking shot|standing shot|visible ground|open space)\b/i;
const motionPattern = /\b(?:walk|walking|turn|slow turn|moving|passes through|enters|arrives|steps|camera motion|tracking shot|gentle camera)\b/i;
const identityPattern = /\b(?:identity|self character|same face|same hair|saved self|consistent face|consistent body)\b/i;

export const viralScenePresets: ViralScenePreset[] = [
  {
    id: 'golden-hour-garden-walk',
    label: 'Golden-hour garden walk',
    prompt: 'Full-body cinematic walking shot through a peaceful flower garden at golden hour, wearing a flowing ivory dress, clean silhouette, visible garden around the self character, natural arm movement, gentle camera drift, consistent saved self-character identity.',
  },
  {
    id: 'red-carpet-entrance',
    label: 'Red carpet entrance',
    prompt: 'Medium-wide red carpet entrance at night, elegant red carpet gown, soft flashbulb glow, confident slow walk, clear full figure, polished cinematic camera move, consistent saved self-character identity.',
  },
  {
    id: 'rainy-city-sidewalk',
    label: 'Rainy city sidewalk',
    prompt: 'Medium-full rainy city sidewalk scene, tailored long coat, reflective pavement, slow cinematic walk under warm storefront lights, clear silhouette, gentle hair movement, consistent saved self-character identity.',
  },
  {
    id: 'luxury-hotel-lobby',
    label: 'Luxury hotel lobby',
    prompt: 'Medium-wide luxury hotel lobby entrance, satin evening outfit, warm chandelier light, smooth walking motion across polished marble, visible environment, elegant camera glide, consistent saved self-character identity.',
  },
  {
    id: 'sunset-vineyard',
    label: 'Sunset vineyard',
    prompt: 'Full-body cinematic walk through a sunset vineyard, airy linen dress, golden sky, rows of vines visible around the self character, relaxed posture, gentle camera motion, consistent saved self-character identity.',
  },
  {
    id: 'dreamy-bedroom-mirror-shot',
    label: 'Dreamy bedroom mirror shot',
    prompt: 'Medium-wide dreamy bedroom mirror scene, soft robe over a tasteful outfit, warm lamps, the self character turns gently toward the mirror with clean framing and visible room atmosphere, consistent saved self-character identity.',
  },
  {
    id: 'reality-show-confessional',
    label: 'Reality-show confessional',
    prompt: 'Polished reality-show confessional setup, medium shot, expressive self character seated in a clean studio chair with soft light, subtle hand movement, cinematic lens, consistent saved self-character identity.',
  },
  {
    id: 'cinematic-slow-turn',
    label: 'Cinematic slow turn',
    prompt: 'Medium-full cinematic slow turn in an elegant open studio, flowing black dress, clean silhouette, soft hair movement, slow orbiting camera, consistent saved self-character identity.',
  },
  {
    id: 'paparazzi-arrival',
    label: 'Paparazzi arrival',
    prompt: 'Medium-wide paparazzi arrival outside an upscale venue, sparkling evening gown, confident walking entrance, warm flashes in the background, clear full figure, cinematic camera tracking, consistent saved self-character identity.',
  },
  {
    id: 'fairy-tale-courtyard',
    label: 'Fairy-tale courtyard',
    prompt: 'Full-body fairy-tale courtyard walk, romantic pastel gown, flowers and stone archways around the self character, open-space staging, clean silhouette, gentle storybook camera motion, consistent saved self-character identity.',
  },
];

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function sentenceHas(text: string, pattern: RegExp) {
  return pattern.test(text);
}

export function applyViralScenePreset(currentPrompt: string, preset: ViralScenePreset) {
  const current = compactText(currentPrompt);
  if (!current) return preset.prompt;
  if (current.toLowerCase().includes(preset.prompt.toLowerCase())) return current;
  return `${current}\n\nAI cast preset: ${preset.prompt}`;
}

export function polishKlingCinematicPrompt(inputPrompt: string): PromptPolishResult {
  const source = compactText(inputPrompt);
  const base = source || 'A cinematic AI cast scene with the saved self character.';
  const additions: string[] = [];

  if (!sentenceHas(base, framingPattern)) {
    additions.push('Use medium-wide or full-body cinematic framing with visible environment around the subject.');
  }
  if (!sentenceHas(base, outfitPattern)) {
    additions.push('Style the scene with a polished outfit that fits the setting.');
  }
  if (!sentenceHas(base, motionPattern)) {
    additions.push('Add natural movement, relaxed posture, subtle arm motion, and gentle camera drift.');
  }
  if (!sentenceHas(base, identityPattern)) {
    additions.push('Preserve the saved self character identity, face, hair, proportions, and silhouette across motion.');
  }
  if (!/\b(?:garden|city|hotel|lobby|courtyard|vineyard|bedroom|street|venue|environment|room|beach|forest|studio)\b/i.test(base)) {
    additions.push('Make the environment specific and readable in the opening frame.');
  }

  return {
    prompt: additions.length ? `${base} ${additions.join(' ')}` : base,
    promptPolished: additions.length > 0,
    additions,
  };
}

export function buildViralCaptionSuggestions(prompt: string, characterName?: string | null): CaptionSuggestions {
  const name = characterName?.trim() || 'my Lumora self character';
  const idea = compactText(prompt).replace(/[.?!]+$/g, '');
  const shortIdea = idea.length > 84 ? `${idea.slice(0, 81).trim()}...` : idea || 'a cinematic AI cast scene';

  return {
    short: `${name} just entered the scene.`,
    dramatic: `The moment shifted when ${name} walked into ${shortIdea}.`,
    realityShow: `Confessional energy: ${name} knew exactly what this scene needed.`,
    dreamyCinematic: `Soft light, slow motion, and ${name} becoming the story.`,
  };
}

export function buildSceneAnchorCreateGuidance(input: {
  klingReferenceSelected: boolean;
  klingExactReady: boolean;
  sceneAnchorConfigured: boolean;
}): CreateSceneAnchorGuidance | null {
  if (!input.klingReferenceSelected || !input.klingExactReady) return null;
  if (input.sceneAnchorConfigured) {
    return {
      title: 'Kling Reference Beta',
      body: 'Experimental exact-likeness testing. Seedance Fast is the safer first render path.',
      helper: 'Scene-anchor mode stages a start frame before Kling animation when you intentionally test likeness.',
    };
  }
  return {
    title: 'Kling Reference Beta needs setup',
    body: 'Use Seedance Fast or Demo Mode for the MVP flow.',
    helper: 'Identity-only fallback remains available for testing without a scene anchor.',
  };
}

export function isDemoModeEngine(engine: string | null | undefined): boolean {
  return engine === 'mock';
}

export function shouldShowCreatePreparingState(input: {
  engine: string;
  isHydrated: boolean;
  sessionLoading: boolean;
  healthDiagnosticsStatus: 'checking' | 'connected' | 'offline';
  referenceLoading: boolean;
}): boolean {
  if (!input.isHydrated || input.sessionLoading || input.referenceLoading) return true;
  if (isDemoModeEngine(input.engine)) return false;
  return input.healthDiagnosticsStatus === 'checking';
}

export function buildAiCastReadiness(input: AiCastReadinessInput): AiCastReadinessItem[] {
  return [
    {
      key: 'self-character',
      label: 'Self character saved',
      ready: input.selfCharacterSaved,
      status: input.selfCharacterSaved ? 'Ready' : 'Needs setup',
    },
    {
      key: 'verification-video',
      label: 'Verification video saved',
      ready: input.verificationVideoSaved,
      status: input.verificationVideoSaved ? 'Ready' : 'Missing',
    },
    {
      key: 'kling-exact',
      label: 'Kling Reference Beta',
      ready: input.klingExactLikenessReady,
      status: input.klingExactLikenessReady ? 'Ready' : 'Unavailable',
    },
    {
      key: 'scene-anchor',
      label: 'Scene anchor provider',
      ready: input.sceneAnchorConfigured,
      status: input.sceneAnchorConfigured ? 'Configured' : 'Not configured',
    },
    {
      key: 'drafts-continue',
      label: 'Drafts and Continue Story',
      ready: input.draftsReady !== false && input.continueStoryReady !== false,
      status: input.draftsReady !== false && input.continueStoryReady !== false ? 'Ready' : 'Needs draft',
    },
    {
      key: 'audio',
      label: 'Sound/audio',
      ready: Boolean(input.audioConfigured),
      status: input.audioConfigured ? 'Configured' : 'Not configured yet',
    },
    {
      key: 'viral-polish',
      label: 'Viral polish',
      ready: input.viralPolishReady !== false,
      status: input.viralPolishReady !== false ? 'Ready' : 'Needs prompt',
    },
  ];
}

export function buildDraftAiCastLabels(job: DraftLabelInput): string[] {
  const labels: string[] = [];
  const isKlingExact =
    job.exactLikenessRoute === 'kling_reference' ||
    job.generationMode === 'kling-exact-likeness-reference';

  if (isKlingExact) {
    labels.push('Kling Reference Beta');
    if (job.sceneAnchorStrategy === 'scene_anchor_still' || job.primaryInputType === 'scene_anchor_still') {
      labels.push('Scene-anchor Beta');
      if (job.startFrameSource === 'scene_anchor') labels.push('Starts from scene anchor');
      if (job.identityReferencesPassedToVideoStage === false || job.identityReferenceMode === 'stage1_only') {
        labels.push('Identity references baked into anchor');
      }
      if (job.stage2ProviderRouteType === 'image_to_video') labels.push('Image-to-video stage');
    } else if (
      job.referenceStrategy === 'direct_identity_references' ||
      job.sceneAnchorStrategy === 'direct_identity_references'
    ) {
      labels.push('Identity-only fallback');
    }
    labels.push('Continue Story ready');
    if (!job.audioConfigured) labels.push('No audio');
    return labels;
  }

  labels.push('AI cast video');
  if (!job.audioConfigured) labels.push('No audio');
  return labels;
}

export function buildContinueStoryScaffold(item: ContinueStoryInput) {
  const isKlingExact =
    item.exactLikenessRoute === 'kling_reference' ||
    item.generationMode === 'kling-exact-likeness-reference';
  if (!isKlingExact) return '';

  const outfit = item.outfitTermsDetected?.length
    ? ` Preserve wardrobe continuity from this scene: ${item.outfitTermsDetected.join(', ')}.`
    : '';
  const environment = item.environmentTermsDetected?.length
    ? ` Keep visual continuity with ${item.environmentTermsDetected.join(', ')} unless the next beat changes setting.`
    : '';
  const diagnostics = item.klingReferenceDiagnostics ?? {};
  const diagnosticSceneAnchorStrategy = typeof diagnostics.sceneAnchorStrategy === 'string'
    ? diagnostics.sceneAnchorStrategy
    : null;
  const anchor = (item.sceneAnchorStrategy ?? diagnosticSceneAnchorStrategy) === 'scene_anchor_still'
    ? ' Continue with Kling Reference Beta scene-anchor planning, using the previous scene context or a new scene anchor as the image-to-video start frame rather than a raw front portrait.'
    : ' Continue with Kling Reference Beta identity planning.';
  const framing = item.framingIntent
    ? ` Keep the framing language aligned with ${item.framingIntent.replace(/_/g, ' ')}.`
    : '';

  return `${anchor}${outfit}${environment}${framing} Continue from this scene without resetting into a generic portrait.`;
}
