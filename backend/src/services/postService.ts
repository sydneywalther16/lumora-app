import { query } from './db';

export type PostRecord = {
  id: string;
  title: string;
  prompt: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  sourceGenerationId: string | null;
  sourceGenerationJobId: string | null;
  sourceProjectId: string | null;
  sourceType: string | null;
  isAiGenerated: boolean | null;
  mediaOrigin: string | null;
  createdAt: string;
};

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code === '23505'
  );
}

async function findPostBySourceGenerationId(sourceGenerationId: string) {
  const existing = await query<PostRecord>(
    `select
       id,
       title,
       prompt,
       image_url as "imageUrl",
       video_url as "videoUrl",
       source_generation_id as "sourceGenerationId",
       source_generation_job_id as "sourceGenerationJobId",
       source_project_id as "sourceProjectId",
       source_type as "sourceType",
       is_ai_generated as "isAiGenerated",
       media_origin as "mediaOrigin",
       created_at as "createdAt"
     from posts
     where source_generation_id = $1
     order by created_at desc
     limit 1`,
    [sourceGenerationId],
  );

  return existing.rows[0] ?? null;
}

export async function createPost(input: {
  title: string;
  prompt?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  sourceGenerationId?: string | null;
  sourceProjectId?: string | null;
}) {
  if (!input.videoUrl || !input.sourceGenerationId) {
    throw Object.assign(new Error('Public Lumora posts require a verified generated video and generation source.'), {
      statusCode: 400,
      code: 'AI_CAST_GENERATED_VIDEO_REQUIRED',
    });
  }

  if (input.sourceGenerationId) {
    const existing = await findPostBySourceGenerationId(input.sourceGenerationId);
    if (existing) {
      return existing;
    }
  }

  try {
    const result = await query<PostRecord>(
      `insert into posts (
         title,
         prompt,
         image_url,
         video_url,
         source_generation_id,
         source_generation_job_id,
         source_project_id,
         source_type,
         is_ai_generated,
         media_origin,
         status
       )
       values ($1, $2, null, $3, $4, $4, $5, 'lumora_generated', true, 'generated', 'published')
       returning
         id,
         title,
         prompt,
         image_url as "imageUrl",
         video_url as "videoUrl",
         source_generation_id as "sourceGenerationId",
         source_generation_job_id as "sourceGenerationJobId",
         source_project_id as "sourceProjectId",
         source_type as "sourceType",
         is_ai_generated as "isAiGenerated",
         media_origin as "mediaOrigin",
         created_at as "createdAt"`,
      [
        input.title,
        input.prompt ?? null,
        input.videoUrl,
        input.sourceGenerationId,
        input.sourceProjectId ?? input.sourceGenerationId,
      ],
    );

    return result.rows[0];
  } catch (error) {
    if (input.sourceGenerationId && isUniqueViolation(error)) {
      const existing = await findPostBySourceGenerationId(input.sourceGenerationId);
      if (existing) {
        return existing;
      }
    }

    throw error;
  }
}

export async function listPosts() {
  const result = await query<PostRecord>(
    `select
       id,
       title,
       prompt,
       image_url as "imageUrl",
       video_url as "videoUrl",
       source_generation_id as "sourceGenerationId",
       source_generation_job_id as "sourceGenerationJobId",
       source_project_id as "sourceProjectId",
       source_type as "sourceType",
       is_ai_generated as "isAiGenerated",
       media_origin as "mediaOrigin",
       created_at as "createdAt"
     from posts
     where status = 'published'
       and privacy = 'public'
       and coalesce(video_url, '') <> ''
       and (is_ai_generated = true or source_type = 'lumora_generated')
       and coalesce(media_origin, 'generated') = 'generated'
       and coalesce(source_generation_id::text, source_generation_job_id, source_project_id, '') <> ''
     order by created_at desc
     limit 100`,
  );

  return result.rows;
}
