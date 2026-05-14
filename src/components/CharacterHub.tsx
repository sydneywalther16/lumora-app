import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type CharacterProfile, type CharacterRelationshipMemory } from '../lib/api';
import { isCreatorSelfCharacter, updateLocalCharacterProfile } from '../lib/characterStorage';
import { getBestThumbnail } from '../lib/mediaThumbnail';
import { loadSupabaseCharacters, updateSupabaseCharacterProfile } from '../lib/supabaseAppData';
import { useSession } from '../hooks/useSession';
import CharacterCapture from './CharacterCapture';

type CharacterHubProps = {
  open: boolean;
  characters: CharacterProfile[];
  onClose: () => void;
  onEditSelf: () => void;
  onRefresh: (characters?: CharacterProfile[]) => void | Promise<void>;
  children?: ReactNode;
};

const characterLimit = 25;
const characterProfilesMigrationWarning = 'Character Profiles need the latest database migration.';

function characterInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'C';
}

function characterTimestamp(character: CharacterProfile) {
  return new Date(character.createdAt || character.updatedAt || 0).getTime() || 0;
}

function characterIsSelf(character: CharacterProfile): boolean {
  return isCreatorSelfCharacter(character);
}

function characterSummary(character: CharacterProfile) {
  const style = character.stylePreferences ?? {};
  const vibe = typeof style.characterVibe === 'string' ? style.characterVibe : '';
  return (
    character.appearanceSummary ||
    character.wardrobeTendencies ||
    character.emotionalTendencies ||
    vibe ||
    'No appearance memory saved yet.'
  );
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

  return error instanceof Error ? error.message : 'Unable to save character profile.';
}

