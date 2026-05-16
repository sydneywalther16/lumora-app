import type {
  AssetPersistenceFailureDiagnostics,
  CharacterProfile,
  ReferenceImageUrls,
  SeedanceReferenceImage,
} from './api';
import { resolveRenderableReferenceUrl } from './selfCharacterReference';

export type ReferenceRepairSlot =
  | 'manualReferenceImageUrl'
  | 'frontFace'
  | 'leftAngle'
  | 'rightAngle'
  | 'fullBody'
  | 'expressive';

export type ReferenceStatusKind = 'saved' | 'needs_reupload' | 'external' | 'missing' | 'optional';

export type ReferenceStatus = {
  kind: ReferenceStatusKind;
  label: string;
  detail: string;
};

export type CharacterReferenceEntry = {
  slot: ReferenceRepairSlot;
  label: string;
  url: string | null;
  optional: boolean;
  status: ReferenceStatus;
  removable: boolean;
};

export type ReferenceRepairIssue = {
  sourceUrl: string | null;
  label: string;
  role: string | null;
  slot: ReferenceRepairSlot | null;
  host: string | null;
  reason: string;
  canContinueWithoutReference: boolean;
};

const protectedHosts = [
  'fbcdn.net',
  'facebook.com',
  'instagram.com',
  'cdninstagram.com',
  'threads.net',
];

