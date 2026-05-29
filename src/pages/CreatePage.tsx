import { useEffect, useRef, useState } from 'react';
import CharacterLibrary from '../components/CharacterLibrary';
import CreateVideo from '../components/CreateVideo';
import {
  getCreatorSelfCharacter,
  getStoredCharacters,
  isCreatorSelfCharacter,
  saveStoredCharacters,
} from '../lib/characterStorage';
import { loadLumoraProfile, type LumoraProfile } from '../lib/profileStorage';
import { type CharacterProfile, type GenerationMode, type ReferenceImageUrls } from '../lib/api';
import { trackCreatorEvent } from '../lib/creatorEvents';
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
import { isLumoraSavedUrl } from '../lib/referenceRepair';
import {
  buildLumoraIdentityProfile,
  identityProfileToStylePreferences,
  mergeIdentityFeedback,
} from '../lib/identityCharacter';
import type { LumoraIdentityFeedback } from '../lib/api';

function manualHttpsReferenceUrl(...values: Array<string | null | undefined>): string | null {
  const value = values.find((item) => typeof item === 'string' && item.trim().startsWith('https://'));
  const url = value?.trim() ?? null;
  return url && isLumoraSavedUrl(url) ? url : null;
}

type RemixProjectPayload = {
  projectId?: string | null;
  prompt?: string;
  title?: string;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatar?: string | null;
  isDefaultSelfCharacter?: boolean;
  referenceImageUrl?: string | null;
  referenceImageUrls?: Partial<ReferenceImageUrls> | null;
  additionalReferenceImageUrls?: string[];
  generationMode?: GenerationMode | null;
  provider?: string | null;
  displayEngine?: string | null;
  exactLikenessRoute?: string | null;
  exactLikenessProvider?: string | null;
  exactLikenessCanaryStatus?: string | null;
  referenceStrategy?: string | null;
  referenceRolesUsed?: string[] | null;
  referenceCount?: number | null;
  renderProvider?: string | null;
};

