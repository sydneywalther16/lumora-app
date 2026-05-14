import { type CharacterProfile, type CreatorSelfStylePreferences, type LumoraIdentityProfile, type PrivacySetting, type ReferenceImageUrls } from './api';

const STORAGE_KEY = 'lumora_characters';
export const CREATOR_SELF_CHARACTER_ID = 'creator-self';

/**
 * Remove transient data/blob URLs and large media from values.
 * Keep durable URLs like Supabase Storage URLs.
 */
export function cleanMediaUrl(value?: string | null): string | null {
  if (!value) return null;
  if (typeof value !== 'string') return null;
  if (value.startsWith('data:') || value.startsWith('blob:')) {
    console.log('[cleanMediaUrl] Removing transient media URL to save storage');
    return null;
  }
  return value;
}

export function isCreatorSelfCharacter(character: CharacterProfile | null | undefined): character is CharacterProfile {
  return Boolean(character && (character.id === CREATOR_SELF_CHARACTER_ID || character.isCreatorSelf === true));
}

export function cleanupCreatorSelfMetadata(profile: { displayName: string; defaultSelfCharacterId?: string | null; defaultSelfCharacterAvatar?: string | null; avatar?: string; manualReferenceImageUrl?: string | null; selfReferenceImageUrls?: any; selfReferencePhotoNames?: any }): void {
  if (typeof window === 'undefined') return;

  try {
    // Cleanup lumora_characters
    const characters = getStoredCharacters();
    const previousSelfCharacter = characters.find(isCreatorSelfCharacter);
    
    if (previousSelfCharacter) {
      const fallbackReferenceImages = {
        frontFace: '',
        leftAngle: '',
        rightAngle: '',
      };
      const cleanedCharacters = characters
        .filter((character) => !isCreatorSelfCharacter(character))
        .map((char) => {
          // Remove isSelf/isCreatorSelf from non-creator-self characters
          const { isSelf: _, isCreatorSelf: __, ...rest } = char as any;
          return rest as CharacterProfile;
        });
      const selfCharacter: CharacterProfile = {
        ...previousSelfCharacter,
        id: CREATOR_SELF_CHARACTER_ID,
        name: profile.displayName || previousSelfCharacter.name,
        referenceImageUrls: {
          ...fallbackReferenceImages,
          ...previousSelfCharacter.referenceImageUrls,
          manualReferenceImageUrl:
            cleanMediaUrl(profile.manualReferenceImageUrl) ||
            cleanMediaUrl(profile.selfReferenceImageUrls?.manualReferenceImageUrl) ||
            previousSelfCharacter.referenceImageUrls?.manualReferenceImageUrl ||
            null,
          frontFace:
            previousSelfCharacter.referenceImageUrls?.frontFace ||
            cleanMediaUrl(profile.defaultSelfCharacterAvatar) ||
            cleanMediaUrl(profile.avatar) ||
            '',
        },
        isSelf: true,
        isCreatorSelf: true,
      };

      saveStoredCharacters([...cleanedCharacters, selfCharacter]);
      console.log('[cleanupCreatorSelfMetadata] Cleaned up existing creator-self');
    } else {
      console.log('[cleanupCreatorSelfMetadata] No local creator-self found; skipping automatic fallback injection');
    }
  } catch (e) {
    console.log('[cleanupCreatorSelfMetadata] error:', e);
  }
}

export function getStoredCharacters(): CharacterProfile[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.log('[getStoredCharacters] localStorage key not found');
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.log('[getStoredCharacters] parsed value is not an array:', typeof parsed);
      return [];
    }
    const hasSelf = parsed.some(isCreatorSelfCharacter);
    if (!hasSelf) {
      console.log('[getStoredCharacters] WARNING: creator-self missing!', parsed.length, 'characters:', parsed.map(c => c.id));
    }
    return parsed;
  } catch (e) {
    console.log('[getStoredCharacters] error:', e);
    return [];
  }
}

