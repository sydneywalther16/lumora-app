import { createHash } from 'node:crypto';
import { query } from './db';

export type AlternateExactLikenessProviderId = 'runway_gen4_reference' | 'kling_reference';
export type AlternateExactLikenessCanaryStatus = 'canary_succeeded' | 'canary_failed' | 'not_tested';

export type AlternateExactLikenessProviderStatus = {
  provider: AlternateExactLikenessProviderId;
  providerModel: string | null;
  status: AlternateExactLikenessCanaryStatus;
  referenceRole: string | null;
  referenceLabel: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
  providerJobCreated?: boolean | null;
  outputUrlPresent: boolean;
};

type AlternateProviderMemoryRow = {
  provider: string | null;
  providerModel: string | null;
  referenceRole: string | null;
  referenceLabel: string | null;
  successCount: number | null;
  failureCount: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: string | null;
  notes: unknown;
  metadata: unknown;
  outputUrlPresent: boolean | null;
};

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function memoryProviderId(value: string | null): AlternateExactLikenessProviderId | null {
  if (value === 'runway_gen4_reference' || value === 'runway') return 'runway_gen4_reference';
  if (value === 'kling_reference' || value === 'kling') return 'kling_reference';
  return null;
}

function safeText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerJobCreatedFromNotes(value: unknown) {
  const record = recordValue(value);
  const candidates = [
    record.providerJobCreated,
    record.providerJobCreatedPresent,
    record.providerPredictionCreated,
    record.providerPredictionCreatedPresent,
    record.providerJobIdPresent,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
  }
  return null;
}

export function normalizeAlternateProviderFailureCategory(input: {
  provider?: string | null;
  failureCategory?: string | null;
  notes?: unknown;
  metadata?: unknown;
}) {
  const provider = memoryProviderId(input.provider ?? null);
  const failureCategory = input.failureCategory ?? null;
  if (provider !== 'kling_reference') return failureCategory;
  if (failureCategory === 'kling_billing_required') return failureCategory;
  const text = `${safeText(input.failureCategory)} ${safeText(input.notes)} ${safeText(input.metadata)}`.toLowerCase();
  const billingText = text.includes('exhausted balance') ||
    text.includes('user is locked') ||
    text.includes('account locked') ||
    text.includes('top up') ||
    text.includes('billing required') ||
    text.includes('insufficient credit') ||
    text.includes('insufficient balance');
  if (!billingText) return failureCategory;
  const providerJobCreated = providerJobCreatedFromNotes(input.notes ?? input.metadata);
  return providerJobCreated === false || !text.includes('providerstatus')
    ? 'kling_billing_required'
    : failureCategory;
}

function mapRow(row: AlternateProviderMemoryRow): AlternateExactLikenessProviderStatus | null {
  const provider = memoryProviderId(row.provider);
  if (!provider) return null;
  const succeeded = (row.successCount ?? 0) > 0 && (row.successCount ?? 0) >= (row.failureCount ?? 0);
  const lastFailureCategory = normalizeAlternateProviderFailureCategory({
    provider: row.provider,
    failureCategory: row.lastFailureCategory,
    notes: row.notes,
    metadata: row.metadata,
  });
  return {
    provider,
    providerModel: row.providerModel,
    status: succeeded ? 'canary_succeeded' : 'canary_failed',
    referenceRole: row.referenceRole,
    referenceLabel: row.referenceLabel,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    lastFailureCategory,
    providerJobCreated: providerJobCreatedFromNotes(row.notes ?? row.metadata),
    outputUrlPresent: Boolean(row.outputUrlPresent),
  };
}

export function getAlternateProviderStatus(
  statuses: AlternateExactLikenessProviderStatus[] | null | undefined,
  provider: AlternateExactLikenessProviderId,
) {
  return statuses?.find((status) => status.provider === provider) ?? null;
}

export async function getAlternateExactLikenessProviderStatuses(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}) {
  try {
    const result = await query<AlternateProviderMemoryRow>(
      `select
         provider,
         provider_model as "providerModel",
         reference_strategy as "referenceRole",
         notes->>'referenceLabel' as "referenceLabel",
         success_count as "successCount",
         failure_count as "failureCount",
         last_success_at as "lastSuccessAt",
         last_failure_at as "lastFailureAt",
         last_failure_category as "lastFailureCategory",
         notes,
         metadata,
         coalesce((notes->>'outputUrlPresent')::boolean, false) as "outputUrlPresent"
       from render_success_memory
       where render_mode = 'exact_likeness_provider_canary'
         and ($1::uuid is null or user_id = $1)
         and ($2::text is null or character_id = $2)
       order by greatest(coalesce(last_success_at, '-infinity'::timestamptz), coalesce(last_failure_at, '-infinity'::timestamptz), updated_at) desc
       limit 20`,
      [
        isUuidLike(input.userId) ? input.userId : null,
        input.characterId ?? null,
      ],
    );
    return result.rows
      .map(mapRow)
      .filter((row): row is AlternateExactLikenessProviderStatus => Boolean(row));
  } catch {
    return [];
  }
}

