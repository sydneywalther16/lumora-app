import { useEffect, useState } from 'react';
import { type CharacterProfile, type CharacterRelationshipMemory } from '../lib/api';
import { getStoredCharacters, isCreatorSelfCharacter, updateLocalCharacterProfile } from '../lib/characterStorage';
import { useSession } from '../hooks/useSession';
import { loadSupabaseCharacters, updateSupabaseCharacterProfile } from '../lib/supabaseAppData';
import SelfReferencePreview, { normalizeReference } from './SelfReferencePreview';

type CharacterLibraryProps = {
  selectedCharacterId?: string | null;
  onSelect?: (character: CharacterProfile | null) => void;
  refreshKey?: number;
};

function characterInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'C';
}

const characterProfilesMigrationWarning = 'Character Profiles need the latest database migration.';

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

  return error instanceof Error ? error.message : 'Unable to save character profile.';
}

export default function CharacterLibrary({
  selectedCharacterId,
  onSelect,
  refreshKey = 0,
}: CharacterLibraryProps) {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [status, setStatus] = useState('Loading characters...');
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? null;
  const [editorName, setEditorName] = useState('');
  const [appearanceSummary, setAppearanceSummary] = useState('');
  const [wardrobeTendencies, setWardrobeTendencies] = useState('');
  const [emotionalTendencies, setEmotionalTendencies] = useState('');
  const [soundtrackTendencies, setSoundtrackTendencies] = useState('');
  const [cinematicStyle, setCinematicStyle] = useState('');
  const [relationshipNotes, setRelationshipNotes] = useState('');
  const [editorStatus, setEditorStatus] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadCharacters() {
      if (configured && loading && !authUser) {
        setStatus('Loading characters...');
        return;
      }

      try {
        const loaded = authUser
          ? await loadSupabaseCharacters(authUser.id)
          : getStoredCharacters();
        const fictionalCharacters = loaded.filter((character) => !isCreatorSelfCharacter(character));

        if (!active) return;
        setCharacters(fictionalCharacters);
        setStatus(fictionalCharacters.length ? '' : 'No fictional characters saved yet');
      } catch (error) {
        if (!active) return;
        setCharacters([]);
        setStatus(error instanceof Error ? error.message : 'Unable to load characters.');
      }
    }

    void loadCharacters();

    return () => {
      active = false;
    };
  }, [authUser, configured, loading, refreshKey]);

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

    setEditorName(selectedCharacter.displayName || selectedCharacter.name);
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
  }, [selectedCharacter]);

  async function handleSaveProfile() {
    if (!selectedCharacter) return;

    setSavingProfile(true);
    setEditorStatus('Saving character profile...');

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

      if (!updated) throw new Error('Character profile not found.');

      setCharacters((current) => current.map((character) => (
        character.id === updated.id ? updated : character
      )));
      onSelect?.(updated);
      setEditorStatus('Character profile saved.');
    } catch (error) {
      setEditorStatus(characterProfileEditorError(error));
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <section className="editor-card character-library">
      <div className="row-between">
        <div>
          <span className="eyebrow">characters</span>
          <h3>Saved character profiles</h3>
        </div>
        {onSelect ? (
          <button type="button" className="text-btn" onClick={() => onSelect(null)}>
            None
          </button>
        ) : null}
      </div>

      {status ? <p className="muted">{status}</p> : null}

      <div className="character-grid">
        {characters.map((character) => {
          const selected = selectedCharacterId === character.id;
          return (
            <button
              key={character.id}
              type="button"
              className={`character-tile ${selected ? 'selected' : ''}`}
              disabled={!onSelect}
              title={onSelect ? `Select ${character.name}` : 'Open Create to select this character'}
              onClick={() => onSelect?.(character)}
            >
              <span className="character-avatar">
                {character.referenceImageUrls.frontFaceUrl ||
                character.referenceImageUrls.frontFacePath ||
                character.referenceImageUrls.frontFace ? (
                  <SelfReferencePreview
                    label={`${character.name} front reference`}
                    reference={normalizeReference(
                      {
                        ...character.referenceImageUrls,
                        frontFaceUrl:
                          character.referenceImageUrls.frontFaceUrl ||
                          character.referenceImageUrls.frontFace,
                      },
                      'frontFaceUrl',
                      'frontFacePath',
                    )}
                  />
                ) : (
                  characterInitial(character.name)
                )}
              </span>
              <span className="character-copy">
                <strong>{character.name}</strong>
                <span>{character.status} - {character.visibility.replace('_', ' ')}</span>
              </span>
            </button>
          );
        })}
      </div>

      {selectedCharacter ? (
        <div className="character-profile-editor">
          <div className="row-between">
            <div>
              <span className="eyebrow">profile</span>
              <strong>Character memory</strong>
            </div>
            <span className="tiny-pill">Cast member</span>
          </div>

          <label className="field-block">
            <span>Display name</span>
            <input value={editorName} onChange={(event) => setEditorName(event.target.value)} />
          </label>

          <label className="field-block">
            <span>Appearance summary</span>
            <textarea
              value={appearanceSummary}
              onChange={(event) => setAppearanceSummary(event.target.value)}
              rows={3}
            />
          </label>

          <label className="field-block">
            <span>Wardrobe tendencies</span>
            <input value={wardrobeTendencies} onChange={(event) => setWardrobeTendencies(event.target.value)} />
          </label>

          <label className="field-block">
            <span>Emotional tendencies</span>
            <input value={emotionalTendencies} onChange={(event) => setEmotionalTendencies(event.target.value)} />
          </label>

          <label className="field-block">
            <span>Soundtrack tendencies</span>
            <input value={soundtrackTendencies} onChange={(event) => setSoundtrackTendencies(event.target.value)} />
          </label>

          <label className="field-block">
            <span>Cinematic style</span>
            <input value={cinematicStyle} onChange={(event) => setCinematicStyle(event.target.value)} />
          </label>

          <label className="field-block">
            <span>Relationship memory</span>
            <textarea
              value={relationshipNotes}
              onChange={(event) => setRelationshipNotes(event.target.value)}
              rows={3}
            />
          </label>

          <div className="character-memory-viewer">
            <span className="eyebrow">continuity</span>
            {Object.entries(selectedCharacter.continuityState ?? {}).filter(([, value]) => Boolean(value)).length ? (
              Object.entries(selectedCharacter.continuityState ?? {})
                .filter(([, value]) => Boolean(value))
                .slice(0, 5)
                .map(([field, value]) => (
                  <p key={field}><strong>{field}</strong> {String(value)}</p>
                ))
            ) : (
              <p className="muted">No continuity memory captured yet.</p>
            )}
            {(selectedCharacter.memorySnapshots ?? []).slice(0, 3).map((snapshot) => (
              <p key={`${snapshot.sceneExecutionId}-${snapshot.sceneId}-${snapshot.clipOrder}`}>
                <strong>{snapshot.continuityConfidence ? `${Math.round(snapshot.continuityConfidence * 100)}%` : 'Memory'}</strong> {snapshot.summary}
              </p>
            ))}
            {(selectedCharacter.appearanceDrift ?? []).slice(0, 2).map((drift) => (
              <p key={`${drift.detectedAt}-${drift.sceneId}`}>
                <strong>Drift</strong> {drift.reason}
              </p>
            ))}
          </div>

          <button type="button" className="ghost-btn" onClick={() => void handleSaveProfile()} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save character profile'}
          </button>
          {editorStatus ? <p className="muted">{editorStatus}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