export function saveStoredCharacters(characters: CharacterProfile[]) {
  if (typeof window === 'undefined') return;

  try {
    const creatorSelf = characters.find(isCreatorSelfCharacter);
    const json = JSON.stringify(characters);
    console.log('[saveStoredCharacters] Writing', characters.length, 'characters, creator-self included:', !!creatorSelf, 'JSON size:', json.length);
    if (creatorSelf) {
      console.log('[saveStoredCharacters] Creator-self object:', creatorSelf);
    }
    localStorage.setItem(STORAGE_KEY, json);
    console.log('[saveStoredCharacters] ✓ Successfully written to localStorage');
  } catch (error) {
    console.error('[saveStoredCharacters] ✗ FAILED to write to localStorage:', error);
    console.error('[saveStoredCharacters] Characters being saved:', characters);
    throw error; // Re-throw so caller knows it failed
  }
}

export function saveCreatorSelfCharacter(payload: {
  name: string;
  referenceImageUrls: ReferenceImageUrls;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
  voiceSampleName?: string | null;
  voiceSampleNumbers?: string | null;
  stylePreferences?: Record<string, unknown>;
  creatorSelfFeatures?: Record<string, string>;
  creatorSelfStylePreferences?: CreatorSelfStylePreferences;
  identityProfile?: LumoraIdentityProfile | null;
}): CharacterProfile {
  try {
    const now = new Date().toISOString();
    const storedCharacters = getStoredCharacters();
    console.log('[saveCreatorSelfCharacter] Read existing characters:', storedCharacters.length);
    
    const previousSelfCharacter = storedCharacters.find(isCreatorSelfCharacter);
    const normalizedCharacters = storedCharacters
      .filter((character) => !isCreatorSelfCharacter(character))
      .map((character) => {
        // Remove isSelf/isCreatorSelf from all non-creator-self characters
        const { isSelf: _, isCreatorSelf: __, ...rest } = character as any;
        return rest as CharacterProfile;
      });

    console.log('[saveCreatorSelfCharacter] Normalized characters (removed old self):', normalizedCharacters.length);
    console.log('[saveCreatorSelfCharacter] Payload name:', payload.name);
    
    // Clean media URLs - remove base64 data before storing
    const cleanedReferenceImageUrls: ReferenceImageUrls = {
      manualReferenceImageUrl: cleanMediaUrl(payload.referenceImageUrls.manualReferenceImageUrl),
      frontFace: cleanMediaUrl(payload.referenceImageUrls.frontFace) || '',
      frontFaceUrl: cleanMediaUrl(payload.referenceImageUrls.frontFaceUrl ?? payload.referenceImageUrls.frontFace),
      frontFacePath: cleanMediaUrl(payload.referenceImageUrls.frontFacePath),
      leftAngle: cleanMediaUrl(payload.referenceImageUrls.leftAngle) || '',
      leftAngleUrl: cleanMediaUrl(payload.referenceImageUrls.leftAngleUrl ?? payload.referenceImageUrls.leftAngle),
      leftAnglePath: cleanMediaUrl(payload.referenceImageUrls.leftAnglePath),
      rightAngle: cleanMediaUrl(payload.referenceImageUrls.rightAngle) || '',
      rightAngleUrl: cleanMediaUrl(payload.referenceImageUrls.rightAngleUrl ?? payload.referenceImageUrls.rightAngle),
      rightAnglePath: cleanMediaUrl(payload.referenceImageUrls.rightAnglePath),
      fullBody: cleanMediaUrl(payload.referenceImageUrls.fullBody),
      fullBodyUrl: cleanMediaUrl(payload.referenceImageUrls.fullBodyUrl ?? payload.referenceImageUrls.fullBody),
      fullBodyPath: cleanMediaUrl(payload.referenceImageUrls.fullBodyPath),
      expressive: cleanMediaUrl(payload.referenceImageUrls.expressive),
      expressiveUrl: cleanMediaUrl(payload.referenceImageUrls.expressiveUrl ?? payload.referenceImageUrls.expressive),
      expressivePath: cleanMediaUrl(payload.referenceImageUrls.expressivePath),
    };
    const cleanedSourceCaptureVideoUrl = cleanMediaUrl(payload.sourceCaptureVideoUrl);
    const cleanedVoiceSampleUrl = cleanMediaUrl(payload.voiceSampleUrl);

    console.log('[saveCreatorSelfCharacter] Cleaned media URLs:',{
      frontFace: cleanedReferenceImageUrls.frontFace ? '✓' : '✗',
      leftAngle: cleanedReferenceImageUrls.leftAngle ? '✓' : '✗',
      rightAngle: cleanedReferenceImageUrls.rightAngle ? '✓' : '✗',
      videoUrl: cleanedSourceCaptureVideoUrl ? '✓' : '✗',
      voiceUrl: cleanedVoiceSampleUrl ? '✓' : '✗',
    });

    const stylePreferences = {
      ...(previousSelfCharacter?.stylePreferences ?? {}),
      ...(payload.stylePreferences ?? {}),
      ...(payload.identityProfile ? { identityProfile: payload.identityProfile } : {}),
    };
    const creatorSelfFeatures =
      payload.creatorSelfFeatures ?? previousSelfCharacter?.creatorSelfFeatures ?? {};
    const creatorSelfStylePreferences =
      payload.creatorSelfStylePreferences ?? previousSelfCharacter?.creatorSelfStylePreferences ?? {};

    const selfCharacter: CharacterProfile = {
      id: CREATOR_SELF_CHARACTER_ID,
      ownerUserId: 'local',
      name: payload.name || 'My Self Character',
      status: 'ready' as const,
      consentConfirmed: true,
      visibility: 'private' as const,
      stylePreferences,
      referenceImageUrls: cleanedReferenceImageUrls,
      sourceCaptureVideoUrl: cleanedSourceCaptureVideoUrl,
      voiceSampleUrl: cleanedVoiceSampleUrl,
      voiceSampleName: payload.voiceSampleName ?? previousSelfCharacter?.voiceSampleName ?? null,
      voiceSampleNumbers: payload.voiceSampleNumbers ?? previousSelfCharacter?.voiceSampleNumbers ?? null,
      identityProfile: payload.identityProfile ?? previousSelfCharacter?.identityProfile ?? null,
      creatorSelfFeatures,
      creatorSelfStylePreferences,
      createdAt: previousSelfCharacter?.createdAt ?? now,
      updatedAt: now,
      isSelf: true,
      isCreatorSelf: true,
    };

    console.log('[saveCreatorSelfCharacter] Built selfCharacter:', {
      id: selfCharacter.id,
      name: selfCharacter.name,
      isSelf: selfCharacter.isSelf,
      isCreatorSelf: selfCharacter.isCreatorSelf,
    });

    const nextCharacters = [...normalizedCharacters, selfCharacter];
    console.log('[saveCreatorSelfCharacter] Final array:', nextCharacters.length, 'characters');
    
    // Try to save to storage
    try {
      saveStoredCharacters(nextCharacters);
    } catch (saveError) {
      console.error('[saveCreatorSelfCharacter] ✗ Save to storage failed:', saveError);
      throw new Error(`Failed to save creator-self character: ${saveError}`);
    }
    
    // Verify it was actually saved
    const verification = getStoredCharacters().find(isCreatorSelfCharacter);
    if (verification && verification.id === CREATOR_SELF_CHARACTER_ID) {
      console.log('[saveCreatorSelfCharacter] ✓ VERIFICATION PASSED: creator-self exists in storage');
    } else {
      console.error('[saveCreatorSelfCharacter] ✗ VERIFICATION FAILED: creator-self not found in storage after save');
      const stored = getStoredCharacters();
      console.error('[saveCreatorSelfCharacter] Storage contains:', stored.map(c => ({ id: c.id, name: c.name, isSelf: c.isSelf, isCreatorSelf: c.isCreatorSelf })));
      throw new Error('Verification failed: creator-self not found in storage after save');
    }
    
    return selfCharacter;
  } catch (error) {
    console.error('[saveCreatorSelfCharacter] Fatal error:', error);
    throw error;
  }
}

