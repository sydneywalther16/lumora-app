import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ApiHealthDiagnostics, type CharacterProfile, type CharacterRelationshipMemory } from '../lib/api';
import { deleteLocalCharacterProfile, updateLocalCharacterProfile } from '../lib/characterStorage';
import { getBestThumbnail } from '../lib/mediaThumbnail';
import {
  deleteSupabaseCharacterProfile,
  loadSupabaseCharacters,
  updateSupabaseCharacterReferenceImageUrls,
  updateSupabaseCharacterProfile,
  uploadLumoraMedia,
} from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';
import { trackCreatorEvent } from '../lib/creatorEvents';
import { buildCreatorIdentityCard } from '../lib/storyWorld';
import CreatorIdentityCard from './CreatorIdentityCard';
import CharacterCapture from './CharacterCapture';
import {
  characterReferenceEntries,
  patchReferenceImageUrls,
  removeReferenceImageUrl,
  type CharacterReferenceEntry,
  type ReferenceRepairSlot,
} from '../lib/referenceRepair';
import {
  createSelfCharacterStatusCopy,
  exactLikenessRouteStatusLabel,
  hasEffectiveSelfVerificationVideo,
  hasLegacySelfCaptureVideo,
  selfVerificationVideoStatusLabel,
  validateSelfVerificationVideoFile,
} from '../lib/selfCharacterSetup';

type CharacterHubProps = {
  open: boolean;
  characters: CharacterProfile[];
  onClose: () => void;
  onEditSelf: () => void | Promise<void>;
  onRefresh: (characters?: CharacterProfile[]) => void | Promise<void>;
  castMode?: boolean;
  onCast?: (character: CharacterProfile) => void;
  initialFocus?: 'self-verification' | null;
  children?: ReactNode;
};

type DetailSectionKey = 'identity' | 'providerIdentity' | 'likenessLab' | 'appearance' | 'style' | 'voice' | 'memory' | 'references';

const characterLimit = 25;
const characterProfilesMigrationWarning = 'Cast needs the latest Lumora update.';

function characterInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'C';
}

function characterTimestamp(character: CharacterProfile) {
  return new Date(character.createdAt || character.updatedAt || 0).getTime() || 0;
}

function characterIsSelf(character: CharacterProfile): boolean {
  return character.id === 'creator-self' || character.characterId === 'creator-self' || character.isCreatorSelf === true;
}

function characterProfileEditorError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes('appearance_summary') ||
    lower.includes('relationship_memory') ||
    lower.includes('continuity_state') ||
    lower.includes('character_id')
  ) {
    return characterProfilesMigrationWarning;
  }

  return error instanceof Error ? error.message : 'Unable to save cast member.';
}

function displayName(character: CharacterProfile | null | undefined) {
  return character?.displayName || character?.name || 'Untitled character';
}

function CharacterThumbnail({ character, size = 56 }: { character: CharacterProfile; size?: number }) {
  const thumbnail = getBestThumbnail(character);
  const name = displayName(character);

  return (
    <span className="character-avatar" style={{ width: `${size}px`, height: `${size}px`, borderRadius: size > 60 ? '22px' : '18px' }}>
      {thumbnail ? (
        <img src={thumbnail} alt={name} />
      ) : (
        characterInitial(name)
      )}
    </span>
  );
}

function metadataLine(label: string, value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return <p><strong>{label}</strong> {text}</p>;
}

function summaryText(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'New';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function latestContinuityConfidence(character: CharacterProfile) {
  const latestSnapshot = character.memorySnapshots?.find((snapshot) => typeof snapshot.continuityConfidence === 'number');
  return latestSnapshot?.continuityConfidence ?? null;
}

function providerIdentityStatusLabel(character: CharacterProfile) {
  if (character.videoReferenceRouteStatus === 'canary_succeeded') return 'Video likeness ready';
  if (hasEffectiveSelfVerificationVideo(character) && character.videoReferenceRouteStatus === 'configured_not_implemented') return 'Video route unmapped';
  if (hasEffectiveSelfVerificationVideo(character)) return 'Verification video saved';
  if (character.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'canary_succeeded') return 'Exact likeness ready';
  if (character.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'character_created_needs_canary') return 'Needs canary';
  if (character.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'character_created_usage_unmapped') return 'Provider unavailable';
  if (character.providerCharacterStatus === 'ready') return 'Ready';
  if (character.providerCharacterStatus === 'pending') return 'Pending';
  if (character.providerCharacterStatus === 'failed') return 'Failed';
  if (character.providerCharacterStatus === 'disabled') return 'Not configured';
  return 'Needs setup';
}

function providerIdentityStatusCopy(character: CharacterProfile) {
  if (character.videoReferenceRouteStatus === 'canary_succeeded') {
    return 'Seedance video-reference likeness route is canary-tested and ready.';
  }
  if (hasEffectiveSelfVerificationVideo(character) && character.videoReferenceRouteStatus === 'configured_not_implemented') {
    return 'Self verification video is saved privately; the Seedance video-reference provider field is not mapped yet.';
  }
  if (hasLegacySelfCaptureVideo(character) && !character.verificationVideoPresent) {
    return 'Your previous self capture is now treated as the private verification video for future likeness canaries.';
  }
  if (hasEffectiveSelfVerificationVideo(character)) return 'Self verification video is saved privately for future video likeness canaries.';
  if (character.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'canary_succeeded') {
    return 'Exact self character route is canary-tested and ready.';
  }
  if (character.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'character_created_needs_canary') {
    return 'Provider character exists, but the exact video route needs a canary before Create can use it.';
  }
  if (character.providerCharacterStatus === 'ready' && character.likenessProviderStatus === 'character_created_usage_unmapped') {
    return 'Verified self character created. Video route not available yet.';
  }
  if (character.providerCharacterStatus === 'ready') return 'Verified provider character is ready after setup and canary testing.';
  if (character.providerCharacterStatus === 'failed') return 'Provider character setup could not run with the current configuration.';
  if (character.providerCharacterStatus === 'disabled') return 'OpenAI video character routing is not configured yet.';
  return 'Create a verified provider character only after uploading a consented self video.';
}

function readVideoDurationSeconds(file: File): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = objectUrl;
  });
}

function likenessRegistryEntry(diagnostics: ApiHealthDiagnostics | null, id: string) {
  return diagnostics?.likenessProviderRegistry?.find((provider) => provider.id === id) ?? null;
}

function providerLabStatus(diagnostics: ApiHealthDiagnostics | null, id: string, fallback = 'not configured') {
  const entry = likenessRegistryEntry(diagnostics, id);
  if (!entry) return fallback;
  if (entry.readinessStatus === 'configured_ready_for_canary') return 'ready to test';
  if (entry.readinessStatus === 'canary_succeeded') return 'succeeded';
  if (entry.readinessStatus === 'canary_failed') return 'failed';
  if (entry.readinessStatus === 'configured_not_implemented') return 'configured, not implemented';
  if (entry.readinessStatus === 'research_only') return 'research only';
  if (entry.readinessStatus === 'blocked') return 'blocked';
  return entry.readinessStatus.replace(/_/g, ' ');
}

function uniqueSceneCount(character: CharacterProfile) {
  const sceneKeys = new Set(
    (character.memorySnapshots ?? [])
      .map((snapshot) => snapshot.sceneId || snapshot.sceneExecutionId)
      .filter((value): value is string => Boolean(value)),
  );
  return sceneKeys.size || (character.memorySnapshots?.length ?? 0);
}

function compactValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map(compactValue)
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
  }
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, compactValue(entryValue)] as const)
      .filter(([, entryValue]) => entryValue)
      .slice(0, 4);
    return pairs.map(([key, entryValue]) => `${key}: ${entryValue}`).join(' / ');
  }
  return '';
}

function stylePreferenceEntries(character: CharacterProfile): Array<readonly [string, string]> {
  const preferences = character.stylePreferences ?? {};
  const entries: Array<[string, unknown]> = [
    ['Everyday style', preferences.everydayStyle],
    ['Glam style', preferences.glamStyle],
    ['Wardrobe', preferences.videoWardrobe ?? preferences.fashionStyle],
    ['Colors to favor', preferences.colorsToFavor],
    ['Colors to avoid', preferences.colorsToAvoid ?? preferences.colorsItemsToAvoid],
    ['Character vibe', preferences.characterVibe],
  ];

  return entries
    .map(([label, value]) => [label, compactValue(value)] as const)
    .filter(([, value]) => value);
}

