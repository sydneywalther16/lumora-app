import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type CharacterProfile, type CharacterRelationshipMemory, type ReferenceImageUrls } from '../lib/api';
import { deleteLocalCharacterProfile, updateLocalCharacterProfile } from '../lib/characterStorage';
import { getBestThumbnail } from '../lib/mediaThumbnail';
import {
  deleteSupabaseCharacterProfile,
  loadSupabaseCharacters,
  updateSupabaseCharacterProfile,
} from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';
import CharacterCapture from './CharacterCapture';

type CharacterHubProps = {
  open: boolean;
  characters: CharacterProfile[];
  onClose: () => void;
  onEditSelf: () => void | Promise<void>;
  onRefresh: (characters?: CharacterProfile[]) => void | Promise<void>;
  children?: ReactNode;
};

type DetailSectionKey = 'identity' | 'appearance' | 'style' | 'voice' | 'memory' | 'references';

const characterLimit = 25;
const characterProfilesMigrationWarning = 'Cast needs the latest database update.';

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

function referenceEntries(character: CharacterProfile) {
  const references = character.referenceImageUrls ?? {} as ReferenceImageUrls;
  return [
    ['Front', references.frontFaceUrl || references.frontFace],
    ['Left', references.leftAngleUrl || references.leftAngle],
    ['Right', references.rightAngleUrl || references.rightAngle],
    ['Full body', references.fullBodyUrl || references.fullBody],
    ['Expression', references.expressiveUrl || references.expressive],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0);
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
    ['Rendering mode', preferences.renderingMode ?? preferences.realismMode ?? preferences.preferredRenderingMode],
    ['Successful fallback', preferences.successfulFallbackPath ?? preferences.lastSuccessfulFallbackPath],
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
      <div className="character-hub-panel" role="dialog" aria-modal="true" aria-label="Characters">
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
    <section className={`character-accordion-section${expanded ? ' is-open' : ''}`}>
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
  const atCharacterLimit = characters.length >= characterLimit;

  useEffect(() => {
    if (!open) {
      setSelectedCharacterId(null);
      setCreatingCharacter(false);
      setSelfSetupOpen(false);
      setActionsOpen(false);
      setConfirmDeleteOpen(false);
      setDeleteStatus('');
    }
  }, [open]);

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
    setExpandedSections(characterIsSelf(selectedCharacter) ? ['memory'] : ['appearance', 'memory']);
  }, [selectedCharacter]);

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
      return;
    }
    await onRefresh();
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
              Add a reusable cinematic identity to your cast.
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
                Build the pinned identity Lumora can reuse across your cinematic scenes.
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

        <div className="character-detail-sections">
          <CharacterDetailSection
            id="identity"
            title="Identity"
            summary="Reference photos, voice, and style setup"
            expanded={detailSectionIsOpen('identity')}
            onToggle={toggleDetailSection}
          >
            {children || (
              <article className="list-card" style={{ borderRadius: '18px', padding: '14px' }}>
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
    const refs = referenceEntries(selectedCharacter);
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

    return (
      <CharacterHubFrame onClose={onClose}>
      <section className="character-hub-view character-detail-page">
        <div className="character-detail-topbar">
          <button type="button" className="text-btn" onClick={returnToList}>
            Back
          </button>
          <div className="character-detail-actions">
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
                <span><strong>{orchestrationEntries.length}</strong> adaptations</span>
              </div>
            </div>
          </div>
        </article>

        <div className="character-detail-sections">
          <CharacterDetailSection
            id="identity"
            title="Identity"
            summary={`${selectedCharacter.status} / ${selectedCharacter.visibility.replace('_', ' ')}`}
            expanded={detailSectionIsOpen('identity')}
            onToggle={toggleDetailSection}
          >
            {selectedIsSelf ? (
              children || (
                <article className="list-card" style={{ borderRadius: '18px', padding: '14px' }}>
                  <p className="muted">Loading self character editor...</p>
                </article>
              )
            ) : (
              <div className="character-compact-form">
                <label className="field-block">
                  <span>Display name</span>
                  <input value={editorName} onChange={(event) => setEditorName(event.target.value)} />
                </label>
                {metadataLine('Profile', `${selectedCharacter.status} / ${selectedCharacter.visibility.replace('_', ' ')}`)}
              </div>
            )}
          </CharacterDetailSection>

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
                <span className="eyebrow">creative adaptation</span>
                {orchestrationEntries.length ? (
                  orchestrationEntries.map(([label, value]) => (
                    <p key={label}><strong>{label}</strong> {value}</p>
                  ))
                ) : (
                  <p className="muted">No creative adaptation notes saved yet.</p>
                )}
              </div>
            </div>
          </CharacterDetailSection>

          <CharacterDetailSection
            id="references"
            title="References"
            summary={refs.length ? `${refs.length} saved references` : 'No references saved yet.'}
            expanded={detailSectionIsOpen('references')}
            onToggle={toggleDetailSection}
          >
            {refs.length ? (
              <div className="character-reference-grid">
                {refs.map(([label, url]) => (
                  <div key={`${label}-${url}`} className="character-reference-item">
                    <img src={url} alt={`${displayName(selectedCharacter)} ${label}`} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No reference photos saved yet.</p>
            )}
          </CharacterDetailSection>

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
          <span className="eyebrow">cast</span>
          <h2 style={{ marginTop: '8px' }}>Characters</h2>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Build your reusable cinematic cast.
          </p>
        </div>
      </div>

      <div className="row-between" style={{ gap: '12px', flexWrap: 'wrap' }}>
        <span className="tiny-pill">{Math.min(characters.length, characterLimit)} / {characterLimit}</span>
        {!atCharacterLimit ? (
          <button type="button" className="ghost-btn" style={{ flex: 'unset' }} onClick={() => setCreatingCharacter(true)}>
            Create character
          </button>
        ) : (
          <span className="muted">You've reached the 25 character limit.</span>
        )}
      </div>

      <div className="character-list-stack">
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
          <article className="list-card" style={{ borderRadius: '22px', padding: '16px' }}>
            <h3>Build your reusable cinematic cast.</h3>
            <p className="muted">Create self and cast members you can bring back across scenes.</p>
          </article>
        ) : null}
      </div>
    </section>
    </CharacterHubFrame>
  );
}
