import { randomUUID } from 'node:crypto';
import { openai } from '../lib/openaiClient';
import { env } from '../lib/env';
import { createGenerationJob, updateGenerationJobStatus } from './generationService';
import {
  createVideoGeneration,
  type CharacterVideoContext,
  type VideoAspectRatio,
  type VideoEngine,
  type VideoPrivacy,
} from '../video';

function scheduleDemoCompletion(jobId: string) {
  setTimeout(async () => {
    try {
      await completeGenerationJobDemo(jobId);
      console.log(`Demo generation completed: ${jobId}`);
    } catch (error) {
      console.error('Demo completion failed', error);
      await updateGenerationJobStatus({
        jobId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Demo completion failed',
      });
    }
  }, 3500);
}

export async function submitGenerationJob(input: {
  userId: string;
  projectId: string;
  title: string;
  prompt: string;
  stylePreset: string;
  outputType: 'image' | 'video';
  character?: CharacterVideoContext | null;
  characterId?: string | null;
  durationSeconds?: number;
  aspectRatio?: VideoAspectRatio;
  engine?: VideoEngine;
  privacy?: VideoPrivacy;
}) {
  if (input.outputType === 'video') {
    return submitVideoGenerationJob({
      userId: input.userId,
      projectId: input.projectId,
      prompt: input.prompt,
      character: input.character,
      characterId: input.characterId,
      durationSeconds: input.durationSeconds ?? 8,
      aspectRatio: input.aspectRatio ?? '9:16',
      engine: input.engine ?? 'veo',
      privacy: input.privacy ?? 'private',
    });
  }

  const provider = input.outputType === 'video' ? env.OPENAI_VIDEO_MODEL : env.OPENAI_IMAGE_MODEL;
  const providerJobId = randomUUID();
  const demoMode = !openai;

  const job = await createGenerationJob({
    userId: input.userId,
    projectId: input.projectId,
    provider: demoMode ? 'demo' : provider,
    providerJobId,
    outputType: input.outputType,
    prompt: input.prompt,
    status: demoMode ? 'queued-demo' : 'queued',
  });

  if (demoMode) {
    scheduleDemoCompletion(job.id);
  }

  return {
    jobId: job.id,
    status: job.status,
    provider: job.provider,
    providerJobId,
    message: demoMode
      ? 'Queued in demo mode. Auto-completion scheduled.'
      : 'Queued with provider adapter.',
  };
}

async function submitVideoGenerationJob(input: {
  userId: string;
  projectId: string;
  prompt: string;
  character?: CharacterVideoContext | null;
  characterId?: string | null;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  engine: VideoEngine;
  privacy: VideoPrivacy;
}) {
  const providerResult = await createVideoGeneration(input.engine, {
    userId: input.userId,
    prompt: input.prompt,
    character: input.character,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    privacy: input.privacy,
  });

  const job = await createGenerationJob({
    userId: input.userId,
    projectId: input.projectId,
    provider: providerResult.provider,
    providerJobId: providerResult.providerJobId,
    outputType: 'video',
    prompt: input.prompt,
    status: providerResult.status,
    characterId: input.characterId ?? null,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    privacy: input.privacy,
    resultAssetUrl: providerResult.status === 'completed' ? providerResult.resultAssetUrl : null,
  });

  if (providerResult.status === 'queued-demo') {
    scheduleDemoCompletion(job.id);
  }

  return {
    jobId: job.id,
    status: job.status,
    provider: job.provider,
    providerJobId: providerResult.providerJobId,
    message: providerResult.message,
  };
}

export async function completeGenerationJobDemo(jobId: string) {
  return updateGenerationJobStatus({
    jobId,
    status: 'completed',
    resultAssetUrl: `${env.APP_URL}/demo-placeholder.jpg`,
  });
}
