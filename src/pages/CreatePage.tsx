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
import {
  getSelfCharacterReferenceImage,
  type SelfCharacterReferenceImage,
} from '../lib/selfCharacterReference';

const selfFeatureLabels: Array<[string, string]> = [
  ['hairColorStyle', 'Hair color/style'],
  ['eyeColor', 'Eye color'],
  ['skinTone', 'Skin tone'],
  ['bodyBuild', 'Body/build'],
  ['signatureMakeup', 'Signature makeup'],
  ['distinctiveFeatures', 'Distinctive features'],
];

const selfStyleLabels: Array<[string, string]> = [
  ['everydayStyle', 'Everyday style'],
  ['glamStyle', 'Glam style'],
  ['videoWardrobe', 'Wardrobe style'],
  ['colorsToFavor', 'Colors to favor'],
  ['colorsToAvoid', 'Colors/items to avoid'],
];

function buildDefaultSelfCharacter(profile: LumoraProfile): CharacterProfile {
  const profileReferenceImages = readObjectRecord(profile.selfReferenceImageUrls);

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
      fullBody: typeof profileReferenceImages.fullBody === 'string' ? profileReferenceImages.fullBody : null,
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

function cleanReferenceUrl(value?: string | null): string | null {
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;
  return value;
}

function pickPrimaryReferenceImage(
  urls: CharacterProfile['referenceImageUrls'] | null,
  fallbackUrl: string | null,
): string | null {
  if (!urls) return cleanReferenceUrl(fallbackUrl);

  return (
    cleanReferenceUrl(urls.frontFace) ||
    cleanReferenceUrl(urls.fullBody) ||
    cleanReferenceUrl(urls.leftAngle) ||
    cleanReferenceUrl(urls.rightAngle) ||
    cleanReferenceUrl(urls.expressive) ||
    cleanReferenceUrl(fallbackUrl)
  );
}

function readObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = readObjectRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function pickDescriptionFields(
  labels: Array<[string, string]>,
  ...records: Array<Record<string, string>>
): string[] {
  return labels.flatMap(([key, label]) => {
    const value = records.map((record) => record[key]?.trim()).find(Boolean);
    return value ? [`${label}: ${value}`] : [];
  });
}

function buildSelfCharacterDescription(
  profile: LumoraProfile,
  character: CharacterProfile | null,
): string {
  if (!character) return '';

  const stylePreferences = readObjectRecord(character.stylePreferences);
  const flatStylePreferences = readStringRecord(stylePreferences);
  const profileFeatures = readStringRecord(profile.creatorSelfFeatures);
  const profileStyle = readStringRecord(profile.creatorSelfStylePreferences);
  const nestedFeatures = readStringRecord(stylePreferences.creatorSelfFeatures);
  const nestedStyle = readStringRecord(stylePreferences.creatorSelfStylePreferences);
  const characterFeatures = readStringRecord(character.creatorSelfFeatures);
  const characterStyle = readStringRecord(character.creatorSelfStylePreferences);
  const descriptionParts = [
    `Name: ${character.name || profile.displayName || 'Creator Self'}`,
    ...pickDescriptionFields(
      selfFeatureLabels,
      flatStylePreferences,
      profileFeatures,
      nestedFeatures,
      characterFeatures,
    ),
    ...pickDescriptionFields(
      selfStyleLabels,
      flatStylePreferences,
      profileStyle,
      nestedStyle,
      characterStyle,
    ),
  ];

  return descriptionParts.join('; ');
}

export default function CreatePage() {
  const { user, session, loading, configured } = useSession();
  const authUser = session?.user ?? user;
  const sessionResolving = configured && loading && !authUser;
  const [characterRefreshKey, setCharacterRefreshKey] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [defaultSelfCharacter, setDefaultSelfCharacter] = useState<CharacterProfile | null>(null);
  const [selfReference, setSelfReference] = useState<SelfCharacterReferenceImage>({
    url: null,
    label: null,
    slot: null,
    referenceImageUrls: {},
    inspectedFields: [],
  });
  const [selfReferenceLoading, setSelfReferenceLoading] = useState(false);
  const [profile, setProfile] = useState<LumoraProfile>({
    displayName: 'Creator',
    username: 'lumora.creator',
    bio: '',
  });

  useEffect(() => {
    let active = true;

    async function loadDefaultSelfCharacter() {
      if (configured && loading && !authUser) {
        return;
      }

      if (authUser) {
        try {
          const [remoteProfile, remoteCharacters] = await Promise.all([
            loadSupabaseProfile(authUser.id),
            loadSupabaseCharacters(authUser.id),
          ]);
          const remoteSelfCharacter = remoteCharacters.find(isCreatorSelfCharacter) ?? null;
          const nextProfile: LumoraProfile = remoteSelfCharacter
            ? {
                ...remoteProfile,
                defaultSelfCharacterId: CREATOR_SELF_CHARACTER_ID,
                defaultSelfCharacterName: remoteSelfCharacter.name,
                defaultSelfCharacterAvatar: remoteSelfCharacter.referenceImageUrls.frontFace || remoteProfile.avatar || null,
              }
            : remoteProfile;

          if (!active) return;
          setProfile(nextProfile);
          setDefaultSelfCharacter(remoteSelfCharacter);
          return;
        } catch (error) {
          console.error('Unable to load Supabase creator self for Create:', error);
          return;
        }
      }

      const loadedProfile = loadLumoraProfile();
      const storedSelfCharacter = getCreatorSelfCharacter();
      const hasDefaultSelfCharacter =
        loadedProfile.defaultSelfCharacterId === CREATOR_SELF_CHARACTER_ID || Boolean(storedSelfCharacter);

      if (!active) return;
      setProfile(loadedProfile);
      setDefaultSelfCharacter(
        hasDefaultSelfCharacter ? storedSelfCharacter ?? buildDefaultSelfCharacter(loadedProfile) : null,
      );
    }

    void loadDefaultSelfCharacter();

    return () => {
      active = false;
    };
  }, [authUser, characterRefreshKey, configured, loading]);

  const usingDefaultSelf =
    !selectedCharacter &&
    Boolean(defaultSelfCharacter);
  const selectedSelfCharacter = selectedCharacter && isCreatorSelfCharacter(selectedCharacter)
    ? selectedCharacter
    : null;
  const activeSelfCharacter = usingDefaultSelf ? defaultSelfCharacter : selectedSelfCharacter;

  const characterId = activeSelfCharacter ? CREATOR_SELF_CHARACTER_ID : selectedCharacter?.id ?? null;
  const characterName = activeSelfCharacter ? profile.displayName : selectedCharacter?.name ?? null;
  const characterAvatar = activeSelfCharacter
    ? profile.defaultSelfCharacterAvatar ?? null
    : selectedCharacter?.referenceImageUrls.frontFace ?? null;
  const isDefaultSelfCharacter = Boolean(activeSelfCharacter);
  const characterDescription = activeSelfCharacter
    ? buildSelfCharacterDescription(profile, activeSelfCharacter)
    : '';
  const referenceImageUrl = activeSelfCharacter
    ? selfReference.url ?? pickPrimaryReferenceImage(activeSelfCharacter.referenceImageUrls, characterAvatar)
    : null;
  const referenceImageUrls = activeSelfCharacter
    ? {
        ...activeSelfCharacter.referenceImageUrls,
        ...selfReference.referenceImageUrls,
      }
    : null;
  const referenceResolving =
    Boolean(activeSelfCharacter) && (selfReferenceLoading || selfReference.inspectedFields.length === 0);

  useEffect(() => {
    let active = true;

    async function resolveSelfReference() {
      if (!activeSelfCharacter) {
        setSelfReference({
          url: null,
          label: null,
          slot: null,
          referenceImageUrls: {},
          inspectedFields: [],
        });
        setSelfReferenceLoading(false);
        return;
      }

      setSelfReferenceLoading(true);
      console.log('[CreatePage] resolving self-character reference image', {
        characterId: activeSelfCharacter.id,
        referenceImageUrls: activeSelfCharacter.referenceImageUrls,
        profileSelfReferenceImageUrls: profile.selfReferenceImageUrls ?? null,
        defaultSelfCharacterAvatar: profile.defaultSelfCharacterAvatar ?? null,
        profileAvatar: profile.avatar ?? null,
      });

      const nextReference = await getSelfCharacterReferenceImage({
        selfCharacter: activeSelfCharacter,
        profile,
      });

      if (!active) return;
      setSelfReference(nextReference);
      setSelfReferenceLoading(false);
    }

    void resolveSelfReference();

    return () => {
      active = false;
    };
  }, [activeSelfCharacter, profile]);

  if (sessionResolving) {
    return (
      <div className="page">
        <section className="headline-card">
          <div>
            <span className="eyebrow">composer</span>
            <h2>Loading creator session</h2>
          </div>
          <p>Checking your saved Lumora account before loading self-character generation.</p>
        </section>
      </div>
    );
  }

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
        characterDescription={characterDescription}
        referenceImageUrl={referenceImageUrl}
        referenceImageUrls={referenceImageUrls}
        referenceLoading={referenceResolving}
        referenceLabel={selfReference.label}
      />
      <CharacterCapture onCreated={() => setCharacterRefreshKey((value) => value + 1)} />
    </div>
  );
}
