import { supabaseAdmin } from '../lib/supabaseAdmin';

const GENERATED_VIDEO_BUCKET = 'generated-videos';

export type CompletedGenerationPersistenceInput = {
  userId?: string | null;
  id: string;
  title?: string | null;
  prompt: string;
  finalPrompt?: string | null;
  provider: string;
  engine: string;
  model?: string | null;
  displayEngine?: string | null;
  videoUrl: string;
  thumbnailUrl?: string | null;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean | null;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  privacy?: string | null;
};

export type CompletedGenerationPersistenceResult = {
  videoUrl: string;
  projectId: string | null;
  storagePath: string | null;
  warnings: string[];
};

function fileExtension(contentType: string | null) {
  if (!contentType) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('quicktime')) return 'mov';
  if (contentType.includes('mp4')) return 'mp4';
  return 'mp4';
}

async function copyVideoToSupabase(input: {
  userId: string;
  id: string;
  videoUrl: string;
}): Promise<{ publicUrl: string; storagePath: string }> {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client is not configured.');
  }

  const response = await fetch(input.videoUrl);
  if (!response.ok) {
    throw new Error(`Unable to download generated video (${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || 'video/mp4';
  const buffer = Buffer.from(await response.arrayBuffer());
  const storagePath = `${input.userId}/generations/${input.id}.${fileExtension(contentType)}`;
  const { error } = await supabaseAdmin.storage
    .from(GENERATED_VIDEO_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(GENERATED_VIDEO_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, storagePath };
}

async function insertCompletedProject(input: CompletedGenerationPersistenceInput & { videoUrl: string }) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client is not configured.');
  }

  const { data, error } = await supabaseAdmin
    .from('projects')
    .insert({
      user_id: input.userId,
      title: input.title || 'Lumora generation',
      prompt: input.prompt,
      final_prompt: input.finalPrompt ?? input.prompt,
      style_preset: input.engine,
      status: 'completed',
      provider: input.provider,
      engine: input.engine,
      output_type: 'video',
      video_url: input.videoUrl,
      cover_asset_url: input.videoUrl,
      thumbnail_url: input.thumbnailUrl ?? input.videoUrl,
      character_id: input.characterId ?? null,
      character_name: input.characterName ?? null,
      character_avatar: input.characterAvatar ?? null,
      is_default_self_character: Boolean(input.isDefaultSelfCharacter),
      privacy: input.privacy ?? 'private',
      duration_seconds: input.durationSeconds ?? null,
      aspect_ratio: input.aspectRatio ?? null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return typeof data?.id === 'string' ? data.id : null;
}

export async function persistCompletedGeneration(
  input: CompletedGenerationPersistenceInput,
): Promise<CompletedGenerationPersistenceResult> {
  const warnings: string[] = [];

  if (!input.userId) {
    return {
      videoUrl: input.videoUrl,
      projectId: null,
      storagePath: null,
      warnings: ['No authenticated user id was provided, so backend Supabase persistence was skipped.'],
    };
  }

  if (!supabaseAdmin) {
    return {
      videoUrl: input.videoUrl,
      projectId: null,
      storagePath: null,
      warnings: ['Supabase admin is not configured, so backend persistence was skipped.'],
    };
  }

  let videoUrl = input.videoUrl;
  let storagePath: string | null = null;

  if (/^https?:\/\//i.test(input.videoUrl)) {
    try {
      const storedVideo = await copyVideoToSupabase({
        userId: input.userId,
        id: input.id,
        videoUrl: input.videoUrl,
      });
      videoUrl = storedVideo.publicUrl;
      storagePath = storedVideo.storagePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown storage error';
      warnings.push(`Supabase video storage failed: ${message}`);
      console.warn('SUPABASE GENERATED VIDEO STORAGE FAILED:', {
        generationId: input.id,
        provider: input.provider,
        engine: input.engine,
        error,
      });
    }
  }

  let projectId: string | null = null;
  try {
    projectId = await insertCompletedProject({ ...input, videoUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    warnings.push(`Supabase project save failed: ${message}`);
    console.warn('SUPABASE COMPLETED PROJECT SAVE FAILED:', {
      generationId: input.id,
      provider: input.provider,
      engine: input.engine,
      error,
    });
  }

  return {
    videoUrl,
    projectId,
    storagePath,
    warnings,
  };
}
