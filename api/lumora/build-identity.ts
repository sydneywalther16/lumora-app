import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
};

type BuildIdentityBody = {
  identityId?: unknown;
  userId?: unknown;
  frontFaceUrl?: unknown;
  leftAngleUrl?: unknown;
  rightAngleUrl?: unknown;
  fullBodyUrl?: unknown;
  selfieVideoUrl?: unknown;
  selfieVideo2Url?: unknown;
  appearanceSummary?: unknown;
  userPreferences?: unknown;
  dislikedTraits?: unknown;
  likenessNotes?: unknown;
  identityFeedback?: unknown;
};

type ReplicateClient = {
  run: (model: `${string}/${string}` | `${string}/${string}:${string}`, options: { input: Record<string, unknown> }) => Promise<unknown>;
};

function safeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return undefined;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => safeJsonValue(item, seen) ?? null);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const safeEntry = safeJsonValue(entry, seen);
      return typeof safeEntry === 'undefined' ? [] : [[key, safeEntry]];
    }),
  );
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  const vercelRes = res as Partial<VercelResponse>;
  const safePayload = safeJsonValue(payload) ?? null;

  if (typeof vercelRes.status === 'function' && typeof vercelRes.json === 'function') {
    vercelRes.status(statusCode).json(safePayload);
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(safePayload));
}

