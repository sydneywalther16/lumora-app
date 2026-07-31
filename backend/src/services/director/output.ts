export type DirectorMediaKind = 'scene_anchor' | 'primary_video' | 'repair_video';

export type DirectorMediaOutputSource =
  | 'output_image'
  | 'outputImage'
  | 'outputs'
  | 'model_output_step'
  | 'output_video'
  | 'outputVideo';

export type DirectorMediaOutputSafeSummary = {
  outputCount: number;
  outputTypes: string[];
  selectedSource: DirectorMediaOutputSource | null;
  selectedMimeType: string | null;
  selectedHasData: boolean;
  selectedHasUri: boolean;
};

export type DirectorAnchorOutputFailureCategory =
  | 'anchor_text_only'
  | 'anchor_moderated'
  | 'anchor_output_unrecognized'
  | 'anchor_media_missing';

export class DirectorMediaOutputError extends Error {
  readonly category: DirectorAnchorOutputFailureCategory;
  readonly safeSummary: DirectorMediaOutputSafeSummary;

  constructor(
    category: DirectorAnchorOutputFailureCategory,
    safeSummary: DirectorMediaOutputSafeSummary,
  ) {
    super('Director scene anchor output did not include a usable final image.');
    this.name = 'DirectorMediaOutputError';
    this.category = category;
    this.safeSummary = safeSummary;
  }
}

export type DirectorMediaOutput = {
  interactionId: string;
  kind: DirectorMediaKind;
  mimeType: string;
  data: string | null;
  uri: string | null;
  status: string;
  safeSummary: DirectorMediaOutputSafeSummary;
};

export type DirectorOutputPersistence = {
  save(input: {
    interactionId: string;
    kind: DirectorMediaKind;
    mimeType: string;
    bytes: Uint8Array;
    syntheticDisclosure: 'Synthetic portrayal';
  }): Promise<{
    controlledUrl: string;
    byteSize: number;
  }>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeType(value: unknown): string {
  const type = stringValue(record(value)?.type);
  return type ? type.slice(0, 48) : 'unknown';
}

function safeSummary(
  items: unknown[],
  input: Partial<Omit<DirectorMediaOutputSafeSummary, 'outputCount' | 'outputTypes'>> = {},
): DirectorMediaOutputSafeSummary {
  return {
    outputCount: items.length,
    outputTypes: items.map(safeType),
    selectedSource: input.selectedSource ?? null,
    selectedMimeType: input.selectedMimeType ?? null,
    selectedHasData: input.selectedHasData ?? false,
    selectedHasUri: input.selectedHasUri ?? false,
  };
}

function base64Value(value: unknown): string | null {
  const text = stringValue(value)?.replace(/\s+/g, '') ?? null;
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Buffer.from(text, 'base64').byteLength > 0 ? text : null;
  } catch {
    return null;
  }
}

function providerFileName(uri: string): string | null {
  const trimmed = uri.trim();
  const direct = trimmed.match(/^files\/([^/:?]+)$/i);
  if (direct?.[1]) return `files/${direct[1]}`;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('googleapis.com')) return null;
    const match = parsed.pathname.match(/\/files\/([^/:?]+)/i);
    return match?.[1] ? `files/${match[1]}` : null;
  } catch {
    return null;
  }
}

function validProviderUri(value: unknown): string | null {
  const uri = stringValue(value);
  return uri && providerFileName(uri) ? uri : null;
}

function explicitlyThought(value: unknown) {
  const candidate = record(value);
  return candidate?.thought === true || candidate?.is_thought === true || candidate?.isThought === true;
}

type ImageCandidate = {
  source: DirectorMediaOutputSource;
  mimeType: string;
  data: string | null;
  uri: string | null;
};

