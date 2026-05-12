import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../lib/env';
import { openai } from '../lib/openaiClient';

export type CreativeBrainProviderId = 'openai';

export interface CreativeBrainShot {
  id: string;
  title: string;
  description: string;
  cameraFraming: string;
  cameraMovement: string;
  subjectAction: string;
  environmentFocus: string;
  durationHint: string;
  transition: string;
}

export interface CreativeBrainScenePlan {
  cinematicTone: string;
  visualStyle: string;
  soundtrackMood: string;
  continuityNotes: string[];
  shotList: CreativeBrainShot[];
  cameraFraming: string[];
  environmentDescription: string;
  emotionalPacing: string;
  sceneTransitions: string[];
  promptRewrite: string;
}

export interface CreativeBrainPlanInput {
  prompt: string;
  characterMetadata?: Record<string, unknown> | null;
  styleTheme?: string | null;
}

export interface CreativeBrainPlanResult {
  id: string;
  provider: CreativeBrainProviderId;
  model: string;
  plan: CreativeBrainScenePlan;
  rawText: string;
  attempts: number;
  createdAt: string;
}

type CreativeBrainCompletionInput = CreativeBrainPlanInput & {
  attempt: number;
  previousOutput?: string;
  previousError?: string;
};

interface CreativeBrainProvider {
  id: CreativeBrainProviderId;
  model: string;
  completeJson(input: CreativeBrainCompletionInput): Promise<string>;
}

export class CreativeBrainConfigurationError extends Error {
  readonly statusCode = 503;

  constructor(message = 'Creative Brain is not configured. Set OPENAI_API_KEY on the API server.') {
    super(message);
    this.name = 'CreativeBrainConfigurationError';
  }
}

const shotSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  cameraFraming: z.string().min(1),
  cameraMovement: z.string().min(1),
  subjectAction: z.string().min(1),
  environmentFocus: z.string().min(1),
  durationHint: z.string().min(1),
  transition: z.string().min(1),
});

export const creativeBrainScenePlanSchema = z.object({
  cinematicTone: z.string().min(1),
  visualStyle: z.string().min(1),
  soundtrackMood: z.string().min(1),
  continuityNotes: z.array(z.string().min(1)).min(1),
  shotList: z.array(shotSchema).min(3).max(8),
  cameraFraming: z.array(z.string().min(1)).min(1),
  environmentDescription: z.string().min(1),
  emotionalPacing: z.string().min(1),
  sceneTransitions: z.array(z.string().min(1)).min(1),
  promptRewrite: z.string().min(1),
});

const creativeBrainResponseSchema = z.object({
  plan: creativeBrainScenePlanSchema,
});

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('No JSON object found in Creative Brain response.');
    }
    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown;
  }
}

function parseCreativeBrainPlan(text: string) {
  const parsed = extractJsonObject(text);
  const response = creativeBrainResponseSchema.safeParse(parsed);
  if (!response.success) {
    throw new Error(response.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return response.data.plan;
}

function systemPrompt() {
  return [
    'You are Lumora Creative Brain v1, a cinematic planning engine.',
    'Transform simple user prompts into structured production-ready scene plans.',
    'Do not generate video, image files, or executable code.',
    'Return only strict JSON. No markdown, no commentary.',
    'The JSON must match this exact shape:',
    JSON.stringify({
      plan: {
        cinematicTone: 'string',
        visualStyle: 'string',
        soundtrackMood: 'string',
        continuityNotes: ['string'],
        shotList: [
          {
            id: 'shot-1',
            title: 'string',
            description: 'string',
            cameraFraming: 'string',
            cameraMovement: 'string',
            subjectAction: 'string',
            environmentFocus: 'string',
            durationHint: 'string',
            transition: 'string',
          },
        ],
        cameraFraming: ['string'],
        environmentDescription: 'string',
        emotionalPacing: 'string',
        sceneTransitions: ['string'],
        promptRewrite: 'string',
      },
    }),
    'Use 3 to 6 shots. Keep plans cinematic, coherent, safe, and directly usable by a video model.',
  ].join('\n');
}

function userPrompt(input: CreativeBrainCompletionInput) {
  return [
    `User prompt: ${input.prompt}`,
    `Style/theme: ${input.styleTheme?.trim() || 'not specified'}`,
    `Character metadata JSON: ${compactJson(input.characterMetadata)}`,
    input.previousOutput
      ? `Previous malformed output to repair: ${input.previousOutput.slice(0, 6000)}`
      : '',
    input.previousError
      ? `Validation error to fix: ${input.previousError}`
      : '',
  ].filter(Boolean).join('\n\n');
}

class OpenAICreativeBrainProvider implements CreativeBrainProvider {
  readonly id = 'openai' as const;
  readonly model = env.OPENAI_CHAT_MODEL ?? env.OPENAI_MODEL ?? 'gpt-4.1-mini';

  async completeJson(input: CreativeBrainCompletionInput): Promise<string> {
    if (!openai) {
      throw new CreativeBrainConfigurationError();
    }

    const response = await openai.chat.completions.create({
      model: this.model,
      temperature: input.attempt === 1 ? 0.7 : 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: userPrompt(input) },
      ],
    });

    return response.choices[0]?.message?.content ?? '';
  }
}

function defaultProvider(): CreativeBrainProvider {
  return new OpenAICreativeBrainProvider();
}

export async function createCreativeBrainPlan(
  input: CreativeBrainPlanInput,
  provider: CreativeBrainProvider = defaultProvider(),
): Promise<CreativeBrainPlanResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('Creative Brain requires a prompt.');
  }

  let previousOutput = '';
  let previousError = '';

  for (const attempt of [1, 2]) {
    const rawText = await provider.completeJson({
      ...input,
      prompt,
      attempt,
      previousOutput,
      previousError,
    });

    try {
      const plan = parseCreativeBrainPlan(rawText);
      return {
        id: randomUUID(),
        provider: provider.id,
        model: provider.model,
        plan,
        rawText,
        attempts: attempt,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      previousOutput = rawText;
      previousError = error instanceof Error ? error.message : 'Creative Brain returned malformed JSON.';
      console.warn('CREATIVE BRAIN JSON PARSE FAILED:', {
        provider: provider.id,
        model: provider.model,
        attempt,
        previousError,
        rawText,
      });
    }
  }

  throw new Error(`Creative Brain returned malformed JSON after retry. ${previousError}`);
}
