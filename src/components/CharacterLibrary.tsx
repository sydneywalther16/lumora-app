import { useEffect, useState } from 'react';
import { type CharacterProfile } from '../lib/api';
import { getStoredCharacters, isCreatorSelfCharacter } from '../lib/characterStorage';

type CharacterLibraryProps = {
  selectedCharacterId?: string | null;
  onSelect?: (character: CharacterProfile | null) => void;
  refreshKey?: number;
};

function characterInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'C';
}

export default function CharacterLibrary({
  selectedCharacterId,
  onSelect,
  refreshKey = 0,
}: CharacterLibraryProps) {
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [status, setStatus] = useState('Loading characters...');

  useEffect(() => {
    const loaded = getStoredCharacters().filter((character) => !isCreatorSelfCharacter(character));
    setCharacters(loaded);
    setStatus(loaded.length ? '' : 'No fictional characters saved yet');
  }, [refreshKey]);

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
                {character.referenceImageUrls.frontFace ? (
                  <img src={character.referenceImageUrls.frontFace} alt="" />
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
    </section>
  );
}
