import { query } from './db';
import type { CreativeBrainScenePlan, CreativeBrainShot } from './creativeBrain';
import type { SceneClipMetadata } from './sceneExecutor';

export const continuityMemoryFields = [
  'characterAppearance',
  'wardrobe',
  'hairstyle',
  'emotionalTone',
  'environment',
  'props',
  'weather',
  'timeOfDay',
  'soundtrackMood',
  'cameraStyle',
  'previousSceneSummary',
] as const;

export type ContinuityMemoryField = typeof continuityMemoryFields[number];

export type ContinuityMemoryState = Record<ContinuityMemoryField, string>;

export type ContinuityMemoryLocks = Partial<Record<ContinuityMemoryField, boolean>>;

export type ContinuityDriftAlert = {
  field: ContinuityMemoryField;
  previousValue: string;
  nextValue: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  detectedAt: string;
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
};

export type SceneMemorySummary = {
  sceneExecutionId: string;
  sceneId: string;
  clipOrder: number;
  title: string;
  summary: string;
  capturedAt: string;
  continuityConfidence: number;
  driftAlerts: ContinuityDriftAlert[];
};

export type ContinuityMemoryRecord = {
  id: string | null;
  userId: string;
  projectId: string | null;
  characterId: string | null;
  memoryScope: string;
  state: ContinuityMemoryState;
  lockedFields: ContinuityMemoryLocks;
  continuityConfidence: number;
  driftAlerts: ContinuityDriftAlert[];
  sceneMemorySummaries: SceneMemorySummary[];
  previousSceneSummary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ContinuityMemoryScopeInput = {
  userId: string;
  projectId?: string | null;
  characterId?: string | null;
};

export type UpdateContinuityMemoryAfterSceneInput = ContinuityMemoryScopeInput & {
  sceneExecutionId: string;
  scenePlan: CreativeBrainScenePlan;
  shot: CreativeBrainShot;
  clipOrder: number;
  metadata: SceneClipMetadata;
  characterMetadata?: Record<string, unknown> | null;
};

type ContinuityMemoryRow = {
  id: string;
  userId: string;
  projectId: string | null;
  characterId: string | null;
  memoryScope: string;
  state: Record<string, unknown>;
  lockedFields: Record<string, unknown>;
  continuityConfidence: string | number;
  driftAlerts: unknown;
  sceneMemorySummaries: unknown;
  previousSceneSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

const fieldLabels: Record<ContinuityMemoryField, string> = {
  characterAppearance: 'Character appearance',
  wardrobe: 'Wardrobe',
  hairstyle: 'Hairstyle',
  emotionalTone: 'Emotional tone',
  environment: 'Environment',
  props: 'Props',
  weather: 'Weather',
  timeOfDay: 'Time of day',
  soundtrackMood: 'Soundtrack mood',
  cameraStyle: 'Camera style',
  previousSceneSummary: 'Previous scene summary',
};

const emptyContinuityState: ContinuityMemoryState = {
  characterAppearance: '',
  wardrobe: '',
  hairstyle: '',
  emotionalTone: '',
  environment: '',
  props: '',
  weather: '',
  timeOfDay: '',
  soundtrackMood: '',
  cameraStyle: '',
  previousSceneSummary: '',
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeState(value: unknown): ContinuityMemoryState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return continuityMemoryFields.reduce<ContinuityMemoryState>((state, field) => {
    state[field] = textValue(record[field]);
    return state;
  }, { ...emptyContinuityState });
}

function normalizeLocks(value: unknown): ContinuityMemoryLocks {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return continuityMemoryFields.reduce<ContinuityMemoryLocks>((locks, field) => {
    if (typeof record[field] === 'boolean') {
      locks[field] = record[field] as boolean;
    }
    return locks;
  }, {});
}

function normalizeDriftAlerts(value: unknown): ContinuityDriftAlert[] {
  return Array.isArray(value)
    ? value.filter((item): item is ContinuityDriftAlert => Boolean(item) && typeof item === 'object')
    : [];
}

function normalizeSceneSummaries(value: unknown): SceneMemorySummary[] {
  return Array.isArray(value)
    ? value.filter((item): item is SceneMemorySummary => Boolean(item) && typeof item === 'object')
    : [];
}

export function continuityMemoryScope(input: ContinuityMemoryScopeInput) {
  if (input.projectId) return `project:${input.projectId}`;
  if (input.characterId) return `character:${input.characterId}`;
  return `user:${input.userId}`;
}

function virtualMemory(input: ContinuityMemoryScopeInput): ContinuityMemoryRecord {
  return {
    id: null,
    userId: input.userId,
    projectId: input.projectId ?? null,
    characterId: input.characterId ?? null,
    memoryScope: continuityMemoryScope(input),
    state: { ...emptyContinuityState },
    lockedFields: {},
    continuityConfidence: 0.5,
    driftAlerts: [],
    sceneMemorySummaries: [],
    previousSceneSummary: null,
    createdAt: null,
    updatedAt: null,
  };
}

function rowToMemory(row: ContinuityMemoryRow): ContinuityMemoryRecord {
  const state = normalizeState(row.state);
  const previousSceneSummary = row.previousSceneSummary || state.previousSceneSummary || null;

  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    characterId: row.characterId,
    memoryScope: row.memoryScope,
    state: {
      ...state,
      previousSceneSummary: previousSceneSummary ?? '',
    },
    lockedFields: normalizeLocks(row.lockedFields),
    continuityConfidence: clamp(numberValue(row.continuityConfidence, 0.5), 0, 1),
    driftAlerts: normalizeDriftAlerts(row.driftAlerts),
    sceneMemorySummaries: normalizeSceneSummaries(row.sceneMemorySummaries),
    previousSceneSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getContinuityMemory(input: ContinuityMemoryScopeInput): Promise<ContinuityMemoryRecord> {
  const scope = continuityMemoryScope(input);
  const result = await query<ContinuityMemoryRow>(
    `select
       id,
       user_id as "userId",
       project_id as "projectId",
       character_id as "characterId",
       memory_scope as "memoryScope",
       state,
       locked_fields as "lockedFields",
       continuity_confidence as "continuityConfidence",
       drift_alerts as "driftAlerts",
       scene_memory_summaries as "sceneMemorySummaries",
       previous_scene_summary as "previousSceneSummary",
       created_at as "createdAt",
       updated_at as "updatedAt"
     from continuity_memory_states
     where user_id = $1 and memory_scope = $2
     limit 1`,
    [input.userId, scope],
  );

  return result.rows[0] ? rowToMemory(result.rows[0]) : virtualMemory(input);
}

async function upsertContinuityMemory(input: ContinuityMemoryRecord): Promise<ContinuityMemoryRecord> {
  const result = await query<ContinuityMemoryRow>(
    `insert into continuity_memory_states (
       user_id,
       project_id,
       character_id,
       memory_scope,
       state,
       locked_fields,
       continuity_confidence,
       drift_alerts,
       scene_memory_summaries,
       previous_scene_summary
     )
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10)
     on conflict (user_id, memory_scope) do update
     set
       project_id = excluded.project_id,
       character_id = excluded.character_id,
       state = excluded.state,
       locked_fields = excluded.locked_fields,
       continuity_confidence = excluded.continuity_confidence,
       drift_alerts = excluded.drift_alerts,
       scene_memory_summaries = excluded.scene_memory_summaries,
       previous_scene_summary = excluded.previous_scene_summary,
       updated_at = now()
     returning
       id,
       user_id as "userId",
       project_id as "projectId",
       character_id as "characterId",
       memory_scope as "memoryScope",
       state,
       locked_fields as "lockedFields",
       continuity_confidence as "continuityConfidence",
       drift_alerts as "driftAlerts",
       scene_memory_summaries as "sceneMemorySummaries",
       previous_scene_summary as "previousSceneSummary",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [
      input.userId,
      input.projectId,
      input.characterId,
      input.memoryScope,
      JSON.stringify(input.state),
      JSON.stringify(input.lockedFields),
      input.continuityConfidence,
      JSON.stringify(input.driftAlerts),
      JSON.stringify(input.sceneMemorySummaries),
      input.previousSceneSummary,
    ],
  );

  return rowToMemory(result.rows[0]);
}

export async function saveContinuityMemoryPatch(input: ContinuityMemoryScopeInput & {
  state?: Partial<ContinuityMemoryState> | null;
  lockedFields?: ContinuityMemoryLocks | null;
}) {
  const existing = await getContinuityMemory(input);
  const nextState = normalizeState({
    ...existing.state,
    ...(input.state ?? {}),
  });
  const nextLocks = normalizeLocks({
    ...existing.lockedFields,
    ...(input.lockedFields ?? {}),
  });
  const previousSceneSummary = nextState.previousSceneSummary || existing.previousSceneSummary;

  return upsertContinuityMemory({
    ...existing,
    projectId: input.projectId ?? existing.projectId,
    characterId: input.characterId ?? existing.characterId,
    state: {
      ...nextState,
      previousSceneSummary: previousSceneSummary ?? '',
    },
    lockedFields: nextLocks,
    previousSceneSummary: previousSceneSummary ?? null,
  });
}

function uniqueTokens(value: string) {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  ));
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = uniqueTokens(left);
  const rightTokens = uniqueTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function sameContinuityValue(left: string, right: string) {
  const normalizedLeft = left.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedRight = right.toLowerCase().replace(/\s+/g, ' ').trim();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft) ||
    tokenSimilarity(normalizedLeft, normalizedRight) >= 0.42
  );
}

function firstKeyword(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.find((keyword) => lower.includes(keyword)) ?? '';
}

function deriveTimeOfDay(text: string) {
  return firstKeyword(text, [
    'sunrise',
    'dawn',
    'morning',
    'midday',
    'noon',
    'afternoon',
    'golden hour',
    'sunset',
    'dusk',
    'twilight',
    'night',
    'midnight',
  ]);
}

function deriveWeather(text: string) {
  return firstKeyword(text, [
    'rain',
    'rainy',
    'storm',
    'snow',
    'fog',
    'mist',
    'haze',
    'sunny',
    'overcast',
    'cloudy',
    'wind',
  ]);
}

function deriveProps(scenePlan: CreativeBrainScenePlan, shot: CreativeBrainShot) {
  const propNotes = scenePlan.continuityNotes.filter((note) => /prop|object|holding|carries|wears|with /i.test(note));
  if (propNotes.length) return propNotes.join('; ');
  const actionProps = shot.subjectAction.match(/\b(holding|carrying|with|near|beside)\b.+/i)?.[0];
  return actionProps ?? '';
}

function deriveHairstyle(characterMetadata?: Record<string, unknown> | null) {
  return (
    textValue(characterMetadata?.hairstyle) ||
    textValue(characterMetadata?.hairStyle) ||
    textValue(characterMetadata?.hair) ||
    textValue(characterMetadata?.hairColor)
  );
}

function deriveCharacterAppearance(characterMetadata?: Record<string, unknown> | null) {
  return (
    textValue(characterMetadata?.identityAppearanceSummary) ||
    textValue(characterMetadata?.appearanceSummary) ||
    textValue(characterMetadata?.characterDescription) ||
    textValue(characterMetadata?.description)
  );
}

function sceneSummary(input: {
  scenePlan: CreativeBrainScenePlan;
  shot: CreativeBrainShot;
  metadata: SceneClipMetadata;
}) {
  return [
    `${input.shot.title}: ${input.shot.description}`,
    `Emotion: ${input.metadata.emotionalState}.`,
    `Wardrobe: ${input.metadata.wardrobe}.`,
    `Environment: ${input.metadata.environmentContinuity}.`,
    `Camera: ${input.shot.cameraFraming}, ${input.shot.cameraMovement}.`,
  ].join(' ');
}

function deriveSceneState(input: UpdateContinuityMemoryAfterSceneInput): ContinuityMemoryState {
  const fullSceneText = [
    input.scenePlan.promptRewrite,
    input.scenePlan.environmentDescription,
    input.scenePlan.visualStyle,
    input.scenePlan.cinematicTone,
    input.scenePlan.continuityNotes.join(' '),
    input.shot.description,
    input.shot.environmentFocus,
    input.shot.subjectAction,
  ].join(' ');
  const summary = sceneSummary(input);

  return {
    characterAppearance: deriveCharacterAppearance(input.characterMetadata),
    wardrobe: input.metadata.wardrobe,
    hairstyle: deriveHairstyle(input.characterMetadata),
    emotionalTone: input.scenePlan.emotionalPacing || input.scenePlan.cinematicTone,
    environment: input.metadata.environmentContinuity || input.scenePlan.environmentDescription,
    props: deriveProps(input.scenePlan, input.shot),
    weather: deriveWeather(fullSceneText),
    timeOfDay: deriveTimeOfDay(fullSceneText),
    soundtrackMood: input.scenePlan.soundtrackMood,
    cameraStyle: `${input.scenePlan.visualStyle}. ${input.shot.cameraFraming}; ${input.shot.cameraMovement}.`,
    previousSceneSummary: summary,
  };
}

function detectContinuityDrift(input: {
  previousState: ContinuityMemoryState;
  nextCandidate: ContinuityMemoryState;
  lockedFields: ContinuityMemoryLocks;
  sceneExecutionId: string;
  sceneId: string;
  clipOrder: number;
}) {
  const detectedAt = new Date().toISOString();
  const driftFields = continuityMemoryFields.filter((field) => field !== 'previousSceneSummary');

  return driftFields.flatMap((field): ContinuityDriftAlert[] => {
    const previousValue = input.previousState[field];
    const nextValue = input.nextCandidate[field];

    if (!previousValue || !nextValue || sameContinuityValue(previousValue, nextValue)) {
      return [];
    }

    const locked = Boolean(input.lockedFields[field]);
    const similarity = tokenSimilarity(previousValue, nextValue);
    if (!locked && similarity >= 0.24) return [];

    return [{
      field,
      previousValue,
      nextValue,
      severity: locked ? 'high' : similarity < 0.12 ? 'medium' : 'low',
      reason: locked
        ? `${fieldLabels[field]} is locked but the completed scene introduced a different value.`
        : `${fieldLabels[field]} shifted sharply from the stored cinematic memory.`,
      detectedAt,
      sceneExecutionId: input.sceneExecutionId,
      sceneId: input.sceneId,
      clipOrder: input.clipOrder,
    }];
  });
}

function mergeSceneState(input: {
  previousState: ContinuityMemoryState;
  nextCandidate: ContinuityMemoryState;
  lockedFields: ContinuityMemoryLocks;
}) {
  return continuityMemoryFields.reduce<ContinuityMemoryState>((state, field) => {
    const previousValue = input.previousState[field];
    const nextValue = input.nextCandidate[field];

    state[field] = input.lockedFields[field] && previousValue
      ? previousValue
      : nextValue || previousValue || '';

    return state;
  }, { ...emptyContinuityState });
}

function confidenceScore(input: {
  previousMemory: ContinuityMemoryRecord;
  driftAlerts: ContinuityDriftAlert[];
  nextState: ContinuityMemoryState;
}) {
  const populatedFields = continuityMemoryFields
    .filter((field) => field !== 'previousSceneSummary')
    .filter((field) => input.nextState[field]).length;
  const lockedFields = continuityMemoryFields.filter((field) => input.previousMemory.lockedFields[field]).length;
  const baseline = input.previousMemory.id ? 0.78 : 0.64;
  const fieldBoost = Math.min(0.14, populatedFields * 0.012);
  const lockBoost = Math.min(0.08, lockedFields * 0.01);
  const driftPenalty = input.driftAlerts.reduce((total, alert) => {
    if (alert.severity === 'high') return total + 0.18;
    if (alert.severity === 'medium') return total + 0.1;
    return total + 0.05;
  }, 0);

  return Number(clamp(baseline + fieldBoost + lockBoost - driftPenalty, 0.12, 0.98).toFixed(2));
}

export async function updateContinuityMemoryAfterCompletedScene(
  input: UpdateContinuityMemoryAfterSceneInput,
) {
  const previousMemory = await getContinuityMemory(input);
  const candidate = deriveSceneState(input);
  const driftAlerts = detectContinuityDrift({
    previousState: previousMemory.state,
    nextCandidate: candidate,
    lockedFields: previousMemory.lockedFields,
    sceneExecutionId: input.sceneExecutionId,
    sceneId: input.shot.id,
    clipOrder: input.clipOrder,
  });
  const nextState = mergeSceneState({
    previousState: previousMemory.state,
    nextCandidate: candidate,
    lockedFields: previousMemory.lockedFields,
  });
  const continuityConfidence = confidenceScore({
    previousMemory,
    driftAlerts,
    nextState,
  });
  const summary: SceneMemorySummary = {
    sceneExecutionId: input.sceneExecutionId,
    sceneId: input.shot.id,
    clipOrder: input.clipOrder,
    title: input.shot.title,
    summary: nextState.previousSceneSummary,
    capturedAt: new Date().toISOString(),
    continuityConfidence,
    driftAlerts,
  };
  const nextDriftAlerts = [...driftAlerts, ...previousMemory.driftAlerts].slice(0, 16);
  const sceneMemorySummaries = [summary, ...previousMemory.sceneMemorySummaries].slice(0, 24);

  const memory = await upsertContinuityMemory({
    ...previousMemory,
    projectId: input.projectId ?? previousMemory.projectId,
    characterId: input.characterId ?? previousMemory.characterId,
    state: nextState,
    continuityConfidence,
    driftAlerts: nextDriftAlerts,
    sceneMemorySummaries,
    previousSceneSummary: nextState.previousSceneSummary || null,
  });

  return {
    memory,
    sceneSummary: summary,
    driftAlerts,
  };
}

export function buildContinuityMemoryPrompt(memory: ContinuityMemoryRecord) {
  const populatedLines = continuityMemoryFields.flatMap((field) => {
    const value = memory.state[field];
    if (!value) return [];
    const lockLabel = memory.lockedFields[field] ? ' locked' : '';
    return [`${fieldLabels[field]}${lockLabel}: ${value}`];
  });

  if (!populatedLines.length) {
    return 'Continuity Memory: No persistent scene memory exists yet. Establish reusable cinematic details clearly.';
  }

  return [
    'Continuity Memory: Preserve these persistent cinematic details unless an unlocked detail is intentionally updated.',
    `Continuity confidence: ${Math.round(memory.continuityConfidence * 100)}%.`,
    ...populatedLines,
    memory.driftAlerts.length
      ? `Recent continuity drift to avoid: ${memory.driftAlerts.slice(0, 3).map((alert) => alert.reason).join(' ')}`
      : '',
  ].filter(Boolean).join(' ');
}
