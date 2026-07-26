import { GoogleGenAI, type Interactions } from '@google/genai';
import type { DirectorBudgetDecision, DirectorCostTelemetry, DirectorPaidOperation } from './budget';
import {
  assertPaidOperationAuthorized,
  recordDirectorCostOutcome,
  recordPaidRequest,
} from './budget';

export type GoogleInteractionPayload = Interactions.CreateModelInteractionParamsNonStreaming;

export type GoogleMediaExecutionContext = {
  apiKey: string;
  operation: DirectorPaidOperation;
  decision: DirectorBudgetDecision;
  telemetry: DirectorCostTelemetry;
};

export function createGoogleMediaClient(apiKey: string) {
  if (!apiKey.trim()) throw new Error('Google media generation is not configured.');
  return new GoogleGenAI({ apiKey });
}

export class DirectorProviderExecutionError extends Error {
  readonly telemetry: DirectorCostTelemetry;
  readonly safeCategory = 'provider_request_failed';

  constructor(telemetry: DirectorCostTelemetry) {
    super('The Director provider request did not complete.');
    this.name = 'DirectorProviderExecutionError';
    this.telemetry = telemetry;
  }
}

export async function executeGoogleMediaInteraction(
  payload: GoogleInteractionPayload,
  context: GoogleMediaExecutionContext,
) {
  const decision = assertPaidOperationAuthorized({
    operation: context.operation,
    decision: context.decision,
    requestsAlreadyMade: context.telemetry.requestsByOperation[context.operation],
  });
  const client = createGoogleMediaClient(context.apiKey);
  const requestTelemetry = recordPaidRequest(context.telemetry, decision, context.operation);
  try {
    const interaction = await client.interactions.create(payload, {
      maxRetries: 0,
    });
    return {
      interaction,
      telemetry: recordDirectorCostOutcome(requestTelemetry, {
        operation: context.operation,
        status: 'completed',
      }),
    };
  } catch {
    throw new DirectorProviderExecutionError(recordDirectorCostOutcome(requestTelemetry, {
      operation: context.operation,
      status: 'failed',
    }));
  }
}
