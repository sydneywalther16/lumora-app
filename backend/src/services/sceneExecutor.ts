import { randomUUID } from 'node:crypto';
import {
  creativeBrainScenePlanSchema,
  type CreativeBrainScenePlan,
  type CreativeBrainShot,
} from './creativeBrain';
import {
  buildCharacterProfilePrompt,
  characterProfileFromMetadata,
  getCinematicCharacterProfileForUser,
  inheritCharacterContinuity,
  updateCharacterProfileFromMemory,
  type CharacterProfile,
} from './characterProfiles';
import {
  createGenerationJob,
  updateGenerationJobSceneMetadata,
  updateGenerationJobStatus,
} from './generationService';
import {
  buildContinuityMemoryPrompt,
  getContinuityMemory,
  updateContinuityMemoryAfterCompletedScene,
  type ContinuityDriftAlert,
  type ContinuityMemoryRecord,
  type ContinuityMemoryState,
  type SceneMemorySummary,
} from './memoryEngine';
import {
  generateSeedanceVideo,
  isSeedanceModerationError,
  type SeedanceModerationDiagnostics,
  type SeedanceQualityMode,
  type SeedanceReferenceImage,
} from './providers/seedanceProvider';

export type SceneExecutorClipStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type SceneClipMetadata = {
  previousScene: string | null;
  emotionalState: string;
  wardrobe: string;
  environmentContinuity: string;
  continuityNotes: string[];
  cameraFraming: string;
  cameraMovement: string;
  sceneTransition: string;
  shotDescription: string;
  subjectAction: string;
  durationHint: string;
  referenceImageCount: number;
  continuityMemoryScope?: string | null;
  continuityConfidence?: number | null;
  continuityDrift?: ContinuityDriftAlert[];
  memorySnapshot?: ContinuityMemoryState | null;
  sceneMemorySummary?: SceneMemorySummary | null;
  moderationOrchestration?: SeedanceModerationDiagnostics | null;
};

export type SceneExecutorClip = {
  id: string;
  jobId: string | null;
  sceneExecutionId: string;
  sceneId: string;
  clipOrder: number;
  status: SceneExecutorClipStatus;
  title: string;
  prompt: string;
  finalPrompt?: string | null;
  videoUrl?: string | null;
  provider?: string | null;
  model?: string | null;
  providerJobId?: string | null;
  error?: string | null;
  metadata: SceneClipMetadata;
  moderationDiagnostics?: SeedanceModerationDiagnostics | null;
  createdAt: string;
};

export type SceneExecutorResult = {
  id: string;
  status: 'completed' | 'failed';
  provider: 'seedance';
  engine: 'seedance-2.0' | 'seedance-quality';
  clips: SceneExecutorClip[];
  failedClip?: SceneExecutorClip | null;
  scenePlan: CreativeBrainScenePlan;
  continuityMemory: ContinuityMemoryRecord | null;
  createdAt: string;
  completedAt: string;
};

export type ExecuteScenePlanInput = {
  scenePlan: CreativeBrainScenePlan;
  userId: string;
  projectId?: string | null;
  characterId?: string | null;
  characterMetadata?: Record<string, unknown> | null;
  referenceImages?: SeedanceReferenceImage[];
  quality?: SeedanceQualityMode;
  privacy?: string;
};

