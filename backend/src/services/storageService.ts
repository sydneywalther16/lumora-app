import { supabaseAdmin } from '../lib/supabaseAdmin';

const bucket = 'lumora-assets';

export async function uploadGeneratedAsset(input: {
  userId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  folder?: string;
}) {
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const folder = input.folder ? `${input.folder.replace(/[^a-zA-Z0-9/_-]/g, '-')}/` : '';
  const objectPath = `${input.userId}/${folder}${Date.now()}-${safeFileName}`;
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, input.buffer, {
      contentType: input.contentType,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);
  return { objectPath, publicUrl: data.publicUrl };
}

export type MediaUploadInput = {
  url?: string;
  dataUrl?: string;
  fileName?: string;
  contentType?: string;
};

function extensionForContentType(contentType: string) {
  const [type, subtype] = contentType.split('/');
  if (!type || !subtype) return 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype.includes('svg')) return 'svg';
  if (subtype.includes('webm')) return 'webm';
  if (subtype.includes('mp4')) return 'mp4';
  if (subtype.includes('mpeg')) return 'mp3';
  return subtype.replace(/[^a-z0-9]/gi, '') || 'bin';
}

function parseDataUrl(dataUrl: string, fallbackContentType?: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) {
    throw new Error('Expected media upload to be a base64 data URL.');
  }

  const contentType = match[1] ?? fallbackContentType ?? 'application/octet-stream';
  return {
    contentType,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export async function persistMediaUpload(input: {
  userId: string;
  media: MediaUploadInput;
  folder: string;
  fallbackFileName: string;
}) {
  if (input.media.url) {
    return input.media.url;
  }

  if (!input.media.dataUrl) {
    throw new Error('A media URL or upload data URL is required.');
  }

  const parsed = parseDataUrl(input.media.dataUrl, input.media.contentType);
  const fileName =
    input.media.fileName ??
    `${input.fallbackFileName}.${extensionForContentType(parsed.contentType)}`;

  const asset = await uploadGeneratedAsset({
    userId: input.userId,
    fileName,
    contentType: parsed.contentType,
    buffer: parsed.buffer,
    folder: input.folder,
  });

  return asset.publicUrl;
}