function CharacterThumbnail({ character }: { character: CharacterProfile }) {
  const thumbnail = getBestThumbnail(character);
  const name = character.displayName || character.name;

  return (
    <span className="character-avatar" style={{ width: '58px', height: '58px', borderRadius: '18px' }}>
      {thumbnail ? (
        <img src={thumbnail} alt={name} />
      ) : (
        characterInitial(name)
      )}
    </span>
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
    () => characters.find(isCreatorSelfCharacter) ?? null,
    [characters],
  );
  const otherCharacters = useMemo(
    () => characters
      .filter((character) => !characterIsSelf(character))
      .sort((a, b) => characterTimestamp(b) - characterTimestamp(a))
      .slice(0, Math.max(0, characterLimit - (selfCharacter ? 1 : 0))),
    [characters, selfCharacter],
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const selectedCharacter = otherCharacters.find((character) => character.id === selectedCharacterId) ?? null;
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [appearanceSummary, setAppearanceSummary] = useState('');
  const [wardrobeTendencies, setWardrobeTendencies] = useState('');
  const [emotionalTendencies, setEmotionalTendencies] = useState('');
  const [soundtrackTendencies, setSoundtrackTendencies] = useState('');
  const [cinematicStyle, setCinematicStyle] = useState('');
  const [relationshipNotes, setRelationshipNotes] = useState('');
  const [editorStatus, setEditorStatus] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const atCharacterLimit = characters.length >= characterLimit;

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

  if (!open) return null;

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

      await onRefresh(
        characters.map((character) => character.id === updated.id ? updated : character),
      );
      setSelectedCharacterId(updated.id);
      setEditorStatus('Character profile saved.');
    } catch (error) {
      setEditorStatus(characterProfileEditorError(error));
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <section style={{ marginTop: '18px', display: 'grid', gap: '18px' }}>
      <div className="row-between" style={{ gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">characters</span>
          <h2 style={{ marginTop: '8px' }}>Characters</h2>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Manage your reusable cinematic cast.
          </p>
        </div>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <article className="list-card" style={{ borderRadius: '24px', padding: '16px', background: 'var(--surface-strong)' }}>
        <div className="row-between" style={{ gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr)', gap: '12px', alignItems: 'center', minWidth: 0 }}>
            {selfCharacter ? (
              <CharacterThumbnail character={selfCharacter} />
            ) : (
              <span className="character-avatar" style={{ width: '58px', height: '58px', borderRadius: '18px' }}>S</span>
            )}
            <div style={{ minWidth: 0 }}>
              <span className="tiny-pill">Self</span>
              <strong style={{ display: 'block', marginTop: '6px' }}>
                {selfCharacter?.displayName || selfCharacter?.name || 'Create your self character'}
              </strong>
              <p className="muted" style={{ margin: '5px 0 0' }}>
                {selfCharacter ? characterSummary(selfCharacter) : 'Pin yourself as the default reusable Lumora identity.'}
              </p>
            </div>
          </div>
          <button type="button" className="ghost-btn" style={{ flex: 'unset' }} onClick={onEditSelf}>
            {selfCharacter ? 'Edit' : 'Create self'}
          </button>
        </div>
      </article>

      {children}

      <div style={{ display: 'grid', gap: '12px' }}>
        <div className="row-between" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <span className="eyebrow">cast members</span>
            <h3 style={{ marginTop: '8px' }}>Other characters</h3>
          </div>
          <span className="tiny-pill">{Math.min(characters.length, characterLimit)} / {characterLimit}</span>
        </div>

        {otherCharacters.length ? (
          <div style={{ display: 'grid', gap: '10px' }}>
            {otherCharacters.map((character) => {
              const selected = selectedCharacter?.id === character.id;
              return (
                <article
                  key={character.id}
                  className="list-card"
                  style={{
                    borderRadius: '22px',
                    padding: '12px',
                    background: 'var(--surface-strong)',
                    borderColor: selected ? 'var(--selected-outline)' : 'var(--surface-border)',
                  }}
                >
                  <div className="row-between" style={{ gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '58px minmax(0, 1fr)', gap: '12px', alignItems: 'center', minWidth: 0 }}>
                      <CharacterThumbnail character={character} />
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ display: 'block' }}>{character.displayName || character.name}</strong>
                        <p className="muted" style={{ margin: '5px 0 0' }}>
                          {characterSummary(character)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ flex: 'unset' }}
                      onClick={() => setSelectedCharacterId(selected ? null : character.id)}
                    >
                      {selected ? 'Close edit' : 'Edit'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <article className="list-card" style={{ borderRadius: '22px', padding: '16px' }}>
            <h3>No other characters yet</h3>
            <p className="muted">Create cast members here and reuse them in future scenes.</p>
          </article>
        )}
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
            <textarea value={appearanceSummary} onChange={(event) => setAppearanceSummary(event.target.value)} rows={3} />
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
            <textarea value={relationshipNotes} onChange={(event) => setRelationshipNotes(event.target.value)} rows={3} />
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
          </div>

          <button type="button" className="ghost-btn" onClick={() => void handleSaveProfile()} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save character profile'}
          </button>
          {editorStatus ? <p className="muted">{editorStatus}</p> : null}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: '12px' }}>
        <div className="row-between" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <span className="eyebrow">new character</span>
            <h3 style={{ marginTop: '8px' }}>Create cast member</h3>
          </div>
          {!atCharacterLimit ? (
            <button type="button" className="ghost-btn" style={{ flex: 'unset' }} onClick={() => setCreatingCharacter((current) => !current)}>
              {creatingCharacter ? 'Hide creator' : 'Create character'}
            </button>
          ) : null}
        </div>

        {atCharacterLimit ? (
          <article className="list-card" style={{ borderRadius: '22px', padding: '16px' }}>
            <h3>You’ve reached the 25 character limit.</h3>
            <p className="muted">Edit an existing character to keep continuity tight.</p>
          </article>
        ) : creatingCharacter ? (
          <CharacterCapture onCreated={() => void refreshAfterCreate()} />
        ) : null}
      </div>
    </section>
  );
}
