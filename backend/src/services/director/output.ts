export type DirectorMediaKind = 'scene_anchor' | 'primary_video' | 'repair_video';

export type DirectorMediaOutput = {
  interactionId: string;
  kind: DirectorMediaKind;
  mimeType: string;
  data: string | null;
  uri: string | null;
  status: string;
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

export function extractDirectorMediaOutput(
  interaction: unknown,
  kind: DirectorMediaKind,
): DirectorMediaOutput {
  const root = record(interaction);
  const preferred = kind === 'scene_anchor'
    ? record(root?.output_image)
    : record(root?.output_video);
  if (!root || !preferred) {
    throw new Error('Director interaction completed without the expected media output.');
  }

  return {
    interactionId: typeof root.id === 'string' ? root.id : '',
    kind,
    mimeType: typeof preferred.mime_type === 'string'
      ? preferred.mime_type
      : kind === 'scene_anchor'
        ? 'image/jpeg'
        : 'video/mp4',
    data: typeof preferred.data === 'string' ? preferred.data : null,
    uri: typeof preferred.uri === 'string' ? preferred.uri : null,
    status: typeof root.status === 'string' ? root.status : 'unknown',
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
  const match = uri.match(/\/files\/([^/:?]+)/i);
  if (!match?.[1]) throw new Error('Director media URI does not contain a file identifier.');
  return `files/${match[1]}`;
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