export function getCreatorSelfCharacter(): CharacterProfile | null {
  return getStoredCharacters().find(isCreatorSelfCharacter) ?? null;
}

export function updateCreatorSelfVoiceSample(payload: {
  voiceSampleUrl: string | null;
  voiceSampleName?: string | null;
  voiceSampleNumbers?: string | null;
}): CharacterProfile | null {
  const characters = getStoredCharacters();
  const existingSelfCharacter = characters.find(isCreatorSelfCharacter);
  if (!existingSelfCharacter) return null;

  const updatedSelfCharacter: CharacterProfile = {
    ...existingSelfCharacter,
    id: CREATOR_SELF_CHARACTER_ID,
    voiceSampleUrl: payload.voiceSampleUrl,
    voiceSampleName: payload.voiceSampleName ?? null,
    voiceSampleNumbers: payload.voiceSampleNumbers ?? null,
    updatedAt: new Date().toISOString(),
    isSelf: true,
    isCreatorSelf: true,
  };

  const normalizedCharacters = characters.filter((character) => !isCreatorSelfCharacter(character));
  saveStoredCharacters([...normalizedCharacters, updatedSelfCharacter]);
  return updatedSelfCharacter;
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function saveLocalCharacter(payload: {
  name: string;
  consentConfirmed: boolean;
  visibility: PrivacySetting;
  stylePreferences: Record<string, string>;
  appearanceSummary?: string | null;
  wardrobeTendencies?: string | null;
  emotionalTendencies?: string | null;
  soundtrackTendencies?: string | null;
  cinematicStyle?: string | null;
  relationshipMemory?: CharacterProfile['relationshipMemory'];
  referenceImageUrls: ReferenceImageUrls;
  sourceCaptureVideoUrl: string | null;
  voiceSampleUrl: string | null;
}): CharacterProfile {
  const now = new Date().toISOString();
  const character: CharacterProfile = {
    id: createId(),
    ownerUserId: 'local',
    name: payload.name,
    displayName: payload.name,
    status: 'ready',
    consentConfirmed: payload.consentConfirmed,
    visibility: payload.visibility,
    stylePreferences: {
      ...payload.stylePreferences,
      appearanceSummary: payload.appearanceSummary ?? '',
      wardrobeTendencies: payload.wardrobeTendencies ?? '',
      emotionalTendencies: payload.emotionalTendencies ?? '',
      soundtrackTendencies: payload.soundtrackTendencies ?? '',
      cinematicStyle: payload.cinematicStyle ?? '',
      relationshipMemory: payload.relationshipMemory ?? {},
    },
    referenceImageUrls: {
      manualReferenceImageUrl: cleanMediaUrl(payload.referenceImageUrls.manualReferenceImageUrl),
      frontFace: cleanMediaUrl(payload.referenceImageUrls.frontFace) || '',
      frontFaceUrl: cleanMediaUrl(payload.referenceImageUrls.frontFaceUrl ?? payload.referenceImageUrls.frontFace),
      frontFacePath: cleanMediaUrl(payload.referenceImageUrls.frontFacePath),
      leftAngle: cleanMediaUrl(payload.referenceImageUrls.leftAngle) || '',
      leftAngleUrl: cleanMediaUrl(payload.referenceImageUrls.leftAngleUrl ?? payload.referenceImageUrls.leftAngle),
      leftAnglePath: cleanMediaUrl(payload.referenceImageUrls.leftAnglePath),
      rightAngle: cleanMediaUrl(payload.referenceImageUrls.rightAngle) || '',
      rightAngleUrl: cleanMediaUrl(payload.referenceImageUrls.rightAngleUrl ?? payload.referenceImageUrls.rightAngle),
      rightAnglePath: cleanMediaUrl(payload.referenceImageUrls.rightAnglePath),
      fullBody: cleanMediaUrl(payload.referenceImageUrls.fullBody),
      fullBodyUrl: cleanMediaUrl(payload.referenceImageUrls.fullBodyUrl ?? payload.referenceImageUrls.fullBody),
      fullBodyPath: cleanMediaUrl(payload.referenceImageUrls.fullBodyPath),
      expressive: cleanMediaUrl(payload.referenceImageUrls.expressive),
      expressiveUrl: cleanMediaUrl(payload.referenceImageUrls.expressiveUrl ?? payload.referenceImageUrls.expressive),
      expressivePath: cleanMediaUrl(payload.referenceImageUrls.expressivePath),
    },
    sourceCaptureVideoUrl: cleanMediaUrl(payload.sourceCaptureVideoUrl),
    voiceSampleUrl: cleanMediaUrl(payload.voiceSampleUrl),
    appearanceSummary: payload.appearanceSummary ?? '',
    wardrobeTendencies: payload.wardrobeTendencies ?? '',
    emotionalTendencies: payload.emotionalTendencies ?? '',
    soundtrackTendencies: payload.soundtrackTendencies ?? '',
    cinematicStyle: payload.cinematicStyle ?? '',
    continuityState: {
      characterAppearance: payload.appearanceSummary ?? '',
      wardrobe: payload.wardrobeTendencies ?? '',
      emotionalTone: payload.emotionalTendencies ?? '',
      soundtrackMood: payload.soundtrackTendencies ?? '',
      cameraStyle: payload.cinematicStyle ?? '',
    },
    memorySnapshots: [],
    relationshipMemory: payload.relationshipMemory ?? {},
    appearanceDrift: [],
    createdAt: now,
    updatedAt: now,
  };
  const characters = [character, ...getStoredCharacters()];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
  } catch {
    // ignore localStorage failures for now
  }
  return character;
}

