import { query } from './db';

export type PostRecord = {
  id: string;
  title: string;
  prompt: string | null;
  imageUrl: string | null;
  sourceGenerationId: string | null;
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
       source_generation_id as "sourceGenerationId",
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
  sourceGenerationId?: string | null;
}) {
  if (input.sourceGenerationId) {
    const existing = await findPostBySourceGenerationId(input.sourceGenerationId);
    if (existing) {
      return existing;
    }
  }

  try {
    const result = await query<PostRecord>(
      `insert into posts (title, prompt, image_url, source_generation_id)
       values ($1, $2, $3, $4)
       returning
         id,
         title,
         prompt,
         image_url as "imageUrl",
         source_generation_id as "sourceGenerationId",
         created_at as "createdAt"`,
      [input.title, input.prompt ?? null, input.imageUrl ?? null, input.sourceGenerationId ?? null],
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
       source_generation_id as "sourceGenerationId",
       created_at as "createdAt"
     from posts
     order by created_at desc
     limit 100`,
  );

  return result.rows;
}