export async function repairKlingBillingCanaryMemory(input: {
  userId?: string | null;
  characterId?: string | null;
} = {}) {
  const scanned = await getAlternateExactLikenessProviderStatuses(input);
  try {
    const result = await query<{ memoryKey: string; lastFailureCategory: string | null; notes: unknown; metadata: unknown }>(
      `select
         memory_key as "memoryKey",
         last_failure_category as "lastFailureCategory",
         notes,
         metadata
       from render_success_memory
       where render_mode = 'exact_likeness_provider_canary'
         and provider in ('kling_reference', 'kling')
         and ($1::uuid is null or user_id = $1)
         and ($2::text is null or character_id = $2)`,
      [
        isUuidLike(input.userId) ? input.userId : null,
        input.characterId ?? null,
      ],
    );
    const repairable = result.rows.filter((row) => (
      normalizeAlternateProviderFailureCategory({
        provider: 'kling_reference',
        failureCategory: row.lastFailureCategory,
        notes: row.notes,
        metadata: row.metadata,
      }) === 'kling_billing_required' && row.lastFailureCategory !== 'kling_billing_required'
    ));
    for (const row of repairable) {
      await query(
        `update render_success_memory
         set
           last_failure_category = 'kling_billing_required',
           notes = jsonb_set(
             coalesce(notes, '{}'::jsonb),
             '{repair}',
             jsonb_build_object(
               'repairedAt', now(),
               'fromFailureCategory', $2::text,
               'toFailureCategory', 'kling_billing_required',
               'reason', 'billing_or_locked_error_without_provider_job'
             ),
             true
           ),
           metadata = jsonb_set(
             coalesce(metadata, '{}'::jsonb),
             '{repair}',
             jsonb_build_object(
               'repairedAt', now(),
               'fromFailureCategory', $2::text,
               'toFailureCategory', 'kling_billing_required',
               'reason', 'billing_or_locked_error_without_provider_job'
             ),
             true
           ),
           updated_at = now()
         where memory_key = $1`,
        [row.memoryKey, row.lastFailureCategory],
      );
    }
    return {
      ok: true,
      scannedCount: result.rows.length,
      repairedCount: repairable.length,
      inferredBillingFailuresBeforeRepair: scanned.filter((status) => status.lastFailureCategory === 'kling_billing_required').length,
      failureCategory: repairable.length ? 'kling_billing_required' : null,
      providerCallsMade: false,
      recommendedNextAction: repairable.length
        ? 'Kling billing failures were repaired. Rerun fal account diagnostics, then rerun Kling canary when ready.'
        : 'No stale Kling billing failures needed repair.',
    };
  } catch (error) {
    return {
      ok: false,
      scannedCount: 0,
      repairedCount: 0,
      providerCallsMade: false,
      error: error instanceof Error ? error.message : String(error),
      recommendedNextAction: 'Apply render_success_memory migrations, then retry the repair diagnostic.',
    };
  }
}

export async function persistAlternateExactLikenessCanaryResult(input: {
  userId?: string | null;
  characterId?: string | null;
  provider: AlternateExactLikenessProviderId;
  providerModel?: string | null;
  referenceRole?: string | null;
  referenceLabel?: string | null;
  succeeded: boolean;
  failureCategory?: string | null;
  providerErrorCategory?: string | null;
  outputUrlPresent?: boolean | null;
  notes?: Record<string, unknown>;
}) {
  if (!isUuidLike(input.userId)) return;
  const characterId = input.characterId ?? 'creator-self';
  const referenceRole = input.referenceRole ?? 'unknown_reference';
  const memoryKey = `exact-likeness-provider:${input.userId}:${characterId}:${input.provider}:${referenceRole}`;
  const now = new Date().toISOString();
  const notes = {
    provider: input.provider,
    referenceRole,
    referenceLabel: input.referenceLabel ?? null,
    succeeded: input.succeeded,
    failureCategory: input.failureCategory ?? null,
    providerErrorCategory: input.providerErrorCategory ?? null,
    outputUrlPresent: Boolean(input.outputUrlPresent),
    ...(input.notes ?? {}),
  };

  try {
    await query(
      `insert into render_success_memory (
         memory_key,
         user_id,
         character_id,
         provider,
         provider_model,
         render_mode,
         render_feel,
         reference_strategy,
         reference_count,
         prompt_fingerprint,
         success_count,
         failure_count,
         last_success_at,
         last_failure_at,
         last_failure_category,
         notes,
         metadata,
         created_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, 'exact_likeness_provider_canary', 'likeness_route', $6, 1, $7, $8, $9, $10, $11, $12, $13::jsonb, $13::jsonb, now(), now())
       on conflict (memory_key)
       do update set
         provider_model = excluded.provider_model,
         reference_strategy = excluded.reference_strategy,
         reference_count = excluded.reference_count,
         success_count = excluded.success_count,
         failure_count = excluded.failure_count,
         last_success_at = excluded.last_success_at,
         last_failure_at = excluded.last_failure_at,
         last_failure_category = excluded.last_failure_category,
         notes = excluded.notes,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        memoryKey,
        input.userId,
        characterId,
        input.provider,
        input.providerModel ?? null,
        referenceRole,
        fingerprint(memoryKey),
        input.succeeded ? 1 : 0,
        input.succeeded ? 0 : 1,
        input.succeeded ? now : null,
        input.succeeded ? null : now,
        input.failureCategory ?? null,
        JSON.stringify(notes),
      ],
    );
  } catch (error) {
    console.warn('EXACT LIKENESS PROVIDER MEMORY PERSISTENCE SKIPPED:', {
      provider: input.provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