export function updateLocalCharacterProfile(input: {
  characterId: string;
  name?: string;
  appearanceSummary?: string;
  wardrobeTendencies?: string;
  emotionalTendencies?: string;
  soundtrackTendencies?: string;
  cinematicStyle?: string;
  relationshipMemory?: CharacterProfile['relationshipMemory'];
}): CharacterProfile | null {
  const characters = getStoredCharacters();
  const current = characters.find((character) => character.id === input.characterId);
  if (!current) return null;

  const updated: CharacterProfile = {
    ...current,
    name: input.name ?? current.name,
    displayName: input.name ?? current.displayName ?? current.name,
    stylePreferences: {
      ...current.stylePreferences,
      appearanceSummary: input.appearanceSummary ?? current.appearanceSummary ?? '',
      wardrobeTendencies: input.wardrobeTendencies ?? current.wardrobeTendencies ?? '',
      emotionalTendencies: input.emotionalTendencies ?? current.emotionalTendencies ?? '',
      soundtrackTendencies: input.soundtrackTendencies ?? current.soundtrackTendencies ?? '',
      cinematicStyle: input.cinematicStyle ?? current.cinematicStyle ?? '',
      relationshipMemory: input.relationshipMemory ?? current.relationshipMemory ?? {},
    },
    appearanceSummary: input.appearanceSummary ?? current.appearanceSummary ?? '',
    wardrobeTendencies: input.wardrobeTendencies ?? current.wardrobeTendencies ?? '',
    emotionalTendencies: input.emotionalTendencies ?? current.emotionalTendencies ?? '',
    soundtrackTendencies: input.soundtrackTendencies ?? current.soundtrackTendencies ?? '',
    cinematicStyle: input.cinematicStyle ?? current.cinematicStyle ?? '',
    continuityState: {
      ...(current.continuityState ?? {}),
      characterAppearance: input.appearanceSummary ?? current.appearanceSummary ?? '',
      wardrobe: input.wardrobeTendencies ?? current.wardrobeTendencies ?? '',
      emotionalTone: input.emotionalTendencies ?? current.emotionalTendencies ?? '',
      soundtrackMood: input.soundtrackTendencies ?? current.soundtrackTendencies ?? '',
      cameraStyle: input.cinematicStyle ?? current.cinematicStyle ?? '',
    },
    relationshipMemory: input.relationshipMemory ?? current.relationshipMemory ?? {},
    updatedAt: new Date().toISOString(),
  };

  saveStoredCharacters(characters.map((character) => (
    character.id === input.characterId ? updated : character
  )));
  return updated;
}

export function deleteLocalCharacterProfile(characterId: string): boolean {
  const characters = getStoredCharacters();
  const current = characters.find((character) => (
    character.id === characterId || character.characterId === characterId
  ));

  if (!current) return false;
  if (current.id === CREATOR_SELF_CHARACTER_ID || current.characterId === CREATOR_SELF_CHARACTER_ID || current.isCreatorSelf === true) {
    return false;
  }

  saveStoredCharacters(characters.filter((character) => (
    character.id !== current.id && character.characterId !== current.characterId
  )));
  return true;
}
