import { useEffect, useState } from 'react';
import CharacterCapture from '../components/CharacterCapture';
import CharacterLibrary from '../components/CharacterLibrary';
import CreateVideo from '../components/CreateVideo';
import {
  CREATOR_SELF_CHARACTER_ID,
  getCreatorSelfCharacter,
  isCreatorSelfCharacter,
} from '../lib/characterStorage';
import { loadLumoraProfile, type LumoraProfile } from '../lib/profileStorage';
import { type CharacterProfile } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { loadSupabaseCharacters, loadSupabaseProfile } from '../lib/supabaseAppData';

const FORCED_REFERENCE =
  "https://duwuoszxtbpirfujotia.supabase.co/storage/v1/object/public/character-reference-images/manual/front-1778271310361.jpg";

export default function CreatePage() {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;

  const [characterRefreshKey, setCharacterRefreshKey] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [defaultSelfCharacter, setDefaultSelfCharacter] = useState<CharacterProfile | null>(null);
  const [creatorDataLoading, setCreatorDataLoading] = useState(true);

  const [profile, setProfile] = useState<LumoraProfile>({
    displayName: 'Creator',
    username: 'lumora.creator',
    bio: '',
  });

  useEffect(() => {
    let active = true;

    async function loadData() {
      setCreatorDataLoading(true);

      if (authUser) {
        try {
          const [remoteProfile, remoteCharacters] = await Promise.all([
            loadSupabaseProfile(authUser.id),
            loadSupabaseCharacters(authUser.id),
          ]);

          const selfChar = remoteCharacters.find(isCreatorSelfCharacter) ?? null;

          if (!active) return;

          setProfile(remoteProfile);
          setDefaultSelfCharacter(selfChar);
        } catch (err) {
          console.error("Failed to load creator data:", err);
        } finally {
          if (active) setCreatorDataLoading(false);
        }
      } else {
        const localProfile = loadLumoraProfile();
        const localSelf = getCreatorSelfCharacter();

        if (!active) return;

        setProfile(localProfile);
        setDefaultSelfCharacter(localSelf);
        setCreatorDataLoading(false);
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [authUser, characterRefreshKey]);

  const activeSelfCharacter =
    !selectedCharacter && defaultSelfCharacter
      ? defaultSelfCharacter
      : selectedCharacter && isCreatorSelfCharacter(selectedCharacter)
        ? selectedCharacter
        : null;

  const hasSelfCharacter = Boolean(activeSelfCharacter);

  const referenceImageUrl = hasSelfCharacter
    ? FORCED_REFERENCE
    : selectedCharacter?.referenceImageUrls?.frontFaceUrl ?? null;

  const pageLoading = creatorDataLoading;

  useEffect(() => {
    console.log("FORCED IMAGE USED:", referenceImageUrl);
  }, [referenceImageUrl]);

  if (pageLoading) {
    return (
      <div className="page">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <div className="page">

      <h2>Create</h2>

      <CharacterLibrary
        refreshKey={characterRefreshKey}
        selectedCharacterId={selectedCharacter?.id ?? null}
        onSelect={setSelectedCharacter}
      />

      <CreateVideo
        refreshKey={characterRefreshKey}
        characterId={activeSelfCharacter?.id ?? null}
        characterName={activeSelfCharacter?.name ?? profile.displayName}
        characterAvatar={referenceImageUrl}
        isDefaultSelfCharacter={hasSelfCharacter}
        characterDescription=""
        referenceImageUrl={referenceImageUrl}
        referenceImageUrls={null}
        additionalReferenceImageUrls={[]}
        referenceLoading={false}
        referenceLabel="FORCED"
        forceSelfMode={hasSelfCharacter}
        onResaveReferencePhoto={() => {}}
      />

      <div id="character-capture">
        <CharacterCapture onCreated={() => setCharacterRefreshKey(v => v + 1)} />
      </div>

    </div>
  );
}