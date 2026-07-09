import type { RenderSuccessMode } from './api';

export const ULTRA_SAFE_SCENE_PROMPT =
  'A character walks slowly through a peaceful sunlit garden, natural movement, fully clothed, soft storybook cinematic style, gentle camera motion';

export type CreatorRenderStatus =
  | 'queued'
  | 'rendering'
  | 'processing'
  | 'verifying_output'
  | 'rate_limited'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'timeout'
  | 'completed'
  | 'saved'
  | 'reference_repair'
  | 'moderation_adapting';

export type CreatorRenderTone =
  | 'idle'
  | 'queued'
  | 'rendering'
  | 'cooling'
  | 'paused'
  | 'complete'
  | 'repair';

export type CreatorRenderCopy = {
  label: string;
  title: string;
  body: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  tertiaryActionLabel?: string;
  tone: CreatorRenderTone;
  suggestedNextStep?: string;
};

const rawProviderPatterns = [
  /prediction failed/gi,
  /async prediction failed/gi,
  /modelerror/gi,
  /model error/gi,
  /provider exception/gi,
  /provider failed/gi,
  /provider_error/gi,
  /replicate/gi,
  /seedance/gi,
  /\be005\b/gi,
  /flagged as sensitive/gi,
  /stack trace/gi,
  /traceback/gi,
  /cannot find module/gi,
  /module_not_found/gi,
  /\/var\/task/gi,
  /serverless\/lumora/gi,
  /sceneAnchorAssetStorage/gi,
  /prediction_id/gi,
  /provider_prediction/gi,
];

const riskyPromptReplacements: Array<[RegExp, string]> = [
  [/\bphotoshoot\b/gi, 'cinematic scene'],
  [/\bphoto shoot\b/gi, 'cinematic scene'],
  [/\bmodel posing\b/gi, 'natural movement'],
  [/\bmodel\b/gi, 'character'],
  [/\bglamour\b/gi, 'elegant cinematic tone'],
  [/\binfluencer\b/gi, 'creator'],
  [/\bsuperstar\b/gi, 'confident protagonist'],
  [/\bcelebrity\b/gi, ''],
  [/\bpublic figure\b/gi, ''],
  [/\bphotorealistic woman\b/gi, 'cinematic character'],
  [/\brealistic influencer\b/gi, 'stylized cinematic protagonist'],
  [/\bluxury influencer\b/gi, 'elegant cinematic figure'],
  [/\bhey\s+y'?all\b/gi, ''],
  [/\bhey\s+you\s+all\b/gi, ''],
  [/\brender\b/gi, ''],
];

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsRawProviderText(value: string) {
  return rawProviderPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function sanitizeCreatorErrorMessage(value: unknown, fallback = 'Lumora paused this scene safely.') {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  const lower = raw.toLowerCase();

  if (!raw.trim()) return fallback;
  if (
    lower.includes('database is not configured') ||
    lower.includes('database_url') ||
    lower.includes('database-backed routes')
  ) {
    return 'Story Memory sync is not connected in this local preview. You can still draft scenes.';
  }
  if (
    lower.includes('cannot find module') &&
    (lower.includes('sceneanchorassetstorage') || lower.includes('serverless/lumora'))
  ) {
    return 'Lumora could not save the scene anchor for Kling. Save this draft or try the identity-only fallback.';
  }
  if (
    lower.includes('kling image-to-video') &&
    (lower.includes('scene-anchor video payload') || lower.includes('payload shape'))
  ) {
    return 'Kling could not start from the scene anchor. Save this draft or try the identity-only fallback.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return 'Render queue is cooling down.';
  }
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('still processing')) {
    return 'Your cinematic moment is still processing.';
  }
  if (
    lower.includes('moderation') ||
    lower.includes('flagged as sensitive') ||
    lower.includes('provider safety filter') ||
    lower.includes('e005')
  ) {
    return 'This scene needs a softer cinematic direction before rendering.';
  }
  if (containsRawProviderText(raw) || raw.length > 220 || raw.includes('{') || raw.includes('}')) {
    return fallback;
  }

  return raw;
}

function limitWords(value: string, limit: number) {
  const words = collapseWhitespace(value).split(' ').filter(Boolean);
  return words.length <= limit ? words.join(' ') : `${words.slice(0, limit).join(' ')}.`;
}

function removeDisplayName(value: string, displayName?: string | null) {
  if (!displayName?.trim()) return value;
  const parts = displayName.trim().split(/\s+/).filter((part) => part.length > 1);
  return parts.reduce((next, part) => (
    next.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, 'gi'), 'the cast character')
  ), value.replace(new RegExp(`\\b${escapeRegExp(displayName.trim())}\\b`, 'gi'), 'the cast character'));
}