function orchestrationMemoryEntries(character: CharacterProfile): Array<readonly [string, string]> {
  const preferences = character.stylePreferences ?? {};
  const entries: Array<[string, unknown]> = [
    ['Cinematic mode', preferences.renderingMode ?? preferences.realismMode ?? preferences.preferredRenderingMode],
    ['Successful take path', preferences.successfulFallbackPath ?? preferences.lastSuccessfulFallbackPath],
    ['Creative style preference', preferences.providerFallbackPreference ?? preferences.stylizationFallbackPreference],
    ['Creative safety notes', preferences.moderationMemory ?? preferences.moderationRewritePreferences ?? preferences.moderationSafeRewritePreferences],
    ['Story inheritance', preferences.continuityInheritance ?? preferences.inheritedContinuity],
  ];

  return entries
    .map(([label, value]) => [label, compactValue(value)] as const)
    .filter(([, value]) => value);
}

function CharacterHubFrame({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="character-hub-overlay" role="presentation">
      <div className="character-hub-panel lumora-panel" role="dialog" aria-modal="true" aria-label="Your AI Cast">
        <div className="character-hub-scroll">
          {children}
        </div>
        <button type="button" className="character-hub-close" aria-label="Close characters" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function CharacterDetailSection({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  id: DetailSectionKey;
  title: string;
  summary?: string;
  expanded: boolean;
  onToggle: (section: DetailSectionKey) => void;
  children: ReactNode;
}) {
  return (
    <section className={`character-accordion-section character-section-${id}${expanded ? ' is-open' : ''}`}>
      <button
        type="button"
        className="character-accordion-trigger"
        aria-expanded={expanded}
        onClick={() => onToggle(id)}
      >
        <span>
          <strong>{title}</strong>
          {summary ? <small>{summary}</small> : null}
        </span>
        <span className="character-accordion-icon" aria-hidden="true">{expanded ? '-' : '+'}</span>
      </button>
      <div className="character-accordion-content" aria-hidden={!expanded}>
        <div className="character-accordion-inner">
          {children}
        </div>
      </div>
    </section>
  );
}

function ModalShell({ children }: { children: ReactNode }) {
  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: '18px',
        background: 'var(--modal-backdrop)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(460px, 100%)',
          borderRadius: '26px',
          padding: '18px',
          background: 'var(--modal-surface)',
          boxShadow: 'var(--modal-shadow)',
          border: '1px solid var(--surface-border)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function CharacterHub({
  open,
  characters,
  onClose,
  onEditSelf,
  onRefresh,
  castMode = false,
  onCast,
  initialFocus = null,
  children,
}: CharacterHubProps) {
  const { user, session } = useSession();
  const authUser = session?.user ?? user;
  const selfCharacter = useMemo(
    () => characters.find(characterIsSelf) ?? null,
    [characters],
  );
  const visibleCharacters = useMemo(() => {
    const otherCharacters = characters
      .filter((character) => !characterIsSelf(character))
      .sort((a, b) => characterTimestamp(b) - characterTimestamp(a))
      .slice(0, Math.max(0, characterLimit - (selfCharacter ? 1 : 0)));

    return selfCharacter ? [selfCharacter, ...otherCharacters] : otherCharacters;
  }, [characters, selfCharacter]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [selfSetupOpen, setSelfSetupOpen] = useState(false);
  const selectedCharacter = visibleCharacters.find((character) => character.id === selectedCharacterId) ?? null;
  const selectedIsSelf = Boolean(selectedCharacter && characterIsSelf(selectedCharacter));
  const [editorName, setEditorName] = useState('');
  const [appearanceSummary, setAppearanceSummary] = useState('');
  const [wardrobeTendencies, setWardrobeTendencies] = useState('');
  const [emotionalTendencies, setEmotionalTendencies] = useState('');
  const [soundtrackTendencies, setSoundtrackTendencies] = useState('');
  const [cinematicStyle, setCinematicStyle] = useState('');
  const [relationshipNotes, setRelationshipNotes] = useState('');
  const [editorStatus, setEditorStatus] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState('');
  const [deletingCharacter, setDeletingCharacter] = useState(false);
  const [expandedSections, setExpandedSections] = useState<DetailSectionKey[]>(['appearance', 'memory']);
  const [referenceRepairSlot, setReferenceRepairSlot] = useState<ReferenceRepairSlot | null>(null);
  const [referenceRepairStatus, setReferenceRepairStatus] = useState('');
  const [referenceRepairSaving, setReferenceRepairSaving] = useState(false);
  const [soraIdentityFile, setSoraIdentityFile] = useState<File | null>(null);
  const [soraIdentityConsent, setSoraIdentityConsent] = useState(false);
  const [soraIdentitySaving, setSoraIdentitySaving] = useState(false);
  const [soraIdentityStatus, setSoraIdentityStatus] = useState('');
  const [verificationVideoFile, setVerificationVideoFile] = useState<File | null>(null);
  const [verificationVideoConsent, setVerificationVideoConsent] = useState(false);
  const [verificationAudioPresent, setVerificationAudioPresent] = useState(true);
  const [verificationVideoSaving, setVerificationVideoSaving] = useState(false);
  const [verificationVideoStatus, setVerificationVideoStatus] = useState('');
  const [likenessDiagnostics, setLikenessDiagnostics] = useState<ApiHealthDiagnostics | null>(null);
  const [likenessLabStatus, setLikenessLabStatus] = useState('');
  const [likenessCanaryBusy, setLikenessCanaryBusy] = useState<'runway' | 'kling' | 'seedance-video' | null>(null);
  const referenceRepairInputRef = useRef<HTMLInputElement | null>(null);
  const verificationVideoInputRef = useRef<HTMLInputElement | null>(null);
  const initialFocusHandledRef = useRef(false);
  const atCharacterLimit = characters.length >= characterLimit;

  useEffect(() => {
    if (!open) {
      setSelectedCharacterId(null);
      setCreatingCharacter(false);
      setSelfSetupOpen(false);
      setActionsOpen(false);
      setConfirmDeleteOpen(false);
      setDeleteStatus('');
      setSoraIdentityFile(null);
      setSoraIdentityConsent(false);
      setSoraIdentityStatus('');
      setVerificationVideoFile(null);
      setVerificationVideoConsent(false);
      setVerificationVideoStatus('');
      setLikenessDiagnostics(null);
      setLikenessLabStatus('');
      setLikenessCanaryBusy(null);
      initialFocusHandledRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open || initialFocusHandledRef.current || initialFocus !== 'self-verification' || !selfCharacter) return;
    initialFocusHandledRef.current = true;
    setSelectedCharacterId(selfCharacter.id);
    setCreatingCharacter(false);
    setSelfSetupOpen(false);
    setActionsOpen(false);
    setConfirmDeleteOpen(false);
    setExpandedSections(['likenessLab', 'references']);
    window.setTimeout(() => {
      document.getElementById('self-verification-video-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 90);
    void onEditSelf();
  }, [initialFocus, onEditSelf, open, selfCharacter]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!selectedCharacter) {
      setEditorName('');
      setAppearanceSummary('');
      setWardrobeTendencies('');
      setEmotionalTendencies('');
      setSoundtrackTendencies('');
      setCinematicStyle('');
      setRelationshipNotes('');
      setEditorStatus('');
      setSoraIdentityStatus('');
      setVerificationVideoStatus('');
      setLikenessDiagnostics(null);
      setLikenessLabStatus('');
      return;
    }

    setEditorName(displayName(selectedCharacter));
    setAppearanceSummary(selectedCharacter.appearanceSummary ?? '');
    setWardrobeTendencies(selectedCharacter.wardrobeTendencies ?? '');
    setEmotionalTendencies(selectedCharacter.emotionalTendencies ?? '');
    setSoundtrackTendencies(selectedCharacter.soundtrackTendencies ?? '');
    setCinematicStyle(selectedCharacter.cinematicStyle ?? '');
    setRelationshipNotes(
      Object.values(selectedCharacter.relationshipMemory ?? {})
        .map((memory) => memory.relationshipSummary)
        .filter(Boolean)
        .join('\n'),
    );
    setEditorStatus('');
    setDeleteStatus('');
    setExpandedSections(characterIsSelf(selectedCharacter) ? ['likenessLab', 'references'] : ['appearance', 'memory']);
  }, [selectedCharacter]);

  useEffect(() => {
    if (!open || !selectedIsSelf) {
      setLikenessDiagnostics(null);
      return;
    }

    let canceled = false;
    api.healthDiagnostics()
      .then((diagnostics) => {
        if (!canceled) setLikenessDiagnostics(diagnostics);
      })
      .catch(() => {
        if (!canceled) setLikenessDiagnostics(null);
      });

    return () => {
      canceled = true;
    };
  }, [open, selectedIsSelf, selectedCharacterId]);

  if (!open) return null;

  function returnToList() {
    setSelectedCharacterId(null);
    setCreatingCharacter(false);
    setSelfSetupOpen(false);
    setActionsOpen(false);
    setConfirmDeleteOpen(false);
    setDeleteStatus('');
  }

  function openCharacterDetail(character: CharacterProfile) {
    void trackCreatorEvent('character_opened', { characterId: character.id, isSelf: characterIsSelf(character) }, authUser?.id ?? null);
    setSelectedCharacterId(character.id);
    setCreatingCharacter(false);
    setSelfSetupOpen(false);
    setActionsOpen(false);
    setConfirmDeleteOpen(false);
    if (characterIsSelf(character)) {
      void onEditSelf();
    }
  }

  function openSelfSetup() {
    setSelectedCharacterId(null);
    setCreatingCharacter(false);
    setSelfSetupOpen(true);
    setActionsOpen(false);
    setConfirmDeleteOpen(false);
    setExpandedSections([]);
    void onEditSelf();
  }

  function toggleDetailSection(section: DetailSectionKey) {
    setExpandedSections((current) => {
      if (current.includes(section)) {
        return current.filter((item) => item !== section);
      }
      return [section, ...current].slice(0, 2);
    });
  }

  function detailSectionIsOpen(section: DetailSectionKey) {
    return expandedSections.includes(section);
  }

  async function refreshAfterCreate() {
    setCreatingCharacter(false);
    if (authUser) {
      const latestCharacters = await loadSupabaseCharacters(authUser.id);
      await onRefresh(latestCharacters);
      void trackCreatorEvent('self_character_created', { source: 'characters', characterCount: latestCharacters.length }, authUser.id);
      return;
    }
    await onRefresh();
    void trackCreatorEvent('self_character_created', { source: 'characters' }, null);
  }

  async function handleSaveProfile() {
    if (!selectedCharacter || selectedIsSelf) return;

    setSavingProfile(true);
    setEditorStatus('Saving cast member...');

    const relationshipMemory: Record<string, CharacterRelationshipMemory> = relationshipNotes.trim()
      ? {
          notes: {
            relationshipSummary: relationshipNotes.trim(),
            updatedAt: new Date().toISOString(),
          },
        }
      : {};

    try {
      const updated = authUser
        ? await updateSupabaseCharacterProfile({
            userId: authUser.id,
            characterId: selectedCharacter.id,
            name: editorName.trim() || selectedCharacter.name,
            displayName: editorName.trim() || selectedCharacter.displayName || selectedCharacter.name,
            appearanceSummary,
            wardrobeTendencies,
            emotionalTendencies,
            soundtrackTendencies,
            cinematicStyle,
            relationshipMemory,
          })
        : updateLocalCharacterProfile({
            characterId: selectedCharacter.id,
            name: editorName.trim() || selectedCharacter.name,
            appearanceSummary,
            wardrobeTendencies,
            emotionalTendencies,
            soundtrackTendencies,
            cinematicStyle,
            relationshipMemory,
          });

      if (!updated) throw new Error('Cast member not found.');

      await onRefresh(
        characters.map((character) => character.id === updated.id ? updated : character),
      );
      setSelectedCharacterId(updated.id);
      setEditorStatus('Cast member saved.');
    } catch (error) {
      setEditorStatus(characterProfileEditorError(error));
    } finally {
      setSavingProfile(false);
    }
  }

  function startReferenceRepair(entry: CharacterReferenceEntry) {
    if (selectedIsSelf) {
      void onEditSelf();
      return;
    }
    setReferenceRepairSlot(entry.slot);
    setReferenceRepairStatus('');
    referenceRepairInputRef.current?.click();
  }

  async function handleReferenceRepairFile(file: File | null | undefined) {
    if (!file || !selectedCharacter || !referenceRepairSlot) return;
    if (!authUser) {
      setReferenceRepairStatus('Sign in to save repaired references to Lumora.');
      return;
    }

    setReferenceRepairSaving(true);
    setReferenceRepairStatus('Saving reference to Lumora...');
    try {
      const upload = await uploadLumoraMedia({
        userId: authUser.id,
        bucket: 'lumora-assets',
        file,
        folder: `reference-repairs/${selectedCharacter.id}`,
        usage: 'character_reference_image',
        entityType: 'character_profile',
        entityId: selectedCharacter.id,
      });
      const nextReferenceImageUrls = patchReferenceImageUrls(
        selectedCharacter.referenceImageUrls,
        referenceRepairSlot,
        upload.url,
      );
      const updated = await updateSupabaseCharacterProfile({
        userId: authUser.id,
        characterId: selectedCharacter.id,
        referenceImageUrls: nextReferenceImageUrls,
      });
      setSelectedCharacterId(updated.id);
      setReferenceRepairStatus('Reference saved to Lumora.');
      await onRefresh(characters.map((character) => (character.id === updated.id ? updated : character)));
    } catch (error) {
      setReferenceRepairStatus(error instanceof Error ? characterProfileEditorError(error) : 'Unable to save this reference yet.');
    } finally {
      setReferenceRepairSaving(false);
      setReferenceRepairSlot(null);
      if (referenceRepairInputRef.current) referenceRepairInputRef.current.value = '';
    }
  }

  async function handleRemoveReference(entry: CharacterReferenceEntry) {
    if (!selectedCharacter || !entry.removable) return;

    setReferenceRepairSaving(true);
    setReferenceRepairStatus('Removing old reference...');
    try {
      const nextReferenceImageUrls = removeReferenceImageUrl(selectedCharacter.referenceImageUrls, entry.slot);
      const updated = authUser
        ? await updateSupabaseCharacterReferenceImageUrls({
            userId: authUser.id,
            character: selectedCharacter,
            referenceImageUrls: nextReferenceImageUrls,
          })
        : updateLocalCharacterProfile({
            characterId: selectedCharacter.id,
            referenceImageUrls: nextReferenceImageUrls,
          });

      if (!updated) throw new Error('Cast member not found.');

      setSelectedCharacterId(updated.id);
      setReferenceRepairStatus('Old reference removed. Your saved Lumora references will still be used.');
      await onRefresh(characters.map((character) => (character.id === updated.id ? updated : character)));
    } catch (error) {
      setReferenceRepairStatus(error instanceof Error ? characterProfileEditorError(error) : 'Unable to remove this reference yet.');
    } finally {
      setReferenceRepairSaving(false);
    }
  }

  async function handleVerificationVideoFile(file: File | null | undefined) {
    const validationError = validateSelfVerificationVideoFile(file);
    if (validationError) {
      setVerificationVideoFile(null);
      setVerificationVideoStatus(validationError);
      if (verificationVideoInputRef.current) verificationVideoInputRef.current.value = '';
      return;
    }

    if (file) {
      const duration = await readVideoDurationSeconds(file);
      if (duration !== null && duration > 30) {
        setVerificationVideoFile(null);
        setVerificationVideoStatus('Use a short 6 to 15 second verification video. This file is too long.');
        if (verificationVideoInputRef.current) verificationVideoInputRef.current.value = '';
        return;
      }
    }

    setVerificationVideoFile(file ?? null);
    setVerificationVideoStatus(file ? `${file.name} selected. Confirm consent, then save.` : '');
  }

  async function handleCreateSoraSelfCharacter() {
    if (!selectedCharacter || !selectedIsSelf) return;
    if (!authUser) {
      setSoraIdentityStatus('Sign in to create a verified self character.');
      return;
    }
    if (!soraIdentityConsent) {
      setSoraIdentityStatus('Consent is required before creating a verified self character.');
      return;
    }
    if (!soraIdentityFile) {
      setSoraIdentityStatus('Upload a short self video first.');
      return;
    }

    setSoraIdentitySaving(true);
    setSoraIdentityStatus('Uploading self character video...');
    try {
      const upload = await uploadLumoraMedia({
        userId: authUser.id,
        bucket: 'lumora-assets',
        file: soraIdentityFile,
        folder: `provider-identities/${selectedCharacter.id}`,
        usage: 'self_character_provider_identity_video',
        entityType: 'character_profile',
        entityId: selectedCharacter.id,
      });
      setSoraIdentityStatus('Checking provider character route...');
      const response = await api.createSoraSelfCharacter({
        userId: authUser.id,
        characterId: selectedCharacter.characterId ?? selectedCharacter.id,
        consentConfirmed: soraIdentityConsent,
        sourceUploadAssetId: upload.objectPath,
        sourceVideoUrl: upload.url,
      });
      const fallbackUpdatedCharacter: CharacterProfile = {
        ...selectedCharacter,
        providerIdentityProvider: 'openai_sora',
        providerCharacterId: null,
        providerCharacterIdPresent: response.providerCharacterIdPresent,
        providerCharacterStatus: response.providerCharacterStatus,
        likenessProviderStatus: response.likenessProviderStatus,
        likenessConsentAt: new Date().toISOString(),
        providerCharacterSourceAssetId: upload.objectPath,
      };
      const nextCharacter = response.character ?? fallbackUpdatedCharacter;
      await onRefresh(
        characters.map((character) => (
          character.id === selectedCharacter.id || character.characterId === selectedCharacter.characterId
            ? nextCharacter
            : character
        )),
      );
      setSelectedCharacterId(nextCharacter.id);
      setSoraIdentityStatus(response.message || 'Provider character status updated.');
      setSoraIdentityFile(null);
      setSoraIdentityConsent(false);
    } catch (error) {
      setSoraIdentityStatus(error instanceof Error ? error.message : 'Unable to create verified self character yet.');
    } finally {
      setSoraIdentitySaving(false);
    }
  }

  async function handleSaveSelfVerificationVideo() {
    if (!selectedCharacter || !selectedIsSelf) return;
    if (!authUser) {
      setVerificationVideoStatus('Sign in to save your self verification video.');
      return;
    }
    if (!verificationVideoConsent) {
      setVerificationVideoStatus('Please confirm this is you before uploading your self verification video.');
      return;
    }
    if (!verificationVideoFile) {
      setVerificationVideoStatus('Upload a short self verification video first.');
      return;
    }
    const validationError = validateSelfVerificationVideoFile(verificationVideoFile);
    if (validationError) {
      setVerificationVideoStatus(validationError);
      return;
    }

    setVerificationVideoSaving(true);
    setVerificationVideoStatus('Saving private self verification video...');
    try {
      const upload = await uploadLumoraMedia({
        userId: authUser.id,
        bucket: 'self-capture-videos',
        file: verificationVideoFile,
        folder: `self-verification/${selectedCharacter.id}`,
        usage: 'self_verification_video',
        entityType: 'character_profile',
        entityId: selectedCharacter.id,
      });
      const response = await api.saveSelfVerificationVideo({
        userId: authUser.id,
        characterId: selectedCharacter.characterId ?? selectedCharacter.id,
        consentConfirmed: verificationVideoConsent,
        sourceUploadAssetId: upload.objectPath,
        sourceVideoUrl: upload.url,
        sourceFileName: verificationVideoFile.name,
        sourceContentType: verificationVideoFile.type,
        sourceSizeBytes: verificationVideoFile.size,
        verificationAudioPresent,
      });
      const fallbackUpdatedCharacter: CharacterProfile = {
        ...selectedCharacter,
        verificationVideoUrl: null,
        verificationVideoPresent: response.verificationVideoPresent,
        verificationVideoAssetId: upload.objectPath,
        verificationAudioPresent: response.verificationAudioPresent,
        verificationConsentAt: new Date().toISOString(),
        verificationConsentPresent: response.verificationConsentPresent,
        verificationStatus: response.verificationStatus,
        verificationPrompt: response.verificationPrompt,
        videoReferenceRouteStatus: response.videoReferenceRouteStatus,
        videoReferenceProvider: 'seedance',
      };
      const nextCharacter = response.character ?? fallbackUpdatedCharacter;
      await onRefresh(characters.map((character) => (
        character.id === selectedCharacter.id || character.characterId === selectedCharacter.characterId
          ? nextCharacter
          : character
      )));
      setSelectedCharacterId(nextCharacter.id);
      setVerificationVideoStatus(response.message || 'Self verification video saved privately.');
      setVerificationVideoFile(null);
      setVerificationVideoConsent(false);
      if (verificationVideoInputRef.current) verificationVideoInputRef.current.value = '';
      await refreshLikenessDiagnostics();
    } catch (error) {
      setVerificationVideoStatus(error instanceof Error ? error.message : 'Unable to save self verification video yet.');
    } finally {
      setVerificationVideoSaving(false);
    }
  }

  async function handleRemoveSelfVerificationVideo() {
    if (!selectedCharacter || !selectedIsSelf) return;
    if (!authUser) {
      setVerificationVideoStatus('Sign in to remove your self verification video.');
      return;
    }

    setVerificationVideoSaving(true);
    setVerificationVideoStatus('Removing private self verification video...');
    try {
      const response = await api.deleteSelfVerificationVideo({
        userId: authUser.id,
        characterId: selectedCharacter.characterId ?? selectedCharacter.id,
      });
      const fallbackUpdatedCharacter: CharacterProfile = {
        ...selectedCharacter,
        stylePreferences: {
          ...(selectedCharacter.stylePreferences ?? {}),
          selfCaptureConsent: false,
          selfCaptureCompleted: false,
        },
        sourceCaptureVideoUrl: null,
        sourceCaptureVideoPath: null,
        sourceCaptureVideo2Url: null,
        sourceCaptureVideo2Path: null,
        sourceCaptureVideo2Name: null,
        verificationVideoUrl: null,
        verificationVideoPresent: false,
        verificationVideoAssetId: null,
        verificationAudioPresent: false,
        verificationConsentAt: null,
        verificationConsentPresent: false,
        verificationStatus: response.verificationStatus,
        verificationPrompt: null,
        verificationLastTestedAt: null,
        videoReferenceRouteStatus: null,
        videoReferenceProvider: null,
      };
      const nextCharacter = response.character ?? fallbackUpdatedCharacter;
      await onRefresh(characters.map((character) => (
        character.id === selectedCharacter.id || character.characterId === selectedCharacter.characterId
          ? nextCharacter
          : character
      )));
      setSelectedCharacterId(nextCharacter.id);
      setVerificationVideoFile(null);
      setVerificationVideoConsent(false);
      if (verificationVideoInputRef.current) verificationVideoInputRef.current.value = '';
      setVerificationVideoStatus(response.message || 'Self verification video removed.');
      await refreshLikenessDiagnostics();
    } catch (error) {
      setVerificationVideoStatus(error instanceof Error ? error.message : 'Unable to remove self verification video yet.');
    } finally {
      setVerificationVideoSaving(false);
    }
  }

  async function refreshLikenessDiagnostics() {
    const diagnostics = await api.healthDiagnostics();
    setLikenessDiagnostics(diagnostics);
    return diagnostics;
  }

  async function handleRunwayLikenessCanary() {
    if (!authUser) {
      setLikenessLabStatus('Sign in to run provider likeness tests.');
      return;
    }
    if (!window.confirm('This may consume provider credits. Run the Runway likeness canary?')) {
      return;
    }
    setLikenessCanaryBusy('runway');
    setLikenessLabStatus('Starting Runway likeness canary...');
    try {
      const result = await api.startRunwayLikenessCanary({ userId: authUser.id, saveAsDraft: false });
      setLikenessLabStatus(result.ok
        ? 'Runway likeness canary succeeded.'
        : result.recommendedNextAction || result.failureCategory || 'Runway likeness canary did not complete.');
      await refreshLikenessDiagnostics();
    } catch (error) {
      setLikenessLabStatus(error instanceof Error ? error.message : 'Runway likeness canary could not start.');
    } finally {
      setLikenessCanaryBusy(null);
    }
  }

  async function handleKlingLikenessCanary() {
    if (!authUser) {
      setLikenessLabStatus('Sign in to run provider likeness tests.');
      return;
    }
    if (!window.confirm('This may consume provider credits when Kling support is mapped. Test Kling likeness route?')) {
      return;
    }
    setLikenessCanaryBusy('kling');
    setLikenessLabStatus('Checking Kling likeness route...');
    try {
      const result = await api.startKlingLikenessCanary({ userId: authUser.id });
      setLikenessLabStatus(result.recommendedNextAction || result.failureCategory || 'Kling likeness route checked.');
      await refreshLikenessDiagnostics();
    } catch (error) {
      setLikenessLabStatus(error instanceof Error ? error.message : 'Kling likeness route could not start.');
    } finally {
      setLikenessCanaryBusy(null);
    }
  }

  async function handleSeedanceVideoReferenceCanary() {
    if (!authUser) {
      setLikenessLabStatus('Sign in to run video likeness tests.');
      return;
    }
    if (!window.confirm('This may consume provider credits after a documented video-reference route is mapped. Test the Seedance video likeness route?')) {
      return;
    }
    setLikenessCanaryBusy('seedance-video');
    setLikenessLabStatus('Checking Seedance video reference route...');
    try {
      const result = await api.startSeedanceVideoReferenceCanary({ userId: authUser.id });
      setLikenessLabStatus(result.recommendedNextAction || result.failureCategory || 'Seedance video reference route checked.');
      await refreshLikenessDiagnostics();
    } catch (error) {
      setLikenessLabStatus(error instanceof Error ? error.message : 'Seedance video reference route could not start.');
    } finally {
      setLikenessCanaryBusy(null);
    }
  }

  async function handleConfirmDelete() {
    if (!selectedCharacter || selectedIsSelf) return;

    setDeletingCharacter(true);
    setDeleteStatus('Removing cast member...');

    try {
      if (authUser) {
        await deleteSupabaseCharacterProfile({
          userId: authUser.id,
          character: selectedCharacter,
        });
        const latestCharacters = await loadSupabaseCharacters(authUser.id);
        await onRefresh(latestCharacters);
      } else {
        const deleted = deleteLocalCharacterProfile(selectedCharacter.id);
        if (!deleted) throw new Error('Cast member not found.');
        await onRefresh();
      }

      setConfirmDeleteOpen(false);
      setActionsOpen(false);
      setSelectedCharacterId(null);
      setDeleteStatus('');
      void trackCreatorEvent('character_deleted', { characterId: selectedCharacter.id }, authUser?.id ?? null);
    } catch (error) {
      setDeleteStatus(error instanceof Error ? error.message : 'Unable to delete character.');
    } finally {
      setDeletingCharacter(false);
    }
  }

  if (creatingCharacter) {
    return (
      <CharacterHubFrame onClose={onClose}>
      <section className="character-hub-view">
        <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <span className="eyebrow">cast</span>
            <h2 style={{ marginTop: '8px' }}>Create Cast Member</h2>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Add a reusable AI cast member for generated scenes and Story Memory.
            </p>
          </div>
          <button type="button" className="text-btn" onClick={returnToList}>
            Back
          </button>
        </div>
        <CharacterCapture onCreated={() => void refreshAfterCreate()} />
      </section>
      </CharacterHubFrame>
    );
  }

  if (selfSetupOpen) {
    return (
      <CharacterHubFrame onClose={onClose}>
      <section className="character-hub-view character-detail-page">
        <div className="character-detail-topbar">
          <button type="button" className="text-btn" onClick={returnToList}>
            Back
          </button>
        </div>

        <article className="character-detail-hero">
          <div className="character-detail-identity">
            <span className="character-avatar" style={{ width: '104px', height: '104px', borderRadius: '24px' }}>S</span>
            <div style={{ minWidth: 0 }}>
              <span className="tiny-pill">Self</span>
              <h2 style={{ margin: '8px 0 0' }}>Create your self character</h2>
              <p className="character-hero-summary">
                Build the pinned self character Lumora can bring back across generated scenes.
              </p>
              <div className="character-quick-stats" aria-label="Self character setup stats">
                <span><strong>New</strong> story</span>
                <span><strong>0</strong> scenes</span>
                <span><strong>0</strong> memories</span>
                <span><strong>Self</strong> pinned</span>
              </div>
            </div>
          </div>
        </article>

        <div className={`character-detail-sections${selectedIsSelf ? ' self-character-section-order' : ''}`}>
          <CharacterDetailSection
            id="identity"
            title="Identity"
            summary="Reference photos, voice, and style setup"
            expanded={detailSectionIsOpen('identity')}
            onToggle={toggleDetailSection}
          >
            {children || (
              <article className="list-card lumora-card-soft" style={{ borderRadius: '18px', padding: '14px' }}>
                <p className="muted">Loading self character editor...</p>
              </article>
            )}
          </CharacterDetailSection>
        </div>
      </section>
      </CharacterHubFrame>
    );
  }

  if (selectedCharacter) {
    const refs = characterReferenceEntries(selectedCharacter);
    const savedRefs = refs.filter((entry) => entry.url);
    const memoryEntries = Object.entries(selectedCharacter.continuityState ?? {})
      .filter(([, value]) => Boolean(value))
      .slice(0, 8);
    const styleEntries = stylePreferenceEntries(selectedCharacter);
    const orchestrationEntries = orchestrationMemoryEntries(selectedCharacter);
    const continuityConfidence = latestContinuityConfidence(selectedCharacter);
    const appearanceHero = summaryText(
      selectedCharacter.appearanceSummary,
      selectedCharacter.continuityState?.characterAppearance,
      selectedCharacter.identityProfile?.appearanceSummary,
    ) || 'No appearance summary saved yet.';
    const sceneAppearances = uniqueSceneCount(selectedCharacter);
    const memorySnapshotCount = selectedCharacter.memorySnapshots?.length ?? 0;
    const selectedIdentityCard = buildCreatorIdentityCard({
      profile: {
        displayName: displayName(selectedCharacter),
        username: 'lumora.creator',
        bio: selectedCharacter.appearanceSummary ?? '',
      },
      characters: [selectedCharacter],
    });
    const exactRouteReady = Boolean(likenessDiagnostics?.exactLikenessRouter?.exactLikeness) ||
      selectedCharacter.videoReferenceRouteStatus === 'canary_succeeded' ||
      (selectedCharacter.providerCharacterStatus === 'ready' && selectedCharacter.likenessProviderStatus === 'canary_succeeded');
    const effectiveVerificationVideoPresent = hasEffectiveSelfVerificationVideo(selectedCharacter);
    const usingLegacySelfCapture = hasLegacySelfCaptureVideo(selectedCharacter) && !selectedCharacter.verificationVideoPresent;
    const verificationStatusLabel = selfVerificationVideoStatusLabel(selectedCharacter);
    const exactStatusLabel = exactLikenessRouteStatusLabel(selectedCharacter, exactRouteReady);
    const seedanceVideoEntry = likenessRegistryEntry(likenessDiagnostics, 'seedance_video_reference');
    const probeEnabled = Boolean(likenessDiagnostics?.renderSuccessEngine?.probeEnabled);
    const exactCanaryAvailable = Boolean(
      probeEnabled &&
      effectiveVerificationVideoPresent &&
      seedanceVideoEntry?.implementationStatus === 'configured_ready_for_canary',
    );
    const exactCanaryUnavailableCopy = !probeEnabled
      ? 'Exact likeness testing is not available yet.'
      : !effectiveVerificationVideoPresent
        ? 'Upload a self verification video before testing exact likeness routes.'
        : 'Exact likeness testing is not available yet.';
    const uploadVerificationButtonLabel = effectiveVerificationVideoPresent
      ? 'Replace video'
      : 'Upload self verification video';
    const selfVerificationPanel = selectedIsSelf ? (
      <section
        id="self-verification-video-panel"
        className="self-verification-panel self-verification-panel-feature"
        aria-labelledby="self-verification-video-title"
      >
        <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <span className="eyebrow">private self character media</span>
            <h3 id="self-verification-video-title">Self Verification Video</h3>
            <p className="muted">
              Upload a short private video so Lumora can test stronger self-character likeness routes.
            </p>
          </div>
          <span className="tiny-pill">{verificationStatusLabel}</span>
        </div>
        <ul className="self-verification-instructions">
          <li>Look forward at the camera</li>
          <li>Say 3 pairs of two-digit numbers</li>
          <li>Turn your head slightly right</li>
          <li>Turn your head slightly left</li>
          <li>Return to center</li>
          <li>Use clear lighting</li>
          <li>No filters</li>
          <li>Fully clothed</li>
        </ul>
        <div className="self-verification-status-row">
          <span>Status</span>
          <strong>{verificationStatusLabel}</strong>
        </div>
        {effectiveVerificationVideoPresent ? (
          <p className="muted">
            {usingLegacySelfCapture
              ? 'Private verification video saved from your previous self capture. Replace it here any time.'
              : 'Private verification video saved.'}
          </p>
        ) : null}
        {verificationVideoFile ? (
          <p className="muted">Selected: {verificationVideoFile.name}</p>
        ) : null}
        <input
          ref={verificationVideoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          style={{ display: 'none' }}
          onChange={(event) => void handleVerificationVideoFile(event.target.files?.[0])}
        />
        <label className="checkbox-row" style={{ alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={verificationAudioPresent}
            onChange={(event) => setVerificationAudioPresent(event.target.checked)}
          />
          <span>Audio is present in this verification video.</span>
        </label>
        <label className="checkbox-row" style={{ alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={verificationVideoConsent}
            onChange={(event) => setVerificationVideoConsent(event.target.checked)}
          />
          <span>I confirm this is me and I consent to using this recording to create my Lumora self character.</span>
        </label>
        <div className="button-row self-verification-actions">
          <button
            type="button"
            className={effectiveVerificationVideoPresent ? 'ghost-btn self-verification-upload-btn' : 'primary-btn self-verification-upload-btn'}
            disabled={verificationVideoSaving}
            onClick={() => verificationVideoInputRef.current?.click()}
          >
            {uploadVerificationButtonLabel}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={verificationVideoSaving || !verificationVideoFile || !verificationVideoConsent}
            onClick={() => void handleSaveSelfVerificationVideo()}
          >
            {verificationVideoSaving ? 'Saving video...' : 'Save private verification video'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled
            title="Browser recording is coming soon. Upload is available now."
          >
            Record video coming soon
          </button>
          {effectiveVerificationVideoPresent ? (
            <button
              type="button"
              className="text-btn"
              disabled={verificationVideoSaving}
              onClick={() => void handleRemoveSelfVerificationVideo()}
            >
              Remove video
            </button>
          ) : null}
        </div>
        {verificationVideoStatus ? <p className="muted">{verificationVideoStatus}</p> : null}
        <p className="muted">Verification videos stay private. They are never published or used as thumbnails.</p>
      </section>
    ) : null;

    return (
      <CharacterHubFrame onClose={onClose}>
      <section className="character-hub-view character-detail-page">
        <div className="character-detail-topbar">
          <button type="button" className="text-btn" onClick={returnToList}>
            Back
          </button>
          <div className="character-detail-actions">
            {castMode ? (
              <button
                type="button"
                className="primary-btn cast-character-btn"
                onClick={() => onCast?.(selectedCharacter)}
              >
                Cast
              </button>
            ) : null}
            <button
              type="button"
              className="character-actions-button"
              aria-label="Character actions"
              onClick={() => setActionsOpen(true)}
            >
              ...
            </button>
          </div>
        </div>

        <article className="character-detail-hero">
          <div className="character-detail-identity">
            <CharacterThumbnail character={selectedCharacter} size={104} />
            <div style={{ minWidth: 0 }}>
              <span className="tiny-pill">{selectedIsSelf ? 'Self' : 'Cast member'}</span>
              <h2 style={{ margin: '8px 0 0' }}>{displayName(selectedCharacter)}</h2>
              <p className="character-hero-summary">{appearanceHero}</p>
              <div className="character-quick-stats" aria-label="Character quick stats">
                <span><strong>{formatPercent(continuityConfidence)}</strong> story</span>
                <span><strong>{sceneAppearances}</strong> scenes</span>
                <span><strong>{memorySnapshotCount}</strong> memories</span>
                <span><strong>{orchestrationEntries.length}</strong> style notes</span>
              </div>
            </div>
          </div>
        </article>

        {selectedIsSelf ? (
          <CreatorIdentityCard card={selectedIdentityCard} compact />
        ) : null}

        {selectedIsSelf ? (
          <section className="self-setup-wizard" aria-labelledby="self-character-setup-title">
            <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <span className="eyebrow">private identity setup</span>
                <h3 id="self-character-setup-title">Self Character Setup</h3>
              </div>
              <span className="tiny-pill">{exactRouteReady ? 'Exact route ready' : 'Soft guidance ready'}</span>
            </div>
            <div className="self-setup-card-grid">
              <article className="self-setup-status-card">
                <strong>Saved Look</strong>
                <span>{savedRefs.length ? `${savedRefs.length} photo reference${savedRefs.length === 1 ? '' : 's'}` : 'Needs photos'}</span>
                <p>Saved photos stay private and help future likeness routes.</p>
              </article>
              <article className="self-setup-status-card">
                <strong>Self Verification Video</strong>
                <span>{verificationStatusLabel}</span>
                <p>Private identity material for stronger self-character canaries.</p>
              </article>
              <article className="self-setup-status-card">
                <strong>Exact Likeness Route</strong>
                <span>{exactStatusLabel}</span>
                <p>{providerIdentityStatusCopy(selectedCharacter)}</p>
              </article>
              <article className="self-setup-status-card is-ready">
                <strong>Soft Self Guidance</strong>
                <span>Ready</span>
                <p>Lumora can generate text-first AI cast videos now.</p>
              </article>
            </div>
          </section>
        ) : null}

        {selfVerificationPanel}

        <div className="character-detail-sections">
          {!selectedIsSelf ? (
            <CharacterDetailSection
              id="identity"
              title="Identity"
              summary={`${selectedCharacter.status} / ${selectedCharacter.visibility.replace('_', ' ')}`}
              expanded={detailSectionIsOpen('identity')}
              onToggle={toggleDetailSection}
            >
              <div className="character-compact-form">
                <label className="field-block">
                  <span>Display name</span>
                  <input value={editorName} onChange={(event) => setEditorName(event.target.value)} />
                </label>
                {metadataLine('Profile', `${selectedCharacter.status} / ${selectedCharacter.visibility.replace('_', ' ')}`)}
              </div>
            </CharacterDetailSection>
          ) : null}

          {selectedIsSelf ? (
            <CharacterDetailSection
              id="providerIdentity"
              title="Exact Provider Character"
              summary={`Exact route: ${exactStatusLabel}`}
              expanded={detailSectionIsOpen('providerIdentity')}
              onToggle={toggleDetailSection}
            >
              <div className="character-compact-form">
                <div className="character-memory-viewer character-section-card">
                  <strong>Exact provider character</strong>
                  <p className="muted">
                    This is separate from the private verification video. Use it only when a configured provider supports a verified self-character setup route.
                  </p>
                  <label className="field-block">
                    <span>Provider identity video</span>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(event) => setSoraIdentityFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label className="checkbox-row" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={soraIdentityConsent}
                      onChange={(event) => setSoraIdentityConsent(event.target.checked)}
                    />
                    <span>I confirm this is me and I consent to using this recording to create my Lumora self character.</span>
                  </label>
                  <div className="button-row">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={soraIdentitySaving}
                      onClick={() => void handleCreateSoraSelfCharacter()}
                    >
                      {soraIdentitySaving ? 'Checking route...' : 'Create verified self character'}
                    </button>
                  </div>
                  {soraIdentityStatus ? <p className="muted">{soraIdentityStatus}</p> : null}
                  <p className="muted">Provider deletion is unavailable until the configured provider exposes a supported delete route.</p>
                </div>
              </div>
            </CharacterDetailSection>
          ) : null}

          {selectedIsSelf ? (
            <CharacterDetailSection
              id="likenessLab"
              title="Likeness Lab"
              summary={`Exact likeness: ${likenessDiagnostics?.exactLikenessRouter?.exactLikeness ? 'ready' : 'soft guidance'}`}
              expanded={detailSectionIsOpen('likenessLab')}
              onToggle={toggleDetailSection}
            >
              <div className="character-compact-form">
                <div className="character-memory-viewer character-section-card">
                  {metadataLine('Soft self guidance', 'Available')}
                  {metadataLine(
                    'Self verification video',
                    effectiveVerificationVideoPresent
                      ? providerLabStatus(likenessDiagnostics, 'seedance_video_reference')
                      : 'Record video to test',
                  )}
                  {metadataLine(
                    'Seedance references',
                    likenessDiagnostics?.referenceRouteStatus?.seedanceReferenceRoutesBlocked ? 'Blocked' : 'Saved; needs route canary',
                  )}
                  {metadataLine('Runway', providerLabStatus(likenessDiagnostics, 'runway_gen4_reference'))}
                  {metadataLine('Kling', providerLabStatus(likenessDiagnostics, 'kling_reference'))}
                  {metadataLine('OpenAI/Sora', `${providerLabStatus(likenessDiagnostics, 'openai_sora_character')} / deprecated bridge`)}
                  {metadataLine('Lumora Identity Pack', 'Research only')}
                  <p className="muted">
                    {likenessDiagnostics?.exactLikenessRouter?.reason || 'Lumora will use soft self guidance until an exact provider canary succeeds.'}
                  </p>
                </div>
                <div className="button-row">
                  {exactCanaryAvailable ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={likenessCanaryBusy !== null}
                      onClick={() => void handleSeedanceVideoReferenceCanary()}
                    >
                      {likenessCanaryBusy === 'seedance-video' ? 'Checking route...' : 'Run exact likeness canary'}
                    </button>
                  ) : (
                    <span className="muted">{exactCanaryUnavailableCopy}</span>
                  )}
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setLikenessLabStatus('Soft self guidance remains available for reliable videos.')}
                  >
                    Use soft self guidance
                  </button>
                </div>
                {likenessLabStatus ? <p className="muted">{likenessLabStatus}</p> : null}
                <p className="muted">Paid tests require confirmation and never enable production routing until the canary succeeds.</p>
              </div>
            </CharacterDetailSection>
          ) : null}

          <CharacterDetailSection
            id="appearance"
            title="Appearance"
            summary={appearanceHero}
            expanded={detailSectionIsOpen('appearance')}
            onToggle={toggleDetailSection}
          >
            {selectedIsSelf ? (
              <div className="character-memory-viewer character-section-card">
                {metadataLine('Appearance', selectedCharacter.appearanceSummary)}
                {metadataLine('Wardrobe', selectedCharacter.wardrobeTendencies)}
                {metadataLine('Emotional tone', selectedCharacter.emotionalTendencies)}
                {!selectedCharacter.appearanceSummary && !selectedCharacter.wardrobeTendencies && !selectedCharacter.emotionalTendencies ? (
                  <p className="muted">No appearance memory saved yet.</p>
                ) : null}
              </div>
            ) : (
              <div className="character-compact-form">
                <label className="field-block">
                  <span>Appearance summary</span>
                  <textarea value={appearanceSummary} onChange={(event) => setAppearanceSummary(event.target.value)} rows={2} />
                </label>
                <label className="field-block">
                  <span>Wardrobe tendencies</span>
                  <input value={wardrobeTendencies} onChange={(event) => setWardrobeTendencies(event.target.value)} />
                </label>
                <label className="field-block">
                  <span>Emotional tendencies</span>
                  <input value={emotionalTendencies} onChange={(event) => setEmotionalTendencies(event.target.value)} />
                </label>
              </div>
            )}
          </CharacterDetailSection>

          <CharacterDetailSection
            id="style"
            title="Style"
            summary={summaryText(cinematicStyle, selectedCharacter.cinematicStyle, styleEntries[0]?.[1]) || 'No style saved yet.'}
            expanded={detailSectionIsOpen('style')}
            onToggle={toggleDetailSection}
          >
            <div className="character-compact-form">
              {!selectedIsSelf ? (
                <>
                  <label className="field-block">
                    <span>Cinematic style</span>
                    <input value={cinematicStyle} onChange={(event) => setCinematicStyle(event.target.value)} />
                  </label>
                  <label className="field-block">
                    <span>Soundtrack tendencies</span>
                    <input value={soundtrackTendencies} onChange={(event) => setSoundtrackTendencies(event.target.value)} />
                  </label>
                </>
              ) : null}
              {styleEntries.length ? (
                <div className="character-memory-viewer character-section-card">
                  {styleEntries.map(([label, value]) => (
                    <p key={label}><strong>{label}</strong> {value}</p>
                  ))}
                </div>
              ) : (
                <p className="muted">No style preferences saved yet.</p>
              )}
            </div>
          </CharacterDetailSection>

          <CharacterDetailSection
            id="voice"
            title="Voice"
            summary={summaryText(selectedCharacter.voiceSampleName, selectedCharacter.voiceSampleNumbers, selectedCharacter.sourceCaptureVideo2Name) || 'No voice media saved yet.'}
            expanded={detailSectionIsOpen('voice')}
            onToggle={toggleDetailSection}
          >
            <div className="character-memory-viewer character-section-card">
              {metadataLine('Soundtrack', selectedCharacter.soundtrackTendencies)}
              {metadataLine('Voice sample', selectedCharacter.voiceSampleName || selectedCharacter.voiceSampleNumbers || selectedCharacter.voiceSampleUrl)}
              {metadataLine('Source capture', selectedCharacter.sourceCaptureVideo2Name || selectedCharacter.sourceCaptureVideoUrl)}
              {!selectedCharacter.soundtrackTendencies && !selectedCharacter.voiceSampleUrl && !selectedCharacter.sourceCaptureVideoUrl ? (
                <p className="muted">No voice or profile media saved yet.</p>
              ) : null}
            </div>
          </CharacterDetailSection>

          <CharacterDetailSection
            id="memory"
            title="Story Memory"
            summary={`${formatPercent(continuityConfidence)} story hold / ${memorySnapshotCount} memories`}
            expanded={detailSectionIsOpen('memory')}
            onToggle={toggleDetailSection}
          >
            <div className="character-compact-form">
              {!selectedIsSelf ? (
                <label className="field-block">
                  <span>Relationship notes</span>
                  <textarea value={relationshipNotes} onChange={(event) => setRelationshipNotes(event.target.value)} rows={2} />
                </label>
              ) : null}
              <div className="character-memory-viewer character-section-card">
                {memoryEntries.length ? (
                  memoryEntries.map(([field, value]) => (
                    <p key={field}><strong>{field}</strong> {String(value)}</p>
                  ))
                ) : (
                  <p className="muted">No Story Memory captured yet.</p>
                )}
                {(selectedCharacter.memorySnapshots ?? []).slice(0, 3).map((snapshot) => (
                  <p key={`${snapshot.sceneExecutionId}-${snapshot.sceneId}-${snapshot.clipOrder}`}>
                    <strong>{snapshot.continuityConfidence ? `${Math.round(snapshot.continuityConfidence * 100)}%` : 'Memory'}</strong> {snapshot.summary}
                  </p>
                ))}
              </div>
              <div className="character-memory-viewer character-section-card">
                <span className="eyebrow">cinematic safety</span>
                {orchestrationEntries.length ? (
                  orchestrationEntries.map(([label, value]) => (
                    <p key={label}><strong>{label}</strong> {value}</p>
                  ))
                ) : (
                  <p className="muted">No cinematic safety notes saved yet.</p>
                )}
              </div>
            </div>
          </CharacterDetailSection>

          <CharacterDetailSection
            id="references"
            title="References"
            summary={savedRefs.length ? `${savedRefs.length} saved references` : 'No references saved yet.'}
            expanded={detailSectionIsOpen('references')}
            onToggle={toggleDetailSection}
          >
            <p className="muted" style={{ marginTop: 0 }}>
              Photo references are private saved-look assets. They are different from the Self Verification Video and are never public posts.
            </p>
            {refs.length ? (
              <div className="character-reference-grid">
                {refs.map((entry) => {
                  const manualOverride = entry.slot === 'manualReferenceImageUrl';
                  return (
                    <div key={entry.slot} className={`character-reference-item ${entry.status.kind} ${manualOverride ? 'is-manual-override' : ''}`}>
                      {entry.url ? (
                        <img src={entry.url} alt={`${displayName(selectedCharacter)} ${entry.label}`} />
                      ) : (
                        <div className="reference-placeholder">{entry.optional ? 'Optional' : 'Missing'}</div>
                      )}
                      <div className="reference-card-copy">
                        <span>{manualOverride ? 'Old temporary reference' : entry.label}</span>
                        <span className={`reference-status-badge ${entry.status.kind}`}>{entry.status.label}</span>
                        <small>
                          {manualOverride
                            ? 'This override is no longer required. Remove it without deleting saved Lumora photos.'
                            : entry.status.detail}
                        </small>
                      </div>
                      <div className="reference-card-actions">
                        {!manualOverride && !selectedIsSelf ? (
                          <button
                            type="button"
                            className="text-btn"
                            disabled={referenceRepairSaving}
                            onClick={() => startReferenceRepair(entry)}
                          >
                            Replace
                          </button>
                        ) : null}
                        {entry.removable ? (
                          <button
                            type="button"
                            className="text-btn"
                            disabled={referenceRepairSaving}
                            onClick={() => void handleRemoveReference(entry)}
                          >
                            {manualOverride ? 'Remove old reference' : 'Remove'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted">No reference photos saved yet.</p>
            )}
            {selectedIsSelf ? (
              <div className="button-row">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setExpandedSections((current): DetailSectionKey[] => {
                      const next: DetailSectionKey[] = ['identity', ...current.filter((section) => section !== 'identity')];
                      return next.slice(0, 2);
                    });
                    void onEditSelf();
                  }}
                >
                  Edit saved look photos
                </button>
                {refs.some((entry) => entry.slot === 'manualReferenceImageUrl' && entry.removable) ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={referenceRepairSaving}
                    onClick={() => {
                      const manualEntry = refs.find((entry) => entry.slot === 'manualReferenceImageUrl' && entry.removable);
                      if (manualEntry) void handleRemoveReference(manualEntry);
                    }}
                  >
                    Remove old manual reference override
                  </button>
                ) : null}
              </div>
            ) : null}
            <input
              ref={referenceRepairInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(event) => void handleReferenceRepairFile(event.target.files?.[0])}
            />
            {referenceRepairStatus ? <p className="muted">{referenceRepairStatus}</p> : null}
          </CharacterDetailSection>

          {selectedIsSelf ? (
            <CharacterDetailSection
              id="identity"
              title="Saved Look Editor"
              summary="Reference photos and profile setup"
              expanded={detailSectionIsOpen('identity')}
              onToggle={toggleDetailSection}
            >
              {children || (
                <article className="list-card lumora-card-soft" style={{ borderRadius: '18px', padding: '14px' }}>
                  <p className="muted">Loading self character editor...</p>
                </article>
              )}
            </CharacterDetailSection>
          ) : null}

          {!selectedIsSelf ? (
            <div className="character-detail-save-row">
              <button type="button" className="ghost-btn" onClick={() => void handleSaveProfile()} disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save cast member'}
              </button>
              {editorStatus ? <p className="muted">{editorStatus}</p> : null}
            </div>
          ) : null}
        </div>

        {actionsOpen ? (
          <ModalShell>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div className="row-between">
                <strong>Cast actions</strong>
                <button type="button" className="text-btn" onClick={() => setActionsOpen(false)}>
                  Cancel
                </button>
              </div>
              {selectedIsSelf ? (
                <p className="muted">Self character deletion is disabled in v1.</p>
              ) : (
                <button
                  type="button"
                  className="ghost-btn"
                  style={{ color: 'var(--danger-text, #ff6b81)' }}
                  onClick={() => {
                    setActionsOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Delete Character
                </button>
              )}
              <button type="button" className="ghost-btn" onClick={() => setActionsOpen(false)}>
                Cancel
              </button>
            </div>
          </ModalShell>
        ) : null}

        {confirmDeleteOpen ? (
          <ModalShell>
            <div style={{ display: 'grid', gap: '12px' }}>
              <h3 style={{ margin: 0 }}>Delete character?</h3>
              <p className="muted" style={{ margin: 0 }}>
                This permanently removes the reusable cast profile and Story Memory from Lumora.
              </p>
              {deleteStatus ? <p className="muted">{deleteStatus}</p> : null}
              <div className="button-row">
                <button
                  type="button"
                  className="primary-btn"
                  style={{ background: 'linear-gradient(135deg, #ff5b74, #b92746)' }}
                  onClick={() => void handleConfirmDelete()}
                  disabled={deletingCharacter}
                >
                  {deletingCharacter ? 'Deleting...' : 'Confirm Delete Character'}
                </button>
                <button type="button" className="ghost-btn" onClick={() => setConfirmDeleteOpen(false)} disabled={deletingCharacter}>
                  Cancel
                </button>
              </div>
            </div>
          </ModalShell>
        ) : null}
      </section>
      </CharacterHubFrame>
    );
  }

  return (
    <CharacterHubFrame onClose={onClose}>
    <section className="character-hub-view character-list-view">
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">AI cast studio</span>
          <h2 style={{ marginTop: '8px' }}>Your AI Cast</h2>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Reusable AI cast members for generated scenes. Self character media stays private; public posts are Lumora-generated videos only.
          </p>
        </div>
      </div>

      <div className="row-between" style={{ gap: '12px', flexWrap: 'wrap' }}>
        <span className="tiny-pill">{Math.min(characters.length, characterLimit)} / {characterLimit}</span>
        {!atCharacterLimit ? (
          <button type="button" className="ghost-btn" style={{ flex: 'unset' }} onClick={() => setCreatingCharacter(true)}>
            Create cast member
          </button>
        ) : (
          <span className="muted">You've reached the 25 character limit.</span>
        )}
      </div>

      <div className="character-list-stack">
        <span className="eyebrow">Self Character</span>
        {selfCharacter ? (
          <button
            type="button"
            className="character-cast-row character-cast-row-self"
            role="button"
            onClick={() => openCharacterDetail(selfCharacter)}
          >
            <CharacterThumbnail character={selfCharacter} />
            <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(selfCharacter)}</strong>
            <span className="tiny-pill">Self</span>
          </button>
        ) : (
          <button
            type="button"
            className="character-cast-row character-cast-row-self"
            role="button"
            onClick={openSelfSetup}
          >
            <span className="character-avatar" style={{ width: '56px', height: '56px', borderRadius: '18px' }}>S</span>
            <strong>Create your self character</strong>
            <span className="tiny-pill">Self</span>
          </button>
        )}

        {visibleCharacters.some((character) => !characterIsSelf(character)) ? (
          <span className="eyebrow">Cast Members</span>
        ) : null}
        {visibleCharacters.filter((character) => !characterIsSelf(character)).map((character) => (
          <button
            key={character.id}
            type="button"
            className="character-cast-row"
            role="button"
            onClick={() => openCharacterDetail(character)}
          >
            <CharacterThumbnail character={character} />
            <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(character)}</strong>
          </button>
        ))}

        {!visibleCharacters.length ? (
          <article className="list-card lumora-card lumora-empty-state" style={{ borderRadius: '22px', padding: '16px' }}>
            <h3>Build your reusable AI cast.</h3>
            <p className="muted">Create a self character and cast members you can bring back across story worlds.</p>
          </article>
        ) : null}
      </div>
    </section>
    </CharacterHubFrame>
  );
}
