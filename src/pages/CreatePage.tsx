import { useEffect, useState } from 'react';
import CharacterCapture from '../components/CharacterCapture';
import CharacterLibrary from '../components/CharacterLibrary';
import CreateVideo from '../components/CreateVideo';
import {
  CREATOR_SELF_CHARACTER_ID,
  getCreatorSelfCharacter,
} from '../lib/characterStorage';
import { loadLumoraProfile, type LumoraProfile } from '../lib/profileStorage';
import { type CharacterProfile } from '../lib/api';

function buildDefaultSelfCharacter(profile: LumoraProfile): CharacterProfile {
  return {
    id: CREATOR_SELF_CHARACTER_ID,
    ownerUserId: 'local',
    name: profile.defaultSelfCharacterName ?? 'Creator Self',
    status: 'ready',
    consentConfirmed: true,
    visibility: 'private',
    stylePreferences: {},
    referenceImageUrls: {
      frontFace: profile.defaultSelfCharacterAvatar ?? '',
      leftAngle: profile.defaultSelfCharacterAvatar ?? '',
      rightAngle: profile.defaultSelfCharacterAvatar ?? '',
    },
    sourceCaptureVideoUrl: profile.selfCaptureVideoUrl ?? null,
    voiceSampleUrl: profile.selfVoiceSampleUrl ?? null,
    voiceSampleName: profile.selfVoiceSampleName ?? null,
    voiceSampleNumbers: profile.selfVoiceSampleNumbers ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isSelf: true,
    isCreatorSelf: true,
  };
}

export default function CreatePage() {
  const [characterRefreshKey, setCharacterRefreshKey] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [defaultSelfCharacter, setDefaultSelfCharacter] = useState<CharacterProfile | null>(null);
  const [profile, setProfile] = useState<LumoraProfile>({
    displayName: 'Creator',
    username: 'lumora.creator',
    bio: '',
  });

  useEffect(() => {
    const loadedProfile = loadLumoraProfile();
    setProfile(loadedProfile);
    const storedSelfCharacter = getCreatorSelfCharacter();
    const hasDefaultSelfCharacter = loadedProfile.defaultSelfCharacterId === CREATOR_SELF_CHARACTER_ID;

    if (!storedSelfCharacter && !hasDefaultSelfCharacter) {
      setDefaultSelfCharacter(null);
      return;
    }

    setDefaultSelfCharacter(storedSelfCharacter ?? buildDefaultSelfCharacter(loadedProfile));
  }, [characterRefreshKey]);

  const usingDefaultSelf =
    !selectedCharacter &&
    profile.defaultSelfCharacterId === CREATOR_SELF_CHARACTER_ID &&
    Boolean(defaultSelfCharacter);

  const characterId = usingDefaultSelf ? CREATOR_SELF_CHARACTER_ID : selectedCharacter?.id ?? null;
  const characterName = usingDefaultSelf ? profile.displayName : selectedCharacter?.name ?? null;
  const characterAvatar = usingDefaultSelf
    ? profile.defaultSelfCharacterAvatar ?? null
    : selectedCharacter?.referenceImageUrls.frontFace ?? null;
  const isDefaultSelfCharacter = usingDefaultSelf;

  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">composer</span>
          <h2>Build a character-led video</h2>
        </div>
        <p>Capture a consented persona profile, then generate character-consistent short video concepts.</p>
      </section>

      <section className="headline-card">
        <div>
          <span className="eyebrow">character mode</span>
          <h2>{isDefaultSelfCharacter ? 'Creating as self' : 'Featuring a character'}</h2>
        </div>
        <p>
          {isDefaultSelfCharacter
            ? `Using your creator self character: ${characterName}`
            : selectedCharacter
              ? `Featuring: ${selectedCharacter.name}`
              : 'Select a character to create as a featured character.'}
        </p>
        {selectedCharacter ? (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setSelectedCharacter(null)}
            style={{ marginTop: '12px' }}
          >
            Switch to creator self
          </button>
        ) : null}
      </section>

      <section className="headline-card">
        <div>
          <span className="eyebrow">select</span>
          <h2>Select a character</h2>
        </div>
        <p>Choose one saved character to attach to your next prompt.</p>
      </section>

      <CharacterLibrary
        refreshKey={characterRefreshKey}
        selectedCharacterId={selectedCharacter?.id ?? null}
        onSelect={setSelectedCharacter}
      />

      {!selectedCharacter && !defaultSelfCharacter ? (
        <section className="headline-card" style={{ marginTop: '18px' }}>
          <div>
            <span className="eyebrow">default self character</span>
            <h2>Set up your default self character</h2>
            <p>
              Set up your default self character in Profile to create as yourself.
            </p>
          </div>
        </section>
      ) : null}

      <CreateVideo
        refreshKey={characterRefreshKey}
        characterId={characterId}
        characterName={characterName}
        characterAvatar={characterAvatar}
        isDefaultSelfCharacter={isDefaultSelfCharacter}
      />
      <CharacterCapture onCreated={() => setCharacterRefreshKey((value) => value + 1)} />
    </div>
  );
}