function readStoredRemixProject(): RemixProjectPayload | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem('lumora_remix_project');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemixProjectPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export default function CreatePage() {
  const { authReady, user, session, loading: sessionLoading, configured: supabaseConfigured } = useSession();
  const authUser = session?.user ?? user;
  const authUserId = authUser?.id ?? null;

  const [characterRefreshKey, setCharacterRefreshKey] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterProfile | null>(null);
  const [defaultSelfCharacter, setDefaultSelfCharacter] = useState<CharacterProfile | null>(null);
  const [creatorDataLoading, setCreatorDataLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const [resolvedReference, setResolvedReference] = useState<SelfCharacterReferenceImage | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [remixProject, setRemixProject] = useState<RemixProjectPayload | null>(null);
  const [castConfirmation, setCastConfirmation] = useState('');
  const castSectionRef = useRef<HTMLElement | null>(null);

  const [profile, setProfile] = useState<LumoraProfile>({
    displayName: 'Creator',
    username: 'lumora.creator',
    bio: '',
  });

  useEffect(() => {
    console.info('CREATE OK');
    const storedRemixProject = readStoredRemixProject();
    if (storedRemixProject) {
      setRemixProject(storedRemixProject);
      localStorage.removeItem('lumora_remix_project');
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === 'undefined') return;
    const raw = localStorage.getItem('lumora_create_cast_character');
    if (!raw) return;

    try {
      const character = JSON.parse(raw) as CharacterProfile;
      if (character && typeof character === 'object' && typeof character.id === 'string') {
        setSelectedCharacter(character);
        setCastConfirmation(`${character.displayName || character.name} is cast for this scene`);
        window.setTimeout(() => {
          castSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          castSectionRef.current?.focus();
        }, 120);
      }
    } catch {
      // Ignore malformed local return payloads.
    } finally {
      localStorage.removeItem('lumora_create_cast_character');
    }
  }, [isHydrated]);

  useEffect(() => {
    setSelectedCharacter(null);
    setDefaultSelfCharacter(null);
    setResolvedReference(null);
    setIsHydrated(false);
  }, [authUserId]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setCreatorDataLoading(true);
      setIsHydrated(false);
      setDefaultSelfCharacter(null);
      setResolvedReference(null);

      if (supabaseConfigured && (!authReady || sessionLoading)) {
        return;
      }

      if (authUserId) {
        try {
          const remoteProfile = await loadSupabaseProfile(authUserId);
          const remoteCharacters = await loadSupabaseCharacters(authUserId);
          const selfChar = remoteCharacters.find(isCreatorSelfCharacter) ?? null;
          console.log('HYDRATED SELF CHARACTER:', selfChar);
          console.log('PROFILE SOURCE:', 'supabase');
          console.log('SELF CHARACTER SOURCE:', 'supabase');

          if (!active) return;

          setProfile(remoteProfile);
          setDefaultSelfCharacter(selfChar);
        } catch (err) {
          console.error("Failed to load creator data:", err);
          if (active) {
            setDefaultSelfCharacter(null);
            console.log('PROFILE SOURCE:', 'supabase');
            console.log('SELF CHARACTER SOURCE:', 'supabase');
          }
        } finally {
          if (active) {
            setCreatorDataLoading(false);
            setIsHydrated(true);
          }
        }
      } else {
        const localProfile = loadLumoraProfile();
        const localSelf = getCreatorSelfCharacter();
        console.log('HYDRATED SELF CHARACTER:', localSelf);
        console.log('PROFILE SOURCE:', 'local');
        console.log('SELF CHARACTER SOURCE:', localSelf ? 'local' : 'default');

        if (!active) return;

        setProfile(localProfile);
        setDefaultSelfCharacter(localSelf);
        setCreatorDataLoading(false);
        setIsHydrated(true);
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [authReady, authUserId, characterRefreshKey, sessionLoading, supabaseConfigured]);

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
      if (!isHydrated || !activeSelfCharacter) {
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
  }, [activeSelfCharacter, isHydrated, profile]);

  const savedSelfReferenceUrls = activeSelfCharacter?.referenceImageUrls ?? null;
  const manualReferenceImageUrl = hasSelfCharacter
    ? manualHttpsReferenceUrl(
        savedSelfReferenceUrls?.manualReferenceImageUrl,
        profile.manualReferenceImageUrl,
        profile.selfReferenceImageUrls?.manualReferenceImageUrl,
      )
    : null;
  const savedFrontFaceUrl = resolveRenderableReferenceUrl(savedSelfReferenceUrls?.frontFaceUrl)
    ?? resolveRenderableReferenceUrl(savedSelfReferenceUrls?.frontFacePath)
    ?? resolveRenderableReferenceUrl(savedSelfReferenceUrls?.frontFace);
  const referenceImageUrl = hasSelfCharacter
    ? savedFrontFaceUrl ?? resolvedReference?.primary ?? manualReferenceImageUrl ?? null
    : resolveRenderableReferenceUrl(selectedCharacter?.referenceImageUrls?.frontFaceUrl)
      ?? resolveRenderableReferenceUrl(selectedCharacter?.referenceImageUrls?.frontFacePath)
      ?? resolveRenderableReferenceUrl(selectedCharacter?.referenceImageUrls?.frontFace);
  const referenceImageUrls = hasSelfCharacter
    ? {
        ...(resolvedReference?.referenceImageUrls ?? activeSelfCharacter?.referenceImageUrls ?? {}),
        manualReferenceImageUrl,
      }
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
  const remixReferenceImageUrl = resolveRenderableReferenceUrl(remixProject?.referenceImageUrl);
  const remixAdditionalReferenceImageUrls = remixProject?.additionalReferenceImageUrls?.filter(Boolean) ?? [];
  const effectiveReferenceImageUrl = remixReferenceImageUrl ?? referenceImageUrl;
  const effectiveReferenceImageUrls = remixProject?.referenceImageUrls ?? referenceImageUrls;
  const effectiveAdditionalReferenceImageUrls = remixAdditionalReferenceImageUrls.length
    ? remixAdditionalReferenceImageUrls
    : additionalReferenceImageUrls;
  const effectiveIsDefaultSelfCharacter = remixProject
    ? Boolean(remixProject.isDefaultSelfCharacter)
    : hasSelfCharacter;
  const effectiveCharacterId = remixProject?.characterId ?? activeSelfCharacter?.id ?? selectedCharacter?.id ?? null;
  const effectiveCharacterName = remixProject?.characterName
    ?? activeSelfCharacter?.displayName
    ?? activeSelfCharacter?.name
    ?? selectedCharacter?.displayName
    ?? selectedCharacter?.name
    ?? profile.displayName;
  const effectiveCharacterAvatar = remixProject?.characterAvatar ?? effectiveReferenceImageUrl;
  const identityProfile = hasSelfCharacter
    ? buildLumoraIdentityProfile({
        userId: authUserId ?? 'local',
        selfCharacter: activeSelfCharacter,
        profile,
        referenceImageUrls: effectiveReferenceImageUrls,
        primaryReferenceImageUrl: effectiveReferenceImageUrl,
        additionalReferenceImageUrls: effectiveAdditionalReferenceImageUrls,
      })
    : null;

  const pageLoading = creatorDataLoading || !isHydrated;
  useEffect(() => {
    console.log("FINAL referenceImageUrl:", referenceImageUrl);
  }, [referenceImageUrl]);

  async function handleLikenessFeedback(feedback: LumoraIdentityFeedback) {
    if (!identityProfile || !activeSelfCharacter) return;

    const nextIdentityProfile = mergeIdentityFeedback(identityProfile, feedback);

    if (authUserId) {
      await saveSupabaseIdentityFeedback({
        userId: authUserId,
        identityProfile: nextIdentityProfile,
      });
      const remoteCharacters = await loadSupabaseCharacters(authUserId);
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

  function openCharactersHub() {
    void trackCreatorEvent('character_opened', { source: 'create' }, authUserId);
    localStorage.setItem('lumora_open_characters_hub', '1');
    localStorage.setItem('lumora_characters_hub_context', 'create');
    window.location.href = '/profile';
  }

  function openSelfVerificationSetup() {
    void trackCreatorEvent('character_opened', { source: 'create_self_verification' }, authUserId);
    localStorage.setItem('lumora_open_characters_hub', '1');
    localStorage.setItem('lumora_characters_hub_context', 'create');
    localStorage.setItem('lumora_characters_hub_focus', 'self-verification');
    window.location.href = '/profile';
  }

  function handleCastSelection(character: CharacterProfile | null) {
    setSelectedCharacter(character);
    setCastConfirmation(character ? `${character.displayName || character.name} is cast for this scene` : '');
    if (character) {
      window.setTimeout(() => {
        castSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
  }

  function handleCharacterUpdated(character: CharacterProfile) {
    if (selectedCharacter?.id === character.id) {
      setSelectedCharacter(character);
    }
    if (defaultSelfCharacter?.id === character.id) {
      setDefaultSelfCharacter(character);
    }
    setCharacterRefreshKey((current) => current + 1);
  }

  if (pageLoading) {
    return (
      <div className="page lumora-page">
        <section className="headline-card lumora-card lumora-card-hero">
          <span className="eyebrow">cast</span>
          <h2>Waking up your AI cast...</h2>
        </section>
      </div>
    );
  }

  return (
    <div className="page lumora-page focused-create-page">
      <section
        ref={castSectionRef}
        className="cast-selection-anchor focused-cast-section"
        tabIndex={-1}
        aria-label="Cast for this scene"
      >
        {castConfirmation ? (
          <div className="story-memory-moment cast-confirmation">
            <span className="tiny-dot" />
            <p>Character casted: {selectedCharacter?.displayName || selectedCharacter?.name || castConfirmation.replace(' is cast for this scene', '')}</p>
          </div>
        ) : null}
        <CharacterLibrary
          refreshKey={characterRefreshKey}
          selectedCharacterId={selectedCharacter?.id ?? null}
          onSelect={handleCastSelection}
          compact
        />
        <button type="button" className="quiet-btn focused-cast-manage" onClick={openCharactersHub}>
          Open Your AI Cast
        </button>
      </section>

      <CreateVideo
        refreshKey={characterRefreshKey}
        characterId={effectiveCharacterId}
        characterName={effectiveCharacterName}
        characterAvatar={effectiveCharacterAvatar}
        isDefaultSelfCharacter={effectiveIsDefaultSelfCharacter}
        characterDescription={identityProfile?.appearanceSummary ?? selectedCharacter?.appearanceSummary ?? remixProject?.characterName ?? ""}
        characterProfile={remixProject ? null : selectedCharacter ?? activeSelfCharacter}
        referenceImageUrl={effectiveReferenceImageUrl}
        referenceImageUrls={effectiveReferenceImageUrls}
        additionalReferenceImageUrls={effectiveAdditionalReferenceImageUrls}
        referenceLoading={referenceLoading}
        referenceLabel={remixProject ? 'Remixed scene reference' : manualReferenceImageUrl && effectiveReferenceImageUrl === manualReferenceImageUrl ? 'Private setup reference' : identityProfile ? 'Saved self character' : null}
        forceSelfMode={effectiveIsDefaultSelfCharacter}
        isHydrated={isHydrated}
        identityProfile={effectiveIsDefaultSelfCharacter ? identityProfile : null}
        onLikenessFeedback={(feedback) => void handleLikenessFeedback(feedback)}
        onCharacterUpdated={handleCharacterUpdated}
        onResaveReferencePhoto={() => {
          openCharactersHub();
        }}
        onOpenSelfVerificationSetup={openSelfVerificationSetup}
      />

    </div>
  );
}