function validImageCandidate(
  value: unknown,
  source: DirectorMediaOutputSource,
  requireImageType: boolean,
): ImageCandidate | null {
  const candidate = record(value);
  if (!candidate || explicitlyThought(candidate)) return null;
  if (requireImageType && candidate.type !== 'image') return null;
  if (!requireImageType && candidate.type != null && candidate.type !== 'image') return null;
  const mimeType = stringValue(candidate.mime_type) ?? stringValue(candidate.mimeType);
  if (!mimeType?.toLowerCase().startsWith('image/')) return null;
  const data = base64Value(candidate.data);
  const uri = validProviderUri(candidate.uri);
  if (!data && !uri) return null;
  return { source, mimeType, data, uri };
}

type CandidateGroup = {
  source: DirectorMediaOutputSource;
  items: unknown[];
  requireImageType: boolean;
};

function modelOutputItems(root: Record<string, unknown>) {
  if (!Array.isArray(root.steps)) return [];
  return root.steps.flatMap((step) => {
    const value = record(step);
    return value?.type === 'model_output' && Array.isArray(value.content)
      ? value.content
      : [];
  });
}

function safeModerationText(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => safeModerationText(item, depth + 1));
  }
  const valueRecord = record(value);
  if (!valueRecord) return [];
  return Object.entries(valueRecord).flatMap(([key, nested]) => {
    if (/^(?:data|uri|input|system_instruction)$/i.test(key)) return [];
    if (typeof nested === 'string') {
      return /(?:error|message|reason|status|block|safety|moderation|text|type)/i.test(key)
        ? [nested.slice(0, 240)]
        : [];
    }
    return safeModerationText(nested, depth + 1);
  });
}

function hasModerationSignal(root: Record<string, unknown>) {
  return safeModerationText(root).some((value) =>
    /\b(?:safety|moderation|blocked|policy|prohibited|responsible ai)\b/i.test(value));
}

function hasTextOutput(root: Record<string, unknown>, outputItems: unknown[], stepItems: unknown[]) {
  if (stringValue(root.output_text) || stringValue(root.outputText)) return true;
  return [...outputItems, ...stepItems].some((item) => {
    const value = record(item);
    return value?.type === 'text' && Boolean(stringValue(value.text));
  });
}

function hasUnrecognizedImageShape(root: Record<string, unknown>) {
  const known = new Set(['output_image', 'outputImage', 'outputs', 'steps']);
  return Object.entries(root).some(([key, value]) =>
    !known.has(key) && /image/i.test(key) && Boolean(record(value)));
}

function extractSceneAnchorOutput(root: Record<string, unknown>): {
  candidate: ImageCandidate;
  summary: DirectorMediaOutputSafeSummary;
} {
  const outputItems = Array.isArray(root.outputs) ? root.outputs : [];
  const stepItems = modelOutputItems(root);
  const groups: CandidateGroup[] = [
    { source: 'output_image', items: root.output_image == null ? [] : [root.output_image], requireImageType: false },
    { source: 'outputImage', items: root.outputImage == null ? [] : [root.outputImage], requireImageType: false },
    { source: 'outputs', items: outputItems, requireImageType: true },
    { source: 'model_output_step', items: stepItems, requireImageType: true },
  ];

  let mostRelevantItems: unknown[] = [];
  for (const group of groups) {
    if (!group.items.length) continue;
    mostRelevantItems = group.items;
    const candidates = group.items
      .map((item) => validImageCandidate(item, group.source, group.requireImageType))
      .filter((candidate): candidate is ImageCandidate => Boolean(candidate));
    const candidate = candidates.at(-1);
    if (candidate) {
      return {
        candidate,
        summary: safeSummary(group.items, {
          selectedSource: candidate.source,
          selectedMimeType: candidate.mimeType,
          selectedHasData: Boolean(candidate.data),
          selectedHasUri: Boolean(candidate.uri),
        }),
      };
    }
  }

  const recognizedImageCount = groups.reduce((count, group) =>
    count + group.items.filter((item) => record(item)?.type === 'image' || !group.requireImageType).length, 0);
  const summary = safeSummary(mostRelevantItems);
  const category: DirectorAnchorOutputFailureCategory = hasModerationSignal(root)
    ? 'anchor_moderated'
    : hasTextOutput(root, outputItems, stepItems) && recognizedImageCount === 0
      ? 'anchor_text_only'
      : hasUnrecognizedImageShape(root) || (root.outputs != null && !Array.isArray(root.outputs))
        ? 'anchor_output_unrecognized'
        : 'anchor_media_missing';
  throw new DirectorMediaOutputError(category, summary);
}

