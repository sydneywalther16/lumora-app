import { supabaseAdmin } from '../lib/supabaseAdmin';

const bucket = 'lumora-assets';

export async function uploadGeneratedAsset(input: {
  userId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  const objectPath = `${input.userId}/${Date.now()}-${input.fileName}`;
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
