import { randomUUID } from 'node:crypto';
import { query } from './db';
import {
  getContinuityMemory,
  saveContinuityMemoryPatch,
  type ContinuityDriftAlert,
  type ContinuityMemoryRecord,
  type ContinuityMemoryState,
  type SceneMemorySummary,
} from './memoryEngine';

export type CharacterStatus = 'draft' | 'processing' | 'ready' | 'failed';
export type CharacterVisibility = 'private' | 'approved_only' | 'public';

export type CharacterReferenceImageUrls = {
  manualReferenceImageUrl?: string | null;
  frontFace: string;
  frontFaceUrl?: string | null;
  frontFacePath?: string | null;
  leftAngle: string;
  leftAngleUrl?: string | null;
  leftAnglePath?: string | null;
  rightAngle: string;
  rightAngleUrl?: string | null;
  rightAnglePath?: string | null;
  fullBody?: string | null;
  fullBodyUrl?: string | null;
  fullBodyPath?: string | null;
  expressive?: string | null;
  expressiveUrl?: string | null;
  expressivePath?: string | null;
};

export type CharacterRelationshipMemory = {
  targetCharacterId?: string | null;
  targetDisplayName?: string | null;
  relationshipSummary: string;
  emotionalDynamic?: string | null;
  lastSceneSummary?: string | null;
  updatedAt: string;
};

export type CharacterMemorySnapshot = {
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
  summary: string;
  continuityState: Partial<ContinuityMemoryState>;
  continuityConfidence: number;
  capturedAt: string;
};

export type CharacterAppearanceDrift = {
  field: 'appearanceSummary';
  expected: string;
  observed: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  detectedAt: string;
  sceneExecutionId?: string | null;
  sceneId?: string | null;
  clipOrder?: number | null;
};

export type CharacterProfile = {
  id: string;
  characterId: string;
  ownerUserId: string;
  name: string;
  displayName: string;
  status: CharacterStatus;
  consentConfirmed: boolean;
  visibility: CharacterVisibility;
  stylePreferences: Record<string, unknown>;
  referenceImageUrls: CharacterReferenceImageUrls;
  referenceImages: Record<string, unknown>;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
  appearanceSummary: string;
  wardrobeTendencies: string;
  emotionalTendencies: string;
  soundtrackTendencies: string;
  cinematicStyle: string;
  continuityState: Partial<ContinuityMemoryState>;
  memorySnapshots: CharacterMemorySnapshot[];
  relationshipMemory: Record<string, CharacterRelationshipMemory>;
  appearanceDrift: CharacterAppearanceDrift[];
  createdAt: string;
  updatedAt: string;
};