function hostForUrl(url: string | null | undefined) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isProtectedReferenceHost(host: string) {
  return protectedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function isLumoraSavedUrl(url: string | null | undefined) {
  if (!url) return false;
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

export function referenceStatus(url: string | null | undefined, optional = false): ReferenceStatus {
  const renderable = resolveRenderableReferenceUrl(url);
  if (!renderable) {
    return optional
      ? { kind: 'optional', label: 'Optional', detail: 'Add this when you want stronger cast consistency.' }
      : { kind: 'missing', label: 'Missing', detail: 'Add this before using cast reference mode.' };
  }

  const host = hostForUrl(renderable);
  if (isLumoraSavedUrl(renderable)) {
    return { kind: 'saved', label: 'Saved to Lumora', detail: 'This reference is ready for scenes.' };
  }

  if (isProtectedReferenceHost(host) || hasTemporarySignature(renderable)) {
    return { kind: 'needs_reupload', label: 'Needs re-upload', detail: 'This image link is protected.' };
  }

  return { kind: 'external', label: 'External link', detail: 'Upload directly to Lumora for the safest scene flow.' };
}

export function characterReferenceEntries(character: CharacterProfile | null | undefined): CharacterReferenceEntry[] {
  const references = (character?.referenceImageUrls ?? {}) as Partial<ReferenceImageUrls>;
  const entries: Array<Omit<CharacterReferenceEntry, 'status' | 'removable'>> = [
    {
      slot: 'manualReferenceImageUrl',
      label: 'Manual reference override',
      url: resolveRenderableReferenceUrl(references.manualReferenceImageUrl),
      optional: true,
    },
    {
      slot: 'frontFace',
      label: 'Front angle',
      url: resolveRenderableReferenceUrl(references.frontFaceUrl) ??
        resolveRenderableReferenceUrl(references.frontFacePath) ??
        resolveRenderableReferenceUrl(references.frontFace),
      optional: false,
    },
    {
      slot: 'leftAngle',
      label: 'Side angle left',
      url: resolveRenderableReferenceUrl(references.leftAngleUrl) ??
        resolveRenderableReferenceUrl(references.leftAnglePath) ??
        resolveRenderableReferenceUrl(references.leftAngle),
      optional: false,
    },
    {
      slot: 'rightAngle',
      label: 'Side angle right',
      url: resolveRenderableReferenceUrl(references.rightAngleUrl) ??
        resolveRenderableReferenceUrl(references.rightAnglePath) ??
        resolveRenderableReferenceUrl(references.rightAngle),
      optional: false,
    },
    {
      slot: 'fullBody',
      label: 'Full body',
      url: resolveRenderableReferenceUrl(references.fullBodyUrl) ??
        resolveRenderableReferenceUrl(references.fullBodyPath) ??
        resolveRenderableReferenceUrl(references.fullBody),
      optional: true,
    },
    {
      slot: 'expressive',
      label: 'Expression reference',
      url: resolveRenderableReferenceUrl(references.expressiveUrl) ??
        resolveRenderableReferenceUrl(references.expressivePath) ??
        resolveRenderableReferenceUrl(references.expressive),
      optional: true,
    },
  ];

  return entries.map((entry) => ({
    ...entry,
    status: referenceStatus(entry.url, entry.optional),
    removable: isReferenceEntryRemovable(entry),
  }));
}

export function referenceSlotForSeedanceReference(reference: Pick<SeedanceReferenceImage, 'label' | 'role'>): ReferenceRepairSlot | null {
  const label = (reference.label ?? '').toLowerCase();
  const role = (reference.role ?? '').toLowerCase();

  if (label.includes('manual') || role === 'manual_reference_override') return 'manualReferenceImageUrl';
  if (label.includes('front') || role === 'front_angle') return 'frontFace';
  if (label.includes('left')) return 'leftAngle';
  if (label.includes('right')) return 'rightAngle';
  if (label.includes('full') || role === 'full_body') return 'fullBody';
  if (label.includes('expression') || role === 'expression') return 'expressive';
  return null;
}

function isManualReferenceIdentity(value: {
  slot?: ReferenceRepairSlot | null;
  label?: string | null;
  role?: string | null;
}) {
  const label = (value.label ?? '').toLowerCase();
  const role = (value.role ?? '').toLowerCase();
  return value.slot === 'manualReferenceImageUrl' ||
    label.includes('manual reference') ||
    label.includes('manual override') ||
    role === 'manual_reference_override';
}

function isExternalOrProtectedUrl(url: string | null | undefined) {
  const renderable = resolveRenderableReferenceUrl(url);
  if (!renderable) return false;
  const status = referenceStatus(renderable, true);
  return status.kind === 'needs_reupload' || status.kind === 'external';
}

export function isObsoleteManualReference(value: {
  slot?: ReferenceRepairSlot | null;
  label?: string | null;
  role?: string | null;
  url?: string | null;
}) {
  if (!isManualReferenceIdentity(value)) return false;
  const renderable = resolveRenderableReferenceUrl(value.url);
  if (!renderable) return false;
  return !isLumoraSavedUrl(renderable) || isExternalOrProtectedUrl(renderable);
}

export function isReferenceEntryRemovable(entry: {
  slot: ReferenceRepairSlot;
  label: string;
  url: string | null;
  optional: boolean;
}) {
  if (!entry.url) return false;
  if (entry.slot === 'manualReferenceImageUrl') return true;
  if (!entry.optional) return false;
  return isExternalOrProtectedUrl(entry.url);
}

export function isReferenceRepairIssueRemovable(issue: ReferenceRepairIssue | null | undefined) {
  if (!issue) return false;
  if (!issue.sourceUrl) return false;
  return isObsoleteManualReference({
    slot: issue.slot,
    label: issue.label,
    role: issue.role,
    url: issue.sourceUrl,
  }) || (issue.canContinueWithoutReference && isExternalOrProtectedUrl(issue.sourceUrl));
}

export function filterObsoleteSeedanceReferences(references: SeedanceReferenceImage[]) {
  const savedLumoraReferences = references.filter((reference) => (
    !isObsoleteManualReference({
      label: reference.label,
      role: reference.role,
      url: reference.url,
    }) && isLumoraSavedUrl(reference.url)
  ));

  if (!savedLumoraReferences.length) return references;

  return references
    .filter((reference) => !isObsoleteManualReference({
      label: reference.label,
      role: reference.role,
      url: reference.url,
    }))
    .map((reference, index) => ({
      ...reference,
      token: `[Image${index + 1}]`,
    }));
}

export function referenceSlotForFailure(failure: {
  failedReferenceLabel?: string | null;
  failedReferenceRole?: string | null;
}): ReferenceRepairSlot | null {
  return referenceSlotForSeedanceReference({
    label: failure.failedReferenceLabel ?? undefined,
    role: failure.failedReferenceRole ?? undefined,
  });
}

export function normalizeReferenceRepairIssue(payload: unknown): ReferenceRepairIssue | null {
  const record = payload && typeof payload === 'object'
    ? payload as { assetPersistenceDiagnostics?: unknown }
    : {};
  const diagnostics = record.assetPersistenceDiagnostics && typeof record.assetPersistenceDiagnostics === 'object'
    ? record.assetPersistenceDiagnostics as Partial<AssetPersistenceFailureDiagnostics>
    : null;

  if (!diagnostics || !diagnostics.reason) return null;
  if (!['protected_external_url', 'expired_signed_url', 'invalid_url', 'download_failed'].includes(diagnostics.reason)) {
    return null;
  }

  return {
    sourceUrl: diagnostics.sourceUrl ?? null,
    label: diagnostics.failedReferenceLabel || 'Reference image',
    role: diagnostics.failedReferenceRole ?? null,
    slot: referenceSlotForFailure(diagnostics),
    host: diagnostics.originalUrlHost ?? diagnostics.host ?? null,
    reason: diagnostics.reason,
    canContinueWithoutReference: Boolean(diagnostics.canContinueWithoutReference),
  };
}

export function patchReferenceImageUrls(
  current: Partial<ReferenceImageUrls> | null | undefined,
  slot: ReferenceRepairSlot,
  url: string,
): ReferenceImageUrls {
  const next: ReferenceImageUrls = {
    frontFace: current?.frontFace ?? '',
    leftAngle: current?.leftAngle ?? '',
    rightAngle: current?.rightAngle ?? '',
    ...current,
  };

  if (slot === 'manualReferenceImageUrl') {
    next.manualReferenceImageUrl = url;
  } else if (slot === 'frontFace') {
    next.frontFace = url;
    next.frontFaceUrl = url;
  } else if (slot === 'leftAngle') {
    next.leftAngle = url;
    next.leftAngleUrl = url;
  } else if (slot === 'rightAngle') {
    next.rightAngle = url;
    next.rightAngleUrl = url;
  } else if (slot === 'fullBody') {
    next.fullBody = url;
    next.fullBodyUrl = url;
  } else if (slot === 'expressive') {
    next.expressive = url;
    next.expressiveUrl = url;
  }

  return next;
}

export function removeReferenceImageUrl(
  current: Partial<ReferenceImageUrls> | null | undefined,
  slot: ReferenceRepairSlot,
): ReferenceImageUrls {
  const next: ReferenceImageUrls = {
    frontFace: current?.frontFace ?? '',
    leftAngle: current?.leftAngle ?? '',
    rightAngle: current?.rightAngle ?? '',
    ...current,
  };

  if (slot === 'manualReferenceImageUrl') {
    next.manualReferenceImageUrl = null;
  } else if (slot === 'frontFace') {
    next.frontFace = '';
    next.frontFaceUrl = null;
    next.frontFacePath = null;
  } else if (slot === 'leftAngle') {
    next.leftAngle = '';
    next.leftAngleUrl = null;
    next.leftAnglePath = null;
  } else if (slot === 'rightAngle') {
    next.rightAngle = '';
    next.rightAngleUrl = null;
    next.rightAnglePath = null;
  } else if (slot === 'fullBody') {
    next.fullBody = null;
    next.fullBodyUrl = null;
    next.fullBodyPath = null;
  } else if (slot === 'expressive') {
    next.expressive = null;
    next.expressiveUrl = null;
    next.expressivePath = null;
  }

  return next;
}
