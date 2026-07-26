export type DirectorPaidOperation =
  | 'scene_anchor'
  | 'primary_video'
  | 'fallback_video'
  | 'repair_edit';

export type DirectorBudgetDecision = {
  id: string;
  operation: DirectorPaidOperation;
  authorizedBy: 'user' | 'plan_allowance';
  maximumRequests: number;
  recordedAt: string;
};

export type DirectorCostTelemetry = {
  providerRequestCount: number;
  providerRetryCount: number;
  providerFallbackCount: number;
  repairRequestCount: number;
  requestsByOperation: Record<DirectorPaidOperation, number>;
  budgetDecisionIds: string[];
  events: Array<{
    operation: DirectorPaidOperation;
    status: 'requested' | 'completed' | 'failed';
    billableMetric: number | null;
    estimatedCostUsd: number | null;
  }>;
};

export const DEFAULT_DIRECTOR_BUDGET = Object.freeze({
  sceneAnchor: 1,
  primaryVideo: 1,
  automaticFallbackVideos: 0,
  automaticRepairPasses: 0,
});

export function createDirectorCostTelemetry(): DirectorCostTelemetry {
  return {
    providerRequestCount: 0,
    providerRetryCount: 0,
    providerFallbackCount: 0,
    repairRequestCount: 0,
    requestsByOperation: {
      scene_anchor: 0,
      primary_video: 0,
      fallback_video: 0,
      repair_edit: 0,
    },
    budgetDecisionIds: [],
    events: [],
  };
}

export function assertPaidOperationAuthorized(input: {
  operation: DirectorPaidOperation;
  decision?: DirectorBudgetDecision | null;
  requestsAlreadyMade: number;
}) {
  const decision = input.decision;
  if (!decision || decision.operation !== input.operation || decision.maximumRequests < 1) {
    throw new Error('A recorded budget decision is required before this paid Director operation.');
  }
  if (input.requestsAlreadyMade >= decision.maximumRequests) {
    throw new Error('The recorded Director request budget is exhausted.');
  }
  return decision;
}

export function recordPaidRequest(
  telemetry: DirectorCostTelemetry,
  decision: DirectorBudgetDecision,
  operation: DirectorPaidOperation,
): DirectorCostTelemetry {
  return {
    ...telemetry,
    providerRequestCount: telemetry.providerRequestCount + 1,
    repairRequestCount: telemetry.repairRequestCount + (operation === 'repair_edit' ? 1 : 0),
    requestsByOperation: {
      ...telemetry.requestsByOperation,
      [operation]: telemetry.requestsByOperation[operation] + 1,
    },
    budgetDecisionIds: telemetry.budgetDecisionIds.includes(decision.id)
      ? telemetry.budgetDecisionIds
      : [...telemetry.budgetDecisionIds, decision.id],
    events: [...telemetry.events, {
      operation,
      status: 'requested',
      billableMetric: null,
      estimatedCostUsd: null,
    }],
  };
}

export function recordDirectorCostOutcome(
  telemetry: DirectorCostTelemetry,
  input: {
    operation: DirectorPaidOperation;
    status: 'completed' | 'failed';
    billableMetric?: number | null;
    estimatedCostUsd?: number | null;
  },
): DirectorCostTelemetry {
  return {
    ...telemetry,
    events: [...telemetry.events, {
      operation: input.operation,
      status: input.status,
      billableMetric: input.billableMetric ?? null,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
    }],
  };
}
