import { useEffect, useState } from 'react';
import CharacterCapture from '../components/CharacterCapture';
import CharacterLibrary from '../components/CharacterLibrary';
import CreateVideo from '../components/CreateVideo';
import {
  getCreatorSelfCharacter,
  getStoredCharacters,
  isCreatorSelfCharacter,
  saveStoredCharacters,
} from '../lib/characterStorage';
import { loadLumoraProfile, type LumoraProfile } from '../lib/profileStorage';
import { type CharacterProfile } from '../lib/api';
import { useSession } from '../hooks/useSession';
import {
  loadSupabaseCharacters,
  loadSupabaseProfile,
  saveSupabaseIdentityFeedback,
} from '../lib/supabaseAppData';
import {
  getSelfCharacterReferenceImage,
  resolveRenderableReferenceUrl,
  type SelfCharacterReferenceImage,
} from '../lib/selfCharacterReference';
import {
  buildLumoraIdentityProfile,
  identityProfileToStylePreferences,
  mergeIdentityFeedback,
} from '../lib/identityCharacter';
import type { LumoraIdentityFeedback } from '../lib/api';

export default function CreatePage() {
  const { user, session } = useSession();
  const authUser = session?.user ?? user;

  const [characterRefreshKey, setCharacterRefreshKey] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [defaultSelfCharacter, setDefaultSelfCharacter] = useState<CharacterProfile | null>(null);
  const [creatorDataLoading, setCreatorDataLoading] = useState(true);
  const [resolvedReference, setResolvedReference] = useState<SelfCharacterReferenceImage | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);

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

  useEffect(() => {
    let active = true;

    async function resolveSelfReference() {
      if (!activeSelfCharacter) {
        setResolvedReference(null);
        setReferenceLoading(false);
        return;
      }

      setReferenceLoading(true);
      try {
        const resolved = await getSelfCharacterReferenceImage({
          selfCharacter: activeSelfCharacter,
          profile,
        });
        if (active) {
          setResolvedReference(resolved);
        }
      } catch (error) {
        console.error('Unable to resolve Lumora Identity Character references:', error);
        if (active) setResolvedReference(null);
      } finally {
        if (active) setReferenceLoading(false);
      }
    }

    void resolveSelfReference();

    return () => {
      active = false;
    };
  }, [activeSelfCharacter, profile]);

  const savedSelfReferenceUrls = activeSelfCharacter?.referenceImageUrls ?? null;
  const savedFrontFaceUrl = resolveRenderableReferenceUrl(savedSelfReferenceUrls?.frontFaceUrl)
    ?? resolveRenderableReferenceUrl(savedSelfReferenceUrls?.frontFacePath)
    ?? resolveRenderableReferenceUrl(savedSelfReferenceUrls?.frontFace);
  const referenceImageUrl = hasSelfCharacter
    ? resolvedReference?.primary ?? savedFrontFaceUrl
    : resolveRenderableReferenceUrl(selectedCharacter?.referenceImageUrls?.frontFaceUrl)
      ?? resolveRenderableReferenceUrl(selectedCharacter?.referenceImageUrls?.frontFacePath)
      ?? resolveRenderableReferenceUrl(selectedCharacter?.referenceImageUrls?.frontFace);
  const referenceImageUrls = hasSelfCharacter
    ? resolvedReference?.referenceImageUrls ?? activeSelfCharacter?.referenceImageUrls ?? null
    : selectedCharacter?.referenceImageUrls ?? null;
  const additionalReferenceImageUrls = hasSelfCharacter
    ? resolvedReference?.additional ?? [
        resolveRenderableReferenceUrl(savedSelfReferenceUrls?.leftAngleUrl) ??
          resolveRenderableReferenceUrl(savedSelfReferenceUrls?.leftAnglePath) ??
          resolveRenderableReferenceUrl(savedSelfReferenceUrls?.leftAngle),
        resolveRenderableReferenceUrl(savedSelfReferenceUrls?.rightAngleUrl) ??
          resolveRenderableReferenceUrl(savedSelfReferenceUrls?.rightAnglePath) ??
          resolveRenderableReferenceUrl(savedSelfReferenceUrls?.rightAngle),
        resolveRenderableReferenceUrl(savedSelfReferenceUrls?.fullBodyUrl) ??
          resolveRenderableReferenceUrl(savedSelfReferenceUrls?.fullBodyPath) ??
          resolveRenderableReferenceUrl(savedSelfReferenceUrls?.fullBody),
      ].filter((url): url is string => Boolean(url))
    : [];
  const identityProfile = hasSelfCharacter
    ? buildLumoraIdentityProfile({
        userId: authUser?.id ?? 'local',
        selfCharacter: activeSelfCharacter,
        profile,
        referenceImageUrls,
        primaryReferenceImageUrl: referenceImageUrl,
        additionalReferenceImageUrls,
      })
    : null;

  const pageLoading = creatorDataLoading;

  useEffect(() => {
    console.log("FINAL referenceImageUrl:", referenceImageUrl);
  }, [referenceImageUrl]);

  async function handleLikenessFeedback(feedback: LumoraIdentityFeedback) {
    if (!identityProfile || !activeSelfCharacter) return;

    const nextIdentityProfile = mergeIdentityFeedback(identityProfile, feedback);

    if (authUser) {
      await saveSupabaseIdentityFeedback({
        userId: authUser.id,
        identityProfile: nextIdentityProfile,
      });
      const remoteCharacters = await loadSupabaseCharacters(authUser.id);
      setDefaultSelfCharacter(remoteCharacters.find(isCreatorSelfCharacter) ?? defaultSelfCharacter);
      return;
    }

    const nextCharacters = getStoredCharacters().map((character) => {
      if (!isCreatorSelfCharacter(character)) return character;
      return {
        ...character,
        identityProfile: nextIdentityProfile,
        stylePreferences: identityProfileToStylePreferences(character.stylePreferences, nextIdentityProfile),
      };
    });
    saveStoredCharacters(nextCharacters);
    setDefaultSelfCharacter(nextCharacters.find(isCreatorSelfCharacter) ?? defaultSelfCharacter);
  }

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
        characterDescription={identityProfile?.appearanceSummary ?? ""}
        referenceImageUrl={referenceImageUrl}
        referenceImageUrls={referenceImageUrls}
        additionalReferenceImageUrls={additionalReferenceImageUrls}
        referenceLoading={referenceLoading}
        referenceLabel={identityProfile ? 'Lumora Identity Character' : null}
        forceSelfMode={hasSelfCharacter}
        identityProfile={identityProfile}
        onLikenessFeedback={(feedback) => void handleLikenessFeedback(feedback)}
        onResaveReferencePhoto={() => {
          window.location.hash = 'character-capture';
        }}
      />

      <div id="character-capture">
        <CharacterCapture onCreated={() => setCharacterRefreshKey(v => v + 1)} />
      </div>

    </div>
  );
}
