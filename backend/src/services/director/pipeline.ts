import type { DirectorPlan, UserOwnedFrontReference } from './contracts';
import { buildNanoBananaPayload, buildOmniFlashPayload } from './adapters';
import { createDirectorCostTelemetry, DEFAULT_DIRECTOR_BUDGET } from './budget';
import { DIRECTOR_PROGRESS_STATES } from './progress';
import { selectDirectorRoute } from './routing';

export function prepareDirectorDryRun(input: {
  plan: DirectorPlan;
  frontReference: UserOwnedFrontReference;
  placeholderAnchorData?: string;
}) {
  const routing = selectDirectorRoute({
    intent: 'personal_ai_cast',
    hasPersonalIdentityImage: true,
  });
  const sceneAnchorPayload = buildNanoBananaPayload({
    reference: input.frontReference,
    plan: input.plan,
  });
  const primaryVideoPayload = buildOmniFlashPayload({
    anchor: {
      data: input.placeholderAnchorData ?? '<scene-anchor-bytes>',
      mimeType: 'image/jpeg',
    },
    plan: input.plan,
    durationSeconds: 4,
    aspectRatio: '9:16',
  });

  return {
    mode: 'dry_run' as const,
    routing,
    progressStates: DIRECTOR_PROGRESS_STATES,
    budget: DEFAULT_DIRECTOR_BUDGET,
    telemetry: createDirectorCostTelemetry(),
    sceneAnchorPayload,
    primaryVideoPayload,
    automaticProviderRequests: 0,
    automaticRepairs: 0,
  };
}

export * from './contracts';
export * from './planner';
export * from './progress';
export * from './budget';
export * from './routing';
export * from './adapters';
export * from './quality';
export * from './assembly';
export * from './output';
export * from './diagnostics';
export * from './dryRunDiagnostics';
