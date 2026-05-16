import {
  getCharacterProfileForUser,
  updateCharacterProfileForUser,
  type CharacterReferenceImageUrls,
} from './characterProfiles';
import { query } from './db';
import { serializeDiagnosticError } from './schemaDiagnostics';

const protectedHosts = [
  'fbcdn.net',
  'facebook.com',
  'instagram.com',
  'cdninstagram.com',
  'threads.net',
];

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function hostForUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isProtectedHost(host: string) {
  return protectedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function isLumoraSavedUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/storage/v1/object/public/');
  } catch {
    return false;
  }
}

function hasTemporarySignature(url: string) {
  try {
    const parsed = new URL(url);
    return ['signature', 'sig', 'token', 'expires', 'expires_at', 'exp', 'se'].some((key) =>
      parsed.searchParams.has(key) || parsed.searchParams.has(key.toUpperCase()),
    ) || Array.from(parsed.searchParams.keys()).some((key) => key.toLowerCase().startsWith('x-amz-'));
  } catch {
    return false;
  }
}

function isManualReferenceKey(key: string) {
  return key.toLowerCase().includes('manual');
}

function isObsoleteExternalManualReference(key: string, url: string) {
  return isManualReferenceKey(key) && Boolean(url) && !isLumoraSavedUrl(url);
}

export function cleanupReferenceImageUrls(
  referenceImageUrls: CharacterReferenceImageUrls,
): {
  referenceImageUrls: CharacterReferenceImageUrls;
  removedCount: number;
} {
  const manualReferenceImageUrl = stringValue(referenceImageUrls.manualReferenceImageUrl);

  if (!manualReferenceImageUrl || isLumoraSavedUrl(manualReferenceImageUrl)) {
    return {
      referenceImageUrls,
      removedCount: 0,
    };
  }

  return {
    referenceImageUrls: {
      ...referenceImageUrls,
      manualReferenceImageUrl: null,
    },
    removedCount: 1,
  };
}

export async function cleanupObsoleteCharacterReferencesForUser(input: {
  ownerUserId: string;
  characterId: string;
}) {
  const character = await getCharacterProfileForUser(input.ownerUserId, input.characterId);
  if (!character) return null;

  const cleanup = cleanupReferenceImageUrls(character.referenceImageUrls);
  if (cleanup.removedCount === 0) {
    return {
      character,
      removedCount: 0,
      remainingReferences: character.referenceImageUrls,
    };
  }

  const updated = await updateCharacterProfileForUser({
    ownerUserId: input.ownerUserId,
    characterId: input.characterId,
    referenceImageUrls: cleanup.referenceImageUrls,
  });

  return {
    character: updated ?? character,
    removedCount: cleanup.removedCount,
    remainingReferences: cleanup.referenceImageUrls,
  };
}

type ReferenceRow = {
  source: string;
  references: unknown;
};

async function loadReferenceRows() {
  const sources = [
    {
      source: 'character_profiles.reference_image_urls',
      sql: 'select reference_image_urls as references from character_profiles where reference_image_urls is not null limit 1000',
    },
    {
      source: 'characters.reference_image_urls',
      sql: 'select reference_image_urls as references from characters where reference_image_urls is not null limit 1000',
    },
    {
      source: 'self_characters.reference_image_urls',
      sql: 'select reference_image_urls as references from self_characters where reference_image_urls is not null limit 1000',
    },
    {
      source: 'profiles.self_reference_image_urls',
      sql: 'select self_reference_image_urls as references from profiles where self_reference_image_urls is not null limit 1000',
    },
  ];
  const rows: ReferenceRow[] = [];
  const scanned: string[] = [];

  for (const source of sources) {
    try {
      const result = await query<{ references: unknown }>(source.sql);
      rows.push(...result.rows.map((row) => ({
        source: source.source,
        references: row.references,
      })));
      scanned.push(source.source);
    } catch {
      // Some deployments still have legacy subsets of the cast schema. Diagnostics stay best-effort.
    }
  }

  return { rows, scanned };
}

function scanReferenceRows(rows: ReferenceRow[]) {
  const failedReferenceLabels = new Map<string, number>();
  let obsoleteExternalReferenceCount = 0;
  let manualReferenceOverrideCount = 0;
  let protectedReferenceCount = 0;
  let savedLumoraReferenceCount = 0;

  for (const row of rows) {
    const references = recordValue(row.references);
    for (const [key, value] of Object.entries(references)) {
      const url = stringValue(value);
      if (!url) continue;

      if (isLumoraSavedUrl(url)) {
        savedLumoraReferenceCount += 1;
      }

      if (isManualReferenceKey(key)) {
        manualReferenceOverrideCount += 1;
        if (isObsoleteExternalManualReference(key, url)) {
          obsoleteExternalReferenceCount += 1;
          failedReferenceLabels.set('Manual reference override', (failedReferenceLabels.get('Manual reference override') ?? 0) + 1);
        }
      }

      const host = hostForUrl(url);
      if (isProtectedHost(host) || hasTemporarySignature(url)) {
        protectedReferenceCount += 1;
        failedReferenceLabels.set(key, (failedReferenceLabels.get(key) ?? 0) + 1);
      }
    }
  }

  return {
    obsoleteExternalReferenceCount,
    manualReferenceOverrideCount,
    protectedReferenceCount,
    savedLumoraReferenceCount,
    failedReferenceLabels: Array.from(failedReferenceLabels.entries()).map(([label, count]) => ({ label, count })),
  };
}

export async function buildReferenceCleanupDiagnostics() {
  try {
    const { rows, scanned } = await loadReferenceRows();
    const counts = scanReferenceRows(rows);

    return {
      ok: true,
      ...counts,
      repairableFailures: counts.obsoleteExternalReferenceCount,
      sourcesScanned: scanned,
      warning: counts.obsoleteExternalReferenceCount > 0
        ? 'Obsolete temporary reference URLs still exist. Use reference cleanup or remove them from Characters.'
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      obsoleteExternalReferenceCount: 0,
      manualReferenceOverrideCount: 0,
      protectedReferenceCount: 0,
      savedLumoraReferenceCount: 0,
      repairableFailures: 0,
      sourcesScanned: [],
      failedReferenceLabels: [],
      warning: null,
      error: serializeDiagnosticError(error),
    };
  }
}