export function extractDirectorMediaOutput(
  interaction: unknown,
  kind: DirectorMediaKind,
): DirectorMediaOutput {
  const root = record(interaction);
  if (!root) {
    throw new Error('Director interaction completed without the expected media output.');
  }

  if (kind === 'scene_anchor') {
    const { candidate, summary } = extractSceneAnchorOutput(root);
    return {
      interactionId: stringValue(root.id) ?? '',
      kind,
      mimeType: candidate.mimeType,
      data: candidate.data,
      uri: candidate.uri,
      status: stringValue(root.status) ?? 'unknown',
      safeSummary: summary,
    };
  }

  const source: DirectorMediaOutputSource = record(root.output_video)
    ? 'output_video'
    : 'outputVideo';
  const preferred = record(root.output_video) ?? record(root.outputVideo);
  if (!preferred) {
    throw new Error('Director interaction completed without the expected media output.');
  }

  const data = stringValue(preferred.data);
  const uri = stringValue(preferred.uri);
  const mimeType = stringValue(preferred.mime_type) ?? stringValue(preferred.mimeType) ?? 'video/mp4';

  return {
    interactionId: stringValue(root.id) ?? '',
    kind,
    mimeType,
    data,
    uri,
    status: stringValue(root.status) ?? 'unknown',
    safeSummary: safeSummary([preferred], {
      selectedSource: source,
      selectedMimeType: mimeType,
      selectedHasData: Boolean(data),
      selectedHasUri: Boolean(uri),
    }),
  };
}

export async function persistDirectorOutputBytes(
  output: DirectorMediaOutput,
  bytes: Uint8Array,
  persistence: DirectorOutputPersistence,
) {
  if (!output.interactionId || !bytes.byteLength) {
    throw new Error('Completed Director media bytes are required for persistence.');
  }
  return persistence.save({
    interactionId: output.interactionId,
    kind: output.kind,
    mimeType: output.mimeType,
    bytes,
    syntheticDisclosure: 'Synthetic portrayal',
  });
}

export function inlineDirectorOutputBytes(output: DirectorMediaOutput): Uint8Array {
  if (!output.data) throw new Error('Director media is not available inline.');
  return Buffer.from(output.data, 'base64');
}

export function directorFileNameFromUri(uri: string) {
  const fileName = providerFileName(uri);
  if (!fileName) throw new Error('Director media URI does not contain a valid provider file identifier.');
  return fileName;
}

export async function pollDirectorMediaFile(input: {
  fileName: string;
  getFile: (name: string) => Promise<{ state?: string | { name?: string } }>;
  maximumPolls?: number;
  intervalMs?: number;
}) {
  const maximumPolls = Math.max(1, Math.min(input.maximumPolls ?? 60, 120));
  const intervalMs = Math.max(250, Math.min(input.intervalMs ?? 5_000, 30_000));
  for (let poll = 1; poll <= maximumPolls; poll += 1) {
    const file = await input.getFile(input.fileName);
    const state = typeof file.state === 'string' ? file.state : file.state?.name ?? 'UNKNOWN';
    if (state === 'ACTIVE') return { state, polls: poll };
    if (state === 'FAILED') throw new Error('Director media processing failed.');
    if (poll < maximumPolls) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error('Director media processing timed out.');
}