async function readBody(req: VercelRequest): Promise<BuildIdentityBody> {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8')) as BuildIdentityBody;
  if (typeof req.body === 'string') return JSON.parse(req.body) as BuildIdentityBody;
  if (req.body && typeof req.body === 'object') return req.body as BuildIdentityBody;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BuildIdentityBody;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanHttpUrl(value: unknown): string | null {
  const url = textValue(value);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (/^(?:blob|data|file):/i.test(url) || url.includes('localhost') || url.includes('undefined')) return null;
  return url.split('?')[0];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function objectRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const url = cleanHttpUrl(value);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}

function identityIdFor(body: BuildIdentityBody) {
  const explicit = textValue(body.identityId);
  if (explicit) return explicit;
  const userId = textValue(body.userId) || 'local';
  return `lumora-identity-${userId}`;
}

function identityPrompt(appearanceSummary: string) {
  if (appearanceSummary) {
    return `Photorealistic identity character. ${appearanceSummary} Realistic proportions, natural skin texture, cinematic detail.`;
  }

  return 'Photorealistic identity character based on the provided multi-angle references. Preserve face shape, hairstyle, hair color, skin tone, eye area, body proportions, makeup style, and overall likeness. Realistic proportions, cinematic detail.';
}

function consistencyPrompt(referenceCount: number) {
  return [
    'Use the provided Lumora Identity Character as the persistent base person.',
    'Preserve the exact same person across all frames and future generations.',
    'Maintain facial structure, skin tone, hair, eye area, features, body proportions, makeup style, and overall likeness.',
    'Do not simply animate or copy the source photo; use references only to preserve identity in new scenes.',
    referenceCount > 1 ? `Use all ${referenceCount} canonical references together for consistency.` : '',
  ].filter(Boolean).join(' ');
}

function identityStrength(input: {
  frontFaceUrl: string | null;
  leftAngleUrl: string | null;
  rightAngleUrl: string | null;
  fullBodyUrl: string | null;
  videoCount: number;
  keyframeUrl: string | null;
  feedbackIterations: number;
}) {
  return Math.min(100,
    (input.frontFaceUrl ? 30 : 0) +
    (input.leftAngleUrl ? 15 : 0) +
    (input.rightAngleUrl ? 15 : 0) +
    (input.fullBodyUrl ? 10 : 0) +
    Math.min(input.videoCount * 10, 20) +
    (input.keyframeUrl ? 10 : 0) +
    Math.min(input.feedbackIterations * 2, 10),
  );
}

function buildProfile(body: BuildIdentityBody, keyframeUrl: string | null, warnings: string[]) {
  const frontFaceUrl = cleanHttpUrl(body.frontFaceUrl);
  const leftAngleUrl = cleanHttpUrl(body.leftAngleUrl);
  const rightAngleUrl = cleanHttpUrl(body.rightAngleUrl);
  const fullBodyUrl = cleanHttpUrl(body.fullBodyUrl);
  const selfieVideoUrl = cleanHttpUrl(body.selfieVideoUrl);
  const selfieVideo2Url = cleanHttpUrl(body.selfieVideo2Url);
  const videoReferenceUrls = uniqueUrls([selfieVideoUrl, selfieVideo2Url]);
  const canonicalReferenceSet = uniqueUrls([
    keyframeUrl,
    frontFaceUrl,
    leftAngleUrl,
    rightAngleUrl,
    fullBodyUrl,
    ...videoReferenceUrls,
  ]);
  const appearanceSummary = textValue(body.appearanceSummary);
  const identityPromptValue = identityPrompt(appearanceSummary);
  const consistencyPromptValue = consistencyPrompt(canonicalReferenceSet.length);
  const feedback = Array.isArray(body.identityFeedback) ? body.identityFeedback : [];
  const feedbackIterations = feedback.length + stringArray(body.likenessNotes).length;

  return {
    identityId: identityIdFor(body),
    userId: textValue(body.userId) || 'local',
    createdAt: new Date().toISOString(),
    frontFaceUrl,
    leftAngleUrl,
    rightAngleUrl,
    fullBodyUrl,
    videoReferenceUrls,
    references: {
      frontFaceUrl,
      leftAngleUrl,
      rightAngleUrl,
      fullBodyUrl,
      selfieVideoUrl,
      selfieVideo2Url,
    },
    detectedFeatures: {
      hairColor: appearanceSummary.toLowerCase().includes('hair') ? 'described in appearance summary' : 'unspecified',
      eyeColor: appearanceSummary.toLowerCase().includes('eye') ? 'described in appearance summary' : 'unspecified',
      skinTone: appearanceSummary.toLowerCase().includes('skin') ? 'described in appearance summary' : 'unspecified',
      faceShape: appearanceSummary.toLowerCase().includes('face') ? 'described in appearance summary' : 'unspecified',
      bodyFrame: appearanceSummary.toLowerCase().includes('body') || appearanceSummary.toLowerCase().includes('build') ? 'described in appearance summary' : 'unspecified',
      estimatedAgeRange: 'unspecified',
      genderPresentation: 'unspecified',
      styleTags: [
        'photorealistic',
        canonicalReferenceSet.length >= 3 ? 'multi-angle' : 'limited-reference',
        videoReferenceUrls.length ? 'video-reference' : 'photo-reference',
      ],
    },
    canonicalReferenceSet,
    primaryIdentityImageUrl: keyframeUrl || frontFaceUrl || fullBodyUrl || canonicalReferenceSet[0] || null,
    identityPrompt: identityPromptValue,
    generationConsistencyPrompt: consistencyPromptValue,
    keyframeUrl,
    appearanceSummary: appearanceSummary || identityPromptValue,
    userPreferences: objectRecord(body.userPreferences),
    dislikedTraits: stringArray(body.dislikedTraits),
    likenessNotes: stringArray(body.likenessNotes),
    identityFeedback: feedback,
    preferredTraits: [],
    identityStrength: identityStrength({
      frontFaceUrl,
      leftAngleUrl,
      rightAngleUrl,
      fullBodyUrl,
      videoCount: videoReferenceUrls.length,
      keyframeUrl,
      feedbackIterations,
    }),
    successfulGenerations: 0,
    feedbackIterations,
    version: 1,
    status: frontFaceUrl || keyframeUrl ? 'ready' : 'needs_refs',
    warnings,
  };
}

function buildKeyframePrompt(body: BuildIdentityBody) {
  const appearanceSummary = textValue(body.appearanceSummary);
  return [
    'Create a canonical master identity render for Lumora Identity Character.',
    'Use all provided references only to preserve identity. Do not copy a single uploaded image.',
    'Make a fresh photorealistic neutral keyframe of the same person for future video generations.',
    identityPrompt(appearanceSummary),
    consistencyPrompt(4),
  ].join('\n\n');
}

function maybeUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (value instanceof URL) return value.toString();
  return null;
}