type CharacterProfileRow = {
  id: string;
  characterId: string | null;
  ownerUserId: string;
  name: string;
  displayName: string | null;
  status: CharacterStatus;
  consentConfirmed: boolean;
  visibility: CharacterVisibility;
  stylePreferences: Record<string, unknown> | null;
  referenceImageUrls: CharacterReferenceImageUrls | null;
  referenceImages: Record<string, unknown> | null;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
  appearanceSummary: string | null;
  wardrobeTendencies: string | null;
  emotionalTendencies: string | null;
  soundtrackTendencies: string | null;
  cinematicStyle: string | null;
  continuityState: Record<string, unknown> | null;
  memorySnapshots: unknown;
  relationshipMemory: unknown;
  appearanceDrift: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CharacterProfilePatch = Partial<{
  name: string;
  displayName: string;
  status: CharacterStatus;
  visibility: CharacterVisibility;
  consentConfirmed: boolean;
  stylePreferences: Record<string, unknown>;
  referenceImageUrls: CharacterReferenceImageUrls;
  referenceImages: Record<string, unknown>;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
  appearanceSummary: string;
  wardrobeTendencies: string;
  emotionalTendencies: string;
  soundtrackTendencies: string;
  cinematicStyle: string;
  continuityState: Partial<ContinuityMemoryState>;
  memorySnapshots: CharacterMemorySnapshot[];
  relationshipMemory: Record<string, CharacterRelationshipMemory>;
  appearanceDrift: CharacterAppearanceDrift[];
}>;

export type DeleteCharacterProfileResult = {
  character: CharacterProfile;
  deletedCharacterProfiles: number;
  deletedContinuityMemory: number;
  deletedModerationMemory: number;
  preservedGenerationReferences: number;
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

const characterSelect = `
  id,
  character_id as "characterId",
  owner_user_id as "ownerUserId",
  name,
  display_name as "displayName",
  status,
  consent_confirmed as "consentConfirmed",
  visibility,
  style_preferences as "stylePreferences",
  reference_image_urls as "referenceImageUrls",
  reference_images as "referenceImages",
  source_capture_video_url as "sourceCaptureVideoUrl",
  voice_sample_url as "voiceSampleUrl",
  appearance_summary as "appearanceSummary",
  wardrobe_tendencies as "wardrobeTendencies",
  emotional_tendencies as "emotionalTendencies",
  soundtrack_tendencies as "soundtrackTendencies",
  cinematic_style as "cinematicStyle",
  continuity_state as "continuityState",
  memory_snapshots as "memorySnapshots",
  relationship_memory as "relationshipMemory",
  appearance_drift as "appearanceDrift",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeReferenceImages(value: unknown): CharacterReferenceImageUrls {
  const record = recordValue(value);

  return {
    manualReferenceImageUrl: textValue(record.manualReferenceImageUrl) || null,
    frontFace: textValue(record.frontFace),
    frontFaceUrl: textValue(record.frontFaceUrl) || null,
    frontFacePath: textValue(record.frontFacePath) || null,
    leftAngle: textValue(record.leftAngle),
    leftAngleUrl: textValue(record.leftAngleUrl) || null,
    leftAnglePath: textValue(record.leftAnglePath) || null,
    rightAngle: textValue(record.rightAngle),
    rightAngleUrl: textValue(record.rightAngleUrl) || null,
    rightAnglePath: textValue(record.rightAnglePath) || null,
    fullBody: textValue(record.fullBody) || null,
    fullBodyUrl: textValue(record.fullBodyUrl) || null,
    fullBodyPath: textValue(record.fullBodyPath) || null,
    expressive: textValue(record.expressive) || null,
    expressiveUrl: textValue(record.expressiveUrl) || null,
    expressivePath: textValue(record.expressivePath) || null,
  };
}

function normalizeContinuityState(value: unknown): Partial<ContinuityMemoryState> {
  const record = recordValue(value);
  return Object.fromEntries(
    Object.entries(emptyContinuityState)
      .map(([field]) => [field, textValue(record[field])])
      .filter(([, entry]) => entry),
  ) as Partial<ContinuityMemoryState>;
}

function normalizeMemorySnapshots(value: unknown): CharacterMemorySnapshot[] {
  return Array.isArray(value)
    ? value.filter((item): item is CharacterMemorySnapshot => Boolean(item) && typeof item === 'object')
    : [];
}

function normalizeRelationshipMemory(value: unknown): Record<string, CharacterRelationshipMemory> {
  return recordValue(value) as Record<string, CharacterRelationshipMemory>;
}

function normalizeAppearanceDrift(value: unknown): CharacterAppearanceDrift[] {
  return Array.isArray(value)
    ? value.filter((item): item is CharacterAppearanceDrift => Boolean(item) && typeof item === 'object')
    : [];
}

function rowToCharacterProfile(row: CharacterProfileRow): CharacterProfile {
  const stylePreferences = recordValue(row.stylePreferences);
  const referenceImageUrls = normalizeReferenceImages(row.referenceImageUrls);
  const appearanceSummary = textValue(row.appearanceSummary) || textValue(stylePreferences.appearanceSummary);
  const displayName = textValue(row.displayName) || row.name;

  return {
    id: row.id,
    characterId: textValue(row.characterId) || row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    displayName,
    status: row.status,
    consentConfirmed: row.consentConfirmed,
    visibility: row.visibility,
    stylePreferences,
    referenceImageUrls,
    referenceImages: recordValue(row.referenceImages),
    sourceCaptureVideoUrl: row.sourceCaptureVideoUrl,
    voiceSampleUrl: row.voiceSampleUrl,
    appearanceSummary,
    wardrobeTendencies: textValue(row.wardrobeTendencies) || textValue(stylePreferences.fashionStyle),
    emotionalTendencies: textValue(row.emotionalTendencies) || textValue(stylePreferences.characterVibe),
    soundtrackTendencies: textValue(row.soundtrackTendencies) || textValue(stylePreferences.soundtrackTendencies),
    cinematicStyle: textValue(row.cinematicStyle) || textValue(stylePreferences.cinematicStyle),
    continuityState: normalizeContinuityState(row.continuityState),
    memorySnapshots: normalizeMemorySnapshots(row.memorySnapshots),
    relationshipMemory: normalizeRelationshipMemory(row.relationshipMemory),
    appearanceDrift: normalizeAppearanceDrift(row.appearanceDrift),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function optionalCleanupSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes('42p01') ||
    lower.includes('42703') ||
    lower.includes('continuity_memory_states') ||
    lower.includes('moderation_orchestration_memory') ||
    lower.includes('generation_jobs')
  );
}

function characterProfileIdentifiers(profile: CharacterProfile, requestedCharacterId: string) {
  return Array.from(new Set([
    requestedCharacterId,
    profile.id,
    profile.characterId,
  ].filter((value): value is string => Boolean(value && value.trim()))));
}

function isSelfCharacterProfile(profile: CharacterProfile) {
  return profile.id === 'creator-self' || profile.characterId === 'creator-self';
}

async function safeCountGenerationReferences(input: {
  ownerUserId: string;
  characterIds: string[];
}) {
  try {
    const result = await query<{ count: number }>(
      `select count(*)::int
       from generation_jobs
       where user_id = $1
         and character_id = any($2::text[])`,
      [input.ownerUserId, input.characterIds],
    );
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    if (optionalCleanupSchemaError(error)) return 0;
    throw error;
  }
}

async function safeDeleteContinuityMemory(input: {
  ownerUserId: string;
  characterIds: string[];
}) {
  try {
    const memoryScopes = input.characterIds.map((id) => `character:${id}`);
    const result = await query<{ count: number }>(
      `with deleted as (
         delete from continuity_memory_states
         where user_id = $1
           and (
             character_id = any($2::text[])
             or memory_scope = any($3::text[])
           )
         returning 1
       )
       select count(*)::int from deleted`,
      [input.ownerUserId, input.characterIds, memoryScopes],
    );
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    if (optionalCleanupSchemaError(error)) return 0;
    throw error;
  }
}

async function safeDeleteModerationMemory(input: {
  ownerUserId: string;
  characterIds: string[];
}) {
  try {
    const result = await query<{ count: number }>(
      `with deleted as (
         delete from moderation_orchestration_memory
         where user_id = $1
           and character_id = any($2::text[])
         returning 1
       )
       select count(*)::int from deleted`,
      [input.ownerUserId, input.characterIds],
    );
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    if (optionalCleanupSchemaError(error)) return 0;
    throw error;
  }
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
  return leftTokens.filter((token) => rightSet.has(token)).length / Math.max(leftTokens.length, rightTokens.length);
}

function continuitySeed(profile: Pick<
  CharacterProfile,
  'appearanceSummary' | 'wardrobeTendencies' | 'emotionalTendencies' | 'soundtrackTendencies' | 'cinematicStyle'
>): Partial<ContinuityMemoryState> {
  return {
    characterAppearance: profile.appearanceSummary,
    wardrobe: profile.wardrobeTendencies,
    emotionalTone: profile.emotionalTendencies,
    soundtrackMood: profile.soundtrackTendencies,
    cameraStyle: profile.cinematicStyle,
  };
}

function characterPromptLines(profile: Pick<
  CharacterProfile,
  'displayName' | 'appearanceSummary' | 'wardrobeTendencies' | 'emotionalTendencies' | 'soundtrackTendencies' | 'cinematicStyle' | 'relationshipMemory'
>) {
  const relationships = Object.values(profile.relationshipMemory ?? {})
    .map((memory) => memory.relationshipSummary)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');

  return [
    `Character: ${profile.displayName}.`,
    profile.appearanceSummary ? `Appearance: ${profile.appearanceSummary}.` : '',
    profile.wardrobeTendencies ? `Wardrobe tendencies: ${profile.wardrobeTendencies}.` : '',
    profile.emotionalTendencies ? `Emotional tendencies: ${profile.emotionalTendencies}.` : '',
    profile.soundtrackTendencies ? `Soundtrack tendencies: ${profile.soundtrackTendencies}.` : '',
    profile.cinematicStyle ? `Cinematic style: ${profile.cinematicStyle}.` : '',
    relationships ? `Relationship memory: ${relationships}` : '',
  ].filter(Boolean);
}

export function buildCharacterProfilePrompt(profile: CharacterProfile | null | undefined) {
  if (!profile) return '';
  return [
    'Character Profile: Preserve this reusable cinematic cast member across shots.',
    ...characterPromptLines(profile),
  ].join(' ');
}

export function characterProfileFromMetadata(
  metadata?: Record<string, unknown> | null,
  characterId?: string | null,
): CharacterProfile | null {
  const record = recordValue(metadata);
  const nested = recordValue(record.characterProfile);
  const source = Object.keys(nested).length ? nested : record;
  const displayName = textValue(source.displayName) || textValue(source.characterName);
  const appearanceSummary =
    textValue(source.appearanceSummary) ||
    textValue(source.identityAppearanceSummary) ||
    textValue(source.characterDescription);

  if (!displayName && !appearanceSummary && !characterId) return null;

  const now = new Date().toISOString();
  return {
    id: textValue(source.id) || characterId || 'metadata-character',
    characterId: textValue(source.characterId) || characterId || textValue(source.id) || 'metadata-character',
    ownerUserId: textValue(source.ownerUserId) || textValue(record.userId) || 'metadata',
    name: displayName || 'Selected character',
    displayName: displayName || 'Selected character',
    status: 'ready',
    consentConfirmed: true,
    visibility: 'private',
    stylePreferences: recordValue(source.stylePreferences),
    referenceImageUrls: normalizeReferenceImages(source.referenceImageUrls),
    referenceImages: recordValue(source.referenceImages),
    sourceCaptureVideoUrl: null,
    voiceSampleUrl: null,
    appearanceSummary,
    wardrobeTendencies: textValue(source.wardrobeTendencies) || textValue(source.fashionStyle),
    emotionalTendencies: textValue(source.emotionalTendencies) || textValue(source.characterVibe),
    soundtrackTendencies: textValue(source.soundtrackTendencies),
    cinematicStyle: textValue(source.cinematicStyle),
    continuityState: normalizeContinuityState(source.continuityState),
    memorySnapshots: normalizeMemorySnapshots(source.memorySnapshots),
    relationshipMemory: normalizeRelationshipMemory(source.relationshipMemory),
    appearanceDrift: normalizeAppearanceDrift(source.appearanceDrift),
    createdAt: now,
    updatedAt: now,
  };
}

export async function createCharacterProfile(input: {
  ownerUserId: string;
  characterId?: string | null;
  name: string;
  displayName?: string | null;
  consentConfirmed: boolean;
  visibility: CharacterVisibility;
  stylePreferences: Record<string, unknown>;
  referenceImageUrls: CharacterReferenceImageUrls;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl?: string | null;
  status?: CharacterStatus;
  appearanceSummary?: string | null;
  wardrobeTendencies?: string | null;
  emotionalTendencies?: string | null;
  soundtrackTendencies?: string | null;
  cinematicStyle?: string | null;
  relationshipMemory?: Record<string, CharacterRelationshipMemory> | null;
}) {
  const displayName = input.displayName?.trim() || input.name;
  const characterId = input.characterId?.trim() || randomUUID();
  const continuityState = normalizeContinuityState({
    characterAppearance: input.appearanceSummary,
    wardrobe: input.wardrobeTendencies,
    emotionalTone: input.emotionalTendencies,
    soundtrackMood: input.soundtrackTendencies,
    cameraStyle: input.cinematicStyle,
  });
  const referenceImages = input.referenceImageUrls;

  const result = await query<CharacterProfileRow>(
    `insert into character_profiles (
       character_id,
       owner_user_id,
       name,
       display_name,
       status,
       consent_confirmed,
       visibility,
       style_preferences,
       reference_image_urls,
       reference_images,
       source_capture_video_url,
       voice_sample_url,
       appearance_summary,
       wardrobe_tendencies,
       emotional_tendencies,
       soundtrack_tendencies,
       cinematic_style,
       continuity_state,
       relationship_memory
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb)
     returning ${characterSelect}`,
    [
      characterId,
      input.ownerUserId,
      input.name,
      displayName,
      input.status ?? 'ready',
      input.consentConfirmed,
      input.visibility,
      JSON.stringify(input.stylePreferences),
      JSON.stringify(input.referenceImageUrls),
      JSON.stringify(referenceImages),
      input.sourceCaptureVideoUrl,
      input.voiceSampleUrl ?? null,
      input.appearanceSummary ?? '',
      input.wardrobeTendencies ?? '',
      input.emotionalTendencies ?? '',
      input.soundtrackTendencies ?? '',
      input.cinematicStyle ?? '',
      JSON.stringify(continuityState),
      JSON.stringify(input.relationshipMemory ?? {}),
    ],
  );

  return rowToCharacterProfile(result.rows[0]);
}

export async function listCharacterProfilesForUser(ownerUserId: string) {
  const result = await query<CharacterProfileRow>(
    `select ${characterSelect}
     from character_profiles
     where owner_user_id = $1
     order by updated_at desc
     limit 50`,
    [ownerUserId],
  );

  return result.rows.map(rowToCharacterProfile);
}

export async function getCharacterProfileForUser(ownerUserId: string, characterId: string) {
  const result = await query<CharacterProfileRow>(
    `select ${characterSelect}
     from character_profiles
     where owner_user_id = $1
       and (id::text = $2 or character_id = $2)
     limit 1`,
    [ownerUserId, characterId],
  );

  return result.rows[0] ? rowToCharacterProfile(result.rows[0]) : null;
}

export const getCinematicCharacterProfileForUser = getCharacterProfileForUser;

export async function updateCharacterProfileForUser(input: {
  ownerUserId: string;
  characterId: string;
} & CharacterProfilePatch) {
  const current = await getCharacterProfileForUser(input.ownerUserId, input.characterId);
  if (!current) return null;

  const next: CharacterProfile = {
    ...current,
    name: input.name ?? current.name,
    displayName: input.displayName ?? input.name ?? current.displayName,
    status: input.status ?? current.status,
    visibility: input.visibility ?? current.visibility,
    consentConfirmed: input.consentConfirmed ?? current.consentConfirmed,
    stylePreferences: input.stylePreferences ?? current.stylePreferences,
    referenceImageUrls: input.referenceImageUrls ?? current.referenceImageUrls,
    referenceImages: input.referenceImages ?? current.referenceImages,
    sourceCaptureVideoUrl:
      input.sourceCaptureVideoUrl === undefined ? current.sourceCaptureVideoUrl : input.sourceCaptureVideoUrl,
    voiceSampleUrl: input.voiceSampleUrl === undefined ? current.voiceSampleUrl : input.voiceSampleUrl,
    appearanceSummary: input.appearanceSummary ?? current.appearanceSummary,
    wardrobeTendencies: input.wardrobeTendencies ?? current.wardrobeTendencies,
    emotionalTendencies: input.emotionalTendencies ?? current.emotionalTendencies,
    soundtrackTendencies: input.soundtrackTendencies ?? current.soundtrackTendencies,
    cinematicStyle: input.cinematicStyle ?? current.cinematicStyle,
    continuityState: input.continuityState ?? current.continuityState,
    memorySnapshots: input.memorySnapshots ?? current.memorySnapshots,
    relationshipMemory: input.relationshipMemory ?? current.relationshipMemory,
    appearanceDrift: input.appearanceDrift ?? current.appearanceDrift,
  };

  const result = await query<CharacterProfileRow>(
    `update character_profiles
     set
       name = $3,
       display_name = $4,
       status = $5,
       consent_confirmed = $6,
       visibility = $7,
       style_preferences = $8::jsonb,
       reference_image_urls = $9::jsonb,
       reference_images = $10::jsonb,
       source_capture_video_url = $11,
       voice_sample_url = $12,
       appearance_summary = $13,
       wardrobe_tendencies = $14,
       emotional_tendencies = $15,
       soundtrack_tendencies = $16,
       cinematic_style = $17,
       continuity_state = $18::jsonb,
       memory_snapshots = $19::jsonb,
       relationship_memory = $20::jsonb,
       appearance_drift = $21::jsonb,
       updated_at = now()
     where owner_user_id = $1 and (id::text = $2 or character_id = $2)
     returning ${characterSelect}`,
    [
      input.ownerUserId,
      input.characterId,
      next.name,
      next.displayName,
      next.status,
      next.consentConfirmed,
      next.visibility,
      JSON.stringify(next.stylePreferences),
      JSON.stringify(next.referenceImageUrls),
      JSON.stringify(next.referenceImages),
      next.sourceCaptureVideoUrl,
      next.voiceSampleUrl,
      next.appearanceSummary,
      next.wardrobeTendencies,
      next.emotionalTendencies,
      next.soundtrackTendencies,
      next.cinematicStyle,
      JSON.stringify(next.continuityState),
      JSON.stringify(next.memorySnapshots),
      JSON.stringify(next.relationshipMemory),
      JSON.stringify(next.appearanceDrift),
    ],
  );

  return result.rows[0] ? rowToCharacterProfile(result.rows[0]) : null;
}

export async function deleteCharacterProfileForUser(input: {
  ownerUserId: string;
  characterId: string;
}): Promise<DeleteCharacterProfileResult | null> {
  const current = await getCharacterProfileForUser(input.ownerUserId, input.characterId);
  if (!current) return null;

  if (isSelfCharacterProfile(current)) {
    throw Object.assign(new Error('Self character cannot be deleted in v1.'), {
      statusCode: 409,
      code: 'SELF_CHARACTER_DELETE_DISABLED',
    });
  }

  const characterIds = characterProfileIdentifiers(current, input.characterId);
  const preservedGenerationReferences = await safeCountGenerationReferences({
    ownerUserId: input.ownerUserId,
    characterIds,
  });
  const deletedContinuityMemory = await safeDeleteContinuityMemory({
    ownerUserId: input.ownerUserId,
    characterIds,
  });
  const deletedModerationMemory = await safeDeleteModerationMemory({
    ownerUserId: input.ownerUserId,
    characterIds,
  });
  const result = await query<{ count: number }>(
    `with deleted as (
       delete from character_profiles
       where owner_user_id = $1
         and (id::text = $2 or character_id = $2)
       returning 1
     )
     select count(*)::int from deleted`,
    [input.ownerUserId, input.characterId],
  );

  return {
    character: current,
    deletedCharacterProfiles: result.rows[0]?.count ?? 0,
    deletedContinuityMemory,
    deletedModerationMemory,
    preservedGenerationReferences,
  };
}

export async function inheritCharacterContinuity(input: {
  userId: string;
  projectId?: string | null;
  profile: CharacterProfile | null;
}) {
  if (!input.profile) {
    return getContinuityMemory({ userId: input.userId, projectId: input.projectId ?? null });
  }

  const existing = await getContinuityMemory({
    userId: input.userId,
    projectId: input.projectId ?? null,
    characterId: input.profile.characterId,
  });
  const seed = {
    ...continuitySeed(input.profile),
    ...input.profile.continuityState,
  };
  const inherited = Object.fromEntries(
    Object.entries(seed).filter(([field, value]) => {
      const key = field as keyof ContinuityMemoryState;
      return value && !existing.state[key];
    }),
  ) as Partial<ContinuityMemoryState>;

  if (!Object.keys(inherited).length) return existing;

  return saveContinuityMemoryPatch({
    userId: input.userId,
    projectId: input.projectId ?? null,
    characterId: input.profile.characterId,
    state: inherited,
  });
}

export async function updateCharacterProfileFromMemory(input: {
  ownerUserId: string;
  characterId: string;
  memory: ContinuityMemoryRecord;
  sceneSummary: SceneMemorySummary;
  driftAlerts?: ContinuityDriftAlert[];
}) {
  const current = await getCharacterProfileForUser(input.ownerUserId, input.characterId);
  if (!current) return null;

  const observedAppearance = input.memory.state.characterAppearance;
  const appearanceDrift = [...current.appearanceDrift];

  if (
    current.appearanceSummary &&
    observedAppearance &&
    tokenSimilarity(current.appearanceSummary, observedAppearance) < 0.28
  ) {
    appearanceDrift.unshift({
      field: 'appearanceSummary',
      expected: current.appearanceSummary,
      observed: observedAppearance,
      severity: input.driftAlerts?.some((alert) => alert.severity === 'high') ? 'high' : 'medium',
      reason: 'Character appearance moved away from the stored cast profile.',
      detectedAt: new Date().toISOString(),
      sceneExecutionId: input.sceneSummary.sceneExecutionId,
      sceneId: input.sceneSummary.sceneId,
      clipOrder: input.sceneSummary.clipOrder,
    });
  }

  const snapshot: CharacterMemorySnapshot = {
    sceneExecutionId: input.sceneSummary.sceneExecutionId,
    sceneId: input.sceneSummary.sceneId,
    clipOrder: input.sceneSummary.clipOrder,
    summary: input.sceneSummary.summary,
    continuityState: input.memory.state,
    continuityConfidence: input.memory.continuityConfidence,
    capturedAt: input.sceneSummary.capturedAt,
  };

  return updateCharacterProfileForUser({
    ownerUserId: input.ownerUserId,
    characterId: input.characterId,
    continuityState: input.memory.state,
    memorySnapshots: [snapshot, ...current.memorySnapshots].slice(0, 24),
    appearanceDrift: appearanceDrift.slice(0, 16),
  });
}

export function publicCharacterProfile(profile: CharacterProfile | null) {
  if (!profile) return null;

  return {
    id: profile.id,
    characterId: profile.characterId,
    displayName: profile.displayName,
    appearanceSummary: profile.appearanceSummary,
    wardrobeTendencies: profile.wardrobeTendencies,
    emotionalTendencies: profile.emotionalTendencies,
    soundtrackTendencies: profile.soundtrackTendencies,
    cinematicStyle: profile.cinematicStyle,
    continuityState: profile.continuityState,
    relationshipMemory: profile.relationshipMemory,
    memorySnapshots: profile.memorySnapshots.slice(0, 6),
    appearanceDrift: profile.appearanceDrift.slice(0, 6),
  };
}