export function buildSafeTakePrompt(value: string, options: { displayName?: string | null } = {}) {
  const raw = collapseWhitespace(value)
    .replace(/^storybook cinematic version:\s*/i, '')
    .replace(/^cinematic direction:\s*/i, '')
    .replace(/^suggested next take:\s*/i, '');
  const lower = raw.toLowerCase();
  const gardenScene = lower.includes('flower') ||
    lower.includes('garden') ||
    lower.includes('bloom') ||
    lower.includes('daisies') ||
    lower.includes('daisy');

  if (!raw || gardenScene) {
    return 'the cast character walks through a sunlit garden, gently picking flowers, peaceful mood, natural movement, fully clothed, soft storybook cinematic light.';
  }

  let next = removeDisplayName(raw, options.displayName);
  riskyPromptReplacements.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  next = next
    .replace(/\bI\b/g, 'the cast character')
    .replace(/\bme\b/gi, 'the cast character')
    .replace(/\bmy\b/gi, 'the character\'s')
    .replace(/\bmain character\b/gi, 'the cast character')
    .replace(/\bcast character\b/gi, 'the cast character');

  const clean = collapseWhitespace(next)
    .replace(/^[:,.\s]+/, '')
    .replace(/[,.\s]+$/, '');
  const withSafety = `${clean || 'the cast character moves through a calm cinematic setting'}, peaceful mood, natural movement, fully clothed, soft storybook cinematic light.`;

  return limitWords(withSafety, 38);
}

export function buildSafeTakePreview(value: string, options: { displayName?: string | null } = {}) {
  return limitWords(`Storybook cinematic version: ${buildSafeTakePrompt(value, options)}`, 45);
}

export function successFirstOverrides(duration: number): {
  renderPreference: RenderSuccessMode;
  duration: number;
} {
  return {
    renderPreference: 'success_first',
    duration: duration === 4 ? duration : 4,
  };
}

export function creatorRenderStateCopy(status: CreatorRenderStatus, cooldownSeconds = 0): CreatorRenderCopy {
  switch (status) {
    case 'rate_limited':
      return {
        label: 'Cooling down',
        title: 'Render queue is cooling down.',
        body: cooldownSeconds > 3
          ? `Lumora will resume automatically in about ${cooldownSeconds} seconds.`
          : cooldownSeconds > 0
            ? 'The render queue is almost ready. Lumora will resume automatically.'
            : 'Lumora will resume automatically.',
        tertiaryActionLabel: 'Save draft',
        tone: 'cooling',
      };
    case 'queued':
      return {
        label: 'Queued',
        title: 'Your scene is queued.',
        body: 'Preparing your cast, saving scene references, and keeping this draft protected.',
        tone: 'queued',
      };
    case 'rendering':
    case 'processing':
      return {
        label: 'Rendering',
        title: 'Lumora is finding the cleanest render path.',
        body: 'Trying the simplest safe cinematic route first and saving successful drafts as they complete.',
        tone: 'rendering',
      };
    case 'verifying_output':
      return {
        label: 'Verifying',
        title: 'Lumora is checking the video output.',
        body: 'The draft is not marked ready until a playable video URL is saved.',
        tone: 'rendering',
      };
    case 'completed':
    case 'saved':
      return {
        label: 'Saved',
        title: 'Your cinematic draft is saved.',
        body: 'This moment is ready in Drafts.',
        tone: 'complete',
      };
    case 'reference_repair':
      return {
        label: 'Reference repair',
        title: 'One reference needs to be re-uploaded.',
        body: 'Upload the image directly so Lumora can save it safely.',
        primaryActionLabel: 'Replace reference',
        secondaryActionLabel: 'Open Your AI Cast',
        tertiaryActionLabel: 'Save draft',
        tone: 'repair',
      };
    case 'moderation_adapting':
      return {
        label: 'Adapting',
        title: 'Lumora is trying a safer cinematic direction.',
        body: 'Your cast and Story Memory stay preserved while Lumora softens the scene.',
        tone: 'rendering',
      };
    case 'timeout':
      return {
        label: 'Still checking',
        title: 'Your cinematic moment is still processing.',
        body: 'Lumora will keep checking and save the video to Drafts only after output is verified.',
        tertiaryActionLabel: 'Save draft',
        tone: 'paused',
      };
    case 'blocked':
    case 'failed':
    case 'paused':
    default:
      return {
        label: 'Paused',
        title: 'Lumora paused this scene safely.',
        body: 'This scene needs a simpler direction before rendering.',
        primaryActionLabel: 'Try ultra-safe scene',
        secondaryActionLabel: 'Edit scene',
        tertiaryActionLabel: 'Save draft',
        suggestedNextStep: 'Suggested next step: try the ultra-safe garden scene.',
        tone: 'paused',
      };
  }
}
