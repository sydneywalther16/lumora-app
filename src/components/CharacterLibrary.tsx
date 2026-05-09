import { useEffect, useState } from 'react';
import { type CharacterProfile } from '../lib/api';
import { getStoredCharacters, isCreatorSelfCharacter } from '../lib/characterStorage';
import { useSession } from '../hooks/useSession';
import { loadSupabaseCharacters } from '../lib/supabaseAppData';
import { resolveRenderableReferenceUrl } from '../lib/selfCharacterReference';

type CharacterLibraryProps = {
  selectedCharacterId?: string | null;
  onSelect?: (character: CharacterProfile | null) => void;
  refreshKey?: number;
};

function characterInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'C';
}

function CharacterAvatarPreview({ character }: { character: CharacterProfile }) {
  const resolvedUrl = resolveRenderableReferenceUrl(
    character.referenceImageUrls.frontFaceUrl ||
      character.referenceImageUrls.frontFacePath ||
      character.referenceImageUrls.frontFace,
  );

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onLoad={() => console.log('LOADED PREVIEW:', resolvedUrl)}
          onError={() => {
            console.error('FAILED PREVIEW:', resolvedUrl);
            console.error('FAILED PREVIEW URL:', resolvedUrl);
          }}
        />
      ) : (
        characterInitial(character.name)
      )}
    </div>
  );
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
              onClick={() => onSelect?.(character)}
            >
              <span className="character-avatar">
                <CharacterAvatarPreview character={character} />
              </span>
              <span className="character-copy">
                <strong>{character.name}</strong>
                <span>{character.status} - {character.visibility.replace('_', ' ')}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