async function outputUrl(output: unknown): Promise<string | null> {
  const direct = maybeUrl(output);
  if (direct) return direct;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = await outputUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  for (const key of ['data', 'image', 'images', 'output', 'url', 'keyframeUrl']) {
    const url = await outputUrl(record[key]);
    if (url) return url;
  }
  return null;
}

async function generateKeyframe(body: BuildIdentityBody) {
  const frontFaceUrl = cleanHttpUrl(body.frontFaceUrl);
  const leftAngleUrl = cleanHttpUrl(body.leftAngleUrl);
  const rightAngleUrl = cleanHttpUrl(body.rightAngleUrl);
  const fullBodyUrl = cleanHttpUrl(body.fullBodyUrl);
  const prompt = buildKeyframePrompt(body);

  if (!frontFaceUrl) {
    return {
      keyframeUrl: null,
      provider: 'none',
      model: null,
      rawOutput: null,
      warnings: ['No frontFaceUrl was available, so Lumora could not build a generated master keyframe.'],
      finalPrompt: prompt,
    };
  }

  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_IDENTITY_KEYFRAME_MODEL || process.env.REPLICATE_IMAGE_MODEL;
  if (!token || !model) {
    return {
      keyframeUrl: frontFaceUrl,
      provider: 'fallback',
      model: null,
      rawOutput: null,
      warnings: ['Identity keyframe provider not configured yet. Using the primary reference as the temporary canonical keyframe.'],
      finalPrompt: prompt,
    };
  }

  const { default: Replicate } = await import('replicate');
  const replicate = new Replicate({ auth: token }) as ReplicateClient;
  const output = await replicate.run(model as `${string}/${string}`, {
    input: {
      prompt,
      image: frontFaceUrl,
      reference_images: [leftAngleUrl, rightAngleUrl, fullBodyUrl].filter(Boolean),
    },
  });
  const keyframeUrl = await outputUrl(output);

  if (!keyframeUrl) {
    throw Object.assign(new Error('Identity keyframe model did not return a URL.'), {
      provider: 'replicate',
      model,
      details: output,
    });
  }

  return {
    keyframeUrl,
    provider: 'replicate',
    model,
    rawOutput: output,
    warnings: [],
    finalPrompt: prompt,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('LUMORA BUILD IDENTITY START');

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = await readBody(req);
    const keyframe = await generateKeyframe(body);
    const identityProfile = buildProfile(body, keyframe.keyframeUrl, keyframe.warnings);

    console.log('LUMORA BUILD IDENTITY RESULT', {
      identityId: identityProfile.identityId,
      keyframeUrl: identityProfile.keyframeUrl,
      identityStrength: identityProfile.identityStrength,
      provider: keyframe.provider,
      model: keyframe.model,
    });

    return sendJson(res, 200, {
      success: true,
      identityProfile,
      identityId: identityProfile.identityId,
      identityPrompt: identityProfile.identityPrompt,
      consistencyPrompt: identityProfile.generationConsistencyPrompt,
      keyframeUrl: identityProfile.keyframeUrl,
      provider: keyframe.provider,
      model: keyframe.model,
      finalPrompt: keyframe.finalPrompt,
      warnings: keyframe.warnings,
      rawOutput: keyframe.rawOutput,
    });
  } catch (error) {
    console.error('LUMORA BUILD IDENTITY ERROR:', error);
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Identity build failed.',
      details: safeJsonValue(record.details ?? error),
      provider: typeof record.provider === 'string' ? record.provider : null,
      model: typeof record.model === 'string' ? record.model : null,
    });
  }
}