type ClipWorkItem = {
  shot: CreativeBrainShot;
  prompt: string;
  metadata: SceneClipMetadata;
  clip: SceneExecutorClip;
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function wardrobeFromMetadata(metadata?: Record<string, unknown> | null) {
  return (
    stringValue(metadata?.wardrobe) ||
    stringValue(metadata?.videoWardrobe) ||
    stringValue(metadata?.styleTheme) ||
    stringValue(metadata?.characterDescription) ||
    'Preserve the same wardrobe silhouette, color palette, hair, makeup, and styling across every clip.'
  );
}

function sceneContinuitySummary(input: {
  shot: CreativeBrainShot;
  metadata: SceneClipMetadata;
}) {
  return `${input.shot.title}: ${input.shot.description} Emotional state: ${input.metadata.emotionalState}. Wardrobe: ${input.metadata.wardrobe}.`;
}

function shotPrompt(input: {
  scenePlan: CreativeBrainScenePlan;
  shot: CreativeBrainShot;
  clipOrder: number;
  clipCount: number;
  previousScene: string | null;
  metadata: SceneClipMetadata;
  continuityMemory: ContinuityMemoryRecord;
  characterProfile: CharacterProfile | null;
}) {
  return [
    input.scenePlan.promptRewrite,
    buildCharacterProfilePrompt(input.characterProfile),
    buildContinuityMemoryPrompt(input.continuityMemory),
    `Shot ${input.clipOrder} of ${input.clipCount}: ${input.shot.title}.`,
    input.shot.description,
    `Camera framing: ${input.shot.cameraFraming}. Camera movement: ${input.shot.cameraMovement}.`,
    `Subject action: ${input.shot.subjectAction}.`,
    `Environment continuity: ${input.metadata.environmentContinuity}.`,
    `Emotional pacing: ${input.scenePlan.emotionalPacing}. Current emotional state: ${input.metadata.emotionalState}.`,
    `Wardrobe continuity: ${input.metadata.wardrobe}.`,
    `Continuity notes: ${input.scenePlan.continuityNotes.join(' ')}`,
    input.previousScene ? `Previous scene continuity: ${input.previousScene}.` : 'Opening shot. Establish the scene clearly.',
    `Transition intent: ${input.shot.transition}.`,
    'Preserve identity, wardrobe, and environment continuity across clips.',
    'Generate only this shot as a standalone cinematic clip. Do not stitch clips.',
  ].join(' ');
}

function clipMetadata(input: {
  scenePlan: CreativeBrainScenePlan;
  shot: CreativeBrainShot;
  previousScene: string | null;
  referenceImageCount: number;
  characterMetadata?: Record<string, unknown> | null;
  continuityMemory: ContinuityMemoryRecord;
  characterProfile: CharacterProfile | null;
}): SceneClipMetadata {
  return {
    previousScene: input.previousScene,
    emotionalState: input.scenePlan.emotionalPacing,
    wardrobe: wardrobeFromMetadata(input.characterMetadata),
    environmentContinuity: `${input.scenePlan.environmentDescription} ${input.shot.environmentFocus}`.trim(),
    continuityNotes: input.scenePlan.continuityNotes,
    cameraFraming: input.shot.cameraFraming,
    cameraMovement: input.shot.cameraMovement,
    sceneTransition: input.shot.transition,
    shotDescription: input.shot.description,
    subjectAction: input.shot.subjectAction,
    durationHint: input.shot.durationHint,
    referenceImageCount: input.referenceImageCount,
    continuityMemoryScope: input.continuityMemory.memoryScope,
    continuityConfidence: input.continuityMemory.continuityConfidence,
    continuityDrift: input.continuityMemory.driftAlerts.slice(0, 3),
    memorySnapshot: input.continuityMemory.state,
    sceneMemorySummary: null,
  };
}

function jobMetadata(input: {
  sceneExecutionId: string;
  clipOrder: number;
  scenePlan: CreativeBrainScenePlan;
  shot: CreativeBrainShot;
  metadata: SceneClipMetadata;
}) {
  return {
    ...input.metadata,
    sceneExecutionId: input.sceneExecutionId,
    sceneId: input.shot.id,
    clipOrder: input.clipOrder,
    shotTitle: input.shot.title,
    promptRewrite: input.scenePlan.promptRewrite,
  };
}

export async function executeScenePlan(input: ExecuteScenePlanInput): Promise<SceneExecutorResult> {
  const parsedPlan = creativeBrainScenePlanSchema.parse(input.scenePlan);
  const sceneExecutionId = randomUUID();
  const createdAt = new Date().toISOString();
  const clips: SceneExecutorClip[] = [];
  const engine = input.quality === 'quality' ? 'seedance-quality' : 'seedance-2.0';
  const storedCharacterProfile = input.characterId
    ? await getCinematicCharacterProfileForUser(input.userId, input.characterId).catch((error) => {
        console.warn('SCENE EXECUTOR CHARACTER PROFILE LOAD FAILED:', {
          userId: input.userId,
          characterId: input.characterId,
          error,
        });
        return null;
      })
    : null;
  const characterProfile = storedCharacterProfile ?? characterProfileFromMetadata(input.characterMetadata, input.characterId);
  const executionCharacterId = stringValue(characterProfile?.characterId) ?? stringValue(input.characterId);

  let continuityMemory = characterProfile
    ? await inheritCharacterContinuity({
        userId: input.userId,
        projectId: input.projectId ?? null,
        profile: characterProfile,
      })
    : await getContinuityMemory({
        userId: input.userId,
        projectId: input.projectId ?? null,
        characterId: executionCharacterId,
      });
  let previousScene: string | null = continuityMemory.previousSceneSummary;

  console.info('SCENE EXECUTOR START:', {
    sceneExecutionId,
    shotCount: parsedPlan.shotList.length,
    referenceImageCount: input.referenceImages?.length ?? 0,
    engine,
    memoryScope: continuityMemory.memoryScope,
    continuityConfidence: continuityMemory.continuityConfidence,
    characterId: executionCharacterId,
    characterDisplayName: characterProfile?.displayName ?? null,
  });

  for (const [index, shot] of parsedPlan.shotList.entries()) {
    const clipOrder = index + 1;
    const metadata = clipMetadata({
      scenePlan: parsedPlan,
      shot,
      previousScene,
      referenceImageCount: input.referenceImages?.length ?? 0,
      characterMetadata: input.characterMetadata,
      continuityMemory,
      characterProfile,
    });
    const prompt = shotPrompt({
      scenePlan: parsedPlan,
      shot,
      clipOrder,
      clipCount: parsedPlan.shotList.length,
      previousScene,
      metadata,
      continuityMemory,
      characterProfile,
    });
    const queuedJob = await createGenerationJob({
      userId: input.userId,
      projectId: input.projectId ?? null,
      provider: 'replicate',
      providerJobId: null,
      outputType: 'video',
      prompt,
      status: 'queued',
      characterId: executionCharacterId,
      durationSeconds: 5,
      aspectRatio: '16:9',
      privacy: input.privacy ?? 'private',
      resultAssetUrl: null,
      errorMessage: null,
      sceneExecutionId,
      sceneId: shot.id,
      clipOrder,
      sceneMetadata: jobMetadata({
        sceneExecutionId,
        clipOrder,
        scenePlan: parsedPlan,
        shot,
        metadata,
      }),
    });
    const clip: SceneExecutorClip = {
      id: queuedJob.id,
      jobId: queuedJob.id,
      sceneExecutionId,
      sceneId: shot.id,
      clipOrder,
      status: 'queued',
      title: shot.title,
      prompt,
      finalPrompt: null,
      videoUrl: null,
      provider: 'replicate',
      model: null,
      providerJobId: null,
      error: null,
      metadata,
      moderationDiagnostics: null,
      createdAt: queuedJob.createdAt,
    };

    clips.push(clip);

    console.info('SCENE EXECUTOR JOB QUEUED:', {
      sceneExecutionId,
      sceneId: shot.id,
      clipOrder,
      jobId: queuedJob.id,
      title: shot.title,
    });

    console.info('SCENE EXECUTOR SHOT PROCESSING:', {
      sceneExecutionId,
      sceneId: shot.id,
      clipOrder: clip.clipOrder,
      jobId: clip.jobId,
      title: shot.title,
      previousScene: metadata.previousScene,
    });

    await updateGenerationJobStatus({
      jobId: clip.jobId ?? clip.id,
      status: 'processing',
      errorMessage: null,
    });
    clip.status = 'processing';

    try {
      const seedanceResult = await generateSeedanceVideo(prompt, {
        quality: input.quality,
        referenceImages: input.referenceImages,
        userId: input.userId,
        characterId: executionCharacterId,
        projectId: input.projectId ?? null,
      });
      const completedJob = await updateGenerationJobStatus({
        jobId: clip.jobId ?? clip.id,
        status: 'completed',
        providerJobId: seedanceResult.providerJobId,
        resultAssetUrl: seedanceResult.videoUrl,
        errorMessage: null,
      });

      clip.status = 'completed';
      clip.finalPrompt = seedanceResult.finalPrompt;
      clip.videoUrl = seedanceResult.videoUrl;
      clip.provider = seedanceResult.provider;
      clip.model = seedanceResult.model;
      clip.providerJobId = seedanceResult.providerJobId;
      clip.error = null;
      clip.moderationDiagnostics = seedanceResult.moderationDiagnostics ?? null;
      clip.metadata = {
        ...clip.metadata,
        moderationOrchestration: seedanceResult.moderationDiagnostics ?? null,
      };
      clip.createdAt = completedJob?.createdAt ?? clip.createdAt;

      let driftAlertCount = 0;
      try {
        const memoryUpdate = await updateContinuityMemoryAfterCompletedScene({
          sceneExecutionId,
          scenePlan: parsedPlan,
          shot,
          clipOrder,
          metadata,
          userId: input.userId,
          projectId: input.projectId ?? null,
          characterId: executionCharacterId,
          characterMetadata: input.characterMetadata,
        });

        continuityMemory = memoryUpdate.memory;
        previousScene = memoryUpdate.sceneSummary.summary || sceneContinuitySummary({ shot, metadata });
        driftAlertCount = memoryUpdate.driftAlerts.length;
        clip.metadata = {
          ...metadata,
          continuityMemoryScope: continuityMemory.memoryScope,
          continuityConfidence: continuityMemory.continuityConfidence,
          continuityDrift: memoryUpdate.driftAlerts,
          memorySnapshot: continuityMemory.state,
          sceneMemorySummary: memoryUpdate.sceneSummary,
          moderationOrchestration: seedanceResult.moderationDiagnostics ?? null,
        };
        await updateGenerationJobSceneMetadata({
          jobId: clip.jobId ?? clip.id,
          sceneMetadata: jobMetadata({
            sceneExecutionId,
            clipOrder,
            scenePlan: parsedPlan,
            shot,
            metadata: clip.metadata,
          }),
        });
        if (storedCharacterProfile) {
          await updateCharacterProfileFromMemory({
            ownerUserId: input.userId,
            characterId: storedCharacterProfile.characterId,
            memory: continuityMemory,
            sceneSummary: memoryUpdate.sceneSummary,
            driftAlerts: memoryUpdate.driftAlerts,
          });
        }
      } catch (memoryError) {
        previousScene = sceneContinuitySummary({ shot, metadata });
        console.error('MEMORY ENGINE UPDATE FAILED:', {
          sceneExecutionId,
          sceneId: shot.id,
          clipOrder,
          jobId: clip.jobId,
          error: memoryError,
        });
      }

      console.info('SCENE EXECUTOR SHOT COMPLETED:', {
        sceneExecutionId,
        sceneId: shot.id,
        clipOrder: clip.clipOrder,
        jobId: clip.jobId,
        providerJobId: seedanceResult.providerJobId,
        videoUrl: seedanceResult.videoUrl,
        continuityConfidence: continuityMemory.continuityConfidence,
        driftAlertCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scene clip generation failed.';
      const moderationDiagnostics = isSeedanceModerationError(error) ? error.diagnostics : null;
      const failedJob = await updateGenerationJobStatus({
        jobId: clip.jobId ?? clip.id,
        status: 'failed',
        resultAssetUrl: null,
        errorMessage: message,
      });

      clip.status = 'failed';
      clip.finalPrompt = null;
      clip.videoUrl = null;
      clip.provider = 'replicate';
      clip.model = null;
      clip.providerJobId = null;
      clip.error = message;
      clip.moderationDiagnostics = moderationDiagnostics;
      clip.metadata = {
        ...clip.metadata,
        moderationOrchestration: moderationDiagnostics,
      };
      clip.createdAt = failedJob?.createdAt ?? clip.createdAt;
      await updateGenerationJobSceneMetadata({
        jobId: clip.jobId ?? clip.id,
        sceneMetadata: jobMetadata({
          sceneExecutionId,
          clipOrder,
          scenePlan: parsedPlan,
          shot,
          metadata: clip.metadata,
        }),
      });

      console.error('SCENE EXECUTOR SHOT FAILED:', {
        sceneExecutionId,
        sceneId: shot.id,
        clipOrder: clip.clipOrder,
        jobId: clip.jobId,
        error,
      });

      return {
        id: sceneExecutionId,
        status: 'failed',
        provider: 'seedance',
        engine,
        clips,
        failedClip: clip,
        scenePlan: parsedPlan,
        continuityMemory,
        createdAt,
        completedAt: new Date().toISOString(),
      };
    }
  }

  return {
    id: sceneExecutionId,
    status: 'completed',
    provider: 'seedance',
    engine,
    clips,
    failedClip: null,
    scenePlan: parsedPlan,
    continuityMemory,
    createdAt,
    completedAt: new Date().toISOString(),
  };
}
