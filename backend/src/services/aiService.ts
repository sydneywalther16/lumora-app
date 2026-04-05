import { randomUUID } from 'node:crypto';
import { openai } from '../lib/openaiClient';
import { env } from '../lib/env';
import { createGenerationJob, updateGenerationJobStatus } from './generationService';

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
}) {
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

export async function completeGenerationJobDemo(jobId: string) {
  return updateGenerationJobStatus({
    jobId,
    status: 'completed',
    resultAssetUrl: `${env.APP_URL}/demo-assets/${jobId}.jpg`,
  });
}
