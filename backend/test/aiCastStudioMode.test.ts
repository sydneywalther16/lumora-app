import assert from 'node:assert/strict';
import {
  filterAiCastPublicPosts,
  isAiCastGeneratedVideoPost,
  withLumoraGeneratedPostFields,
} from '../../src/lib/aiCastMedia';
import type { LumoraPost } from '../../src/lib/api';
import {
  AI_CAST_REQUIRED_POST_COLUMNS,
  buildAiCastPostDiagnostics,
  buildAiCastPostDiagnosticsFromRows,
  missingAiCastSchemaFromError,
} from '../src/services/aiCastPostDiagnostics';
import { safeHealthDiagnostic } from '../src/routes/health';

const now = new Date('2026-05-23T12:00:00.000Z').toISOString();

function post(overrides: Partial<LumoraPost>): LumoraPost {
  return {
    id: overrides.id ?? 'post',
    title: 'Generated scene',
    createdAt: now,
    status: 'published',
    privacy: 'public',
    visibility: 'public',
    ...overrides,
  };
}

const generatedVideo = withLumoraGeneratedPostFields(post({
  id: 'generated-video',
  videoUrl: 'https://replicate.delivery/pbxt/lumora-ai-cast-video.mp4',
  sourceGenerationId: 'generation-job-1',
}));

assert.equal(isAiCastGeneratedVideoPost(generatedVideo), true);
assert.equal(filterAiCastPublicPosts([generatedVideo]).length, 1);

const rawReferenceImage = post({
  id: 'raw-reference-image',
  imageUrl: 'https://assets.example.com/self-reference.jpg',
  sourceType: 'lumora_generated',
  isAiGenerated: true,
  mediaOrigin: 'generated',
  sourceGenerationId: 'bad-source',
});

assert.equal(isAiCastGeneratedVideoPost(rawReferenceImage), false);
assert.equal(filterAiCastPublicPosts([rawReferenceImage]).length, 0);

const rawVerificationVideo = post({
  id: 'raw-verification-video',
  videoUrl: 'https://assets.example.com/private-verification.mp4',
  mediaOrigin: 'verification',
  isAiGenerated: false,
});

assert.equal(isAiCastGeneratedVideoPost(rawVerificationVideo), false);
assert.equal(filterAiCastPublicPosts([rawVerificationVideo]).length, 0);

const generatedMarkerWithoutSource = post({
  id: 'generated-marker-without-source',
  videoUrl: 'https://replicate.delivery/pbxt/no-source.mp4',
  sourceType: 'lumora_generated',
  isAiGenerated: true,
  mediaOrigin: 'generated',
});

assert.equal(isAiCastGeneratedVideoPost(generatedMarkerWithoutSource), false);
assert.equal(filterAiCastPublicPosts([generatedMarkerWithoutSource]).length, 0);

const privateGeneratedVideo = {
  ...generatedVideo,
  id: 'private-generated-video',
  privacy: 'private',
  visibility: 'private',
};

assert.deepEqual(filterAiCastPublicPosts([
  rawReferenceImage,
  rawVerificationVideo,
  privateGeneratedVideo,
  generatedVideo,
]).map((item) => item.id), ['generated-video']);

const diagnostics = buildAiCastPostDiagnosticsFromRows([
  {
    id: 'good-generated-video',
    status: 'published',
    privacy: 'public',
    videoUrl: 'https://replicate.delivery/pbxt/lumora-ai-cast-video.mp4',
    sourceGenerationId: 'job-1',
    sourceType: 'lumora_generated',
    isAiGenerated: true,
    mediaOrigin: 'generated',
  },
  {
    id: 'raw-photo',
    status: 'published',
    privacy: 'public',
    imageUrl: 'https://assets.example.com/reference.jpg',
    mediaUsage: 'character-reference-photo',
  },
  {
    id: 'verification-video',
    status: 'published',
    privacy: 'public',
    videoUrl: 'https://assets.example.com/verification.mp4',
    sourceGenerationId: 'job-2',
    sourceType: 'lumora_generated',
    isAiGenerated: true,
    mediaOrigin: 'generated',
    mediaUsage: 'self-verification-video',
  },
  {
    id: 'missing-source',
    status: 'published',
    privacy: 'public',
    videoUrl: 'https://replicate.delivery/pbxt/generated-without-source.mp4',
    sourceType: 'lumora_generated',
    isAiGenerated: true,
    mediaOrigin: 'generated',
  },
]);

assert.equal(diagnostics.publicPostsAllGenerated, false);
assert.equal(diagnostics.publicPublishedPostsChecked, 4);
assert.equal(diagnostics.rawUploadPostsCount, 1);
assert.equal(diagnostics.referenceMediaPublishedCount, 1);
assert.equal(diagnostics.verificationMediaPublishedCount, 1);
assert.equal(diagnostics.postsMissingGenerationSourceCount, 2);
assert.ok(diagnostics.violatingPostIdsRedacted.length >= 3);

const missingSchemaDiagnostics = await safeHealthDiagnostic('aiCastStudio', () =>
  buildAiCastPostDiagnostics({
    queryFn: async (sql: string, params?: unknown[]) => {
      if (sql.includes('information_schema.columns')) {
        const tableName = params?.[0];
        if (tableName === 'posts') {
          return {
            rows: [
              { columnName: 'id' },
              { columnName: 'status' },
              { columnName: 'video_url' },
              { columnName: 'source_generation_id' },
              { columnName: 'created_at' },
            ],
          };
        }
        return { rows: [] };
      }
      throw new Error('Main AI Cast post query should not run when required columns are missing.');
    },
  }),
);

assert.equal(missingSchemaDiagnostics.ok, false);
assert.equal(missingSchemaDiagnostics.key, 'aiCastStudio.schema');
assert.equal(missingSchemaDiagnostics.message, 'AI Cast posts migration needs to be applied');
assert.deepEqual(
  missingSchemaDiagnostics.missing,
  AI_CAST_REQUIRED_POST_COLUMNS.map((column) => `posts.${column}`).sort(),
);

const allFieldsDiagnostics = await buildAiCastPostDiagnostics({
  queryFn: async (sql: string, params?: unknown[]) => {
    if (sql.includes('information_schema.columns')) {
      const tableName = params?.[0];
      const requestedColumns = Array.isArray(params?.[1]) ? params?.[1] as string[] : [];
      if (tableName === 'posts') {
        return { rows: requestedColumns.map((columnName) => ({ columnName })) };
      }
      return { rows: [] };
    }
    return {
      rows: [
        {
          id: 'generated-row',
          status: 'published',
          privacy: 'public',
          videoUrl: 'https://replicate.delivery/pbxt/generated-row.mp4',
          sourceGenerationId: 'job-1',
          sourceGenerationJobId: 'job-1',
          sourceProjectId: 'project-1',
          sourceType: 'lumora_generated',
          isAiGenerated: true,
          mediaOrigin: 'generated',
        },
      ],
    };
  },
});

assert.equal(allFieldsDiagnostics.ok, true);
assert.equal(allFieldsDiagnostics.publicPostsAllGenerated, true);
assert.equal(allFieldsDiagnostics.publicPublishedPostsChecked, 1);

assert.deepEqual(
  missingAiCastSchemaFromError({ code: '42703', message: 'column p.source_type does not exist' }),
  ['posts.source_type'],
);

console.log('aiCastStudioMode unit tests passed');
